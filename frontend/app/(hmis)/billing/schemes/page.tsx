'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { money } from '@/lib/utils';
import { copayLabel, coverageLabel, type PayerScheme } from '@/features/billing/types';

interface Utilisation { month: string; visits: number; patients: number; valueOfCare: number; copayDue: number; collected: number; claimable: number; coveredByCapitation: number; averagePerPatient: number; scheme: { name: string; coverage: string; capitationRate?: number } }

function SchemeForm({ scheme, onDone }: { scheme?: PayerScheme; onDone: () => void }) {
  const [f, setF] = useState({
    code: scheme?.code ?? '', name: scheme?.name ?? '', kind: scheme?.kind ?? 'insurance', priceList: scheme?.priceList ?? 'insurance', coverage: scheme?.coverage ?? 'fee_for_service',
    copayType: scheme?.copay?.type ?? 'none', copayValue: String(scheme?.copay?.value ?? ''), capitationRate: scheme?.capitationRate != null ? String(scheme.capitationRate) : '',
    contactPerson: scheme?.contactPerson ?? '', phone: scheme?.phone ?? '', email: scheme?.email ?? '', notes: scheme?.notes ?? '', active: scheme?.active ?? true,
  });
  const body = () => ({
    name: f.name, kind: f.kind, priceList: f.priceList.trim().toLowerCase(), coverage: f.coverage,
    copay: { type: f.copayType, value: f.copayType === 'none' ? 0 : Number(f.copayValue || 0) },
    capitationRate: f.coverage === 'capitation' && f.capitationRate ? Number(f.capitationRate) : undefined,
    contactPerson: f.contactPerson || undefined, phone: f.phone || undefined, email: f.email || undefined, notes: f.notes || undefined, active: f.active,
  });
  const m = useMutation({ mutationFn: () => (scheme ? api(`/billing/schemes/${scheme._id}`, { method: 'PATCH', body: body() }) : api('/billing/schemes', { method: 'POST', body: { ...body(), code: f.code } })), onSuccess: onDone });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Code"><Input value={f.code} disabled={!!scheme} placeholder="e.g. JUB-GOLD" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label="Name"><Input value={f.name} placeholder="e.g. Jubilee Gold / KPC staff" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'insurance' | 'corporate' })}><option value="insurance">Insurance scheme</option><option value="corporate">Corporate (employer)</option></Select></Field>
      <Field label="Price list" hint="'insurance', 'cash', or the scheme's own list key used on Services & Prices (e.g. jubilee-gold). A service without a price on a scheme list uses the insurance price, then cash.">
        <Input value={f.priceList} onChange={(e) => setF({ ...f, priceList: e.target.value.toLowerCase() })} />
      </Field>
      <Field label="How the scheme pays">
        <Select value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value as 'fee_for_service' | 'capitation' })}>
          <option value="fee_for_service">Fee for service (claim each visit)</option>
          <option value="capitation">Capitation (fixed monthly fee per member)</option>
        </Select>
      </Field>
      {f.coverage === 'capitation' && <Field label="Capitation rate per member per month (KES)"><Input type="number" min={0} value={f.capitationRate} onChange={(e) => setF({ ...f, capitationRate: e.target.value })} /></Field>}
      <Field label="Copay (patient pays)">
        <Select value={f.copayType} onChange={(e) => setF({ ...f, copayType: e.target.value as 'none' | 'fixed' | 'percent' })}><option value="none">No copay</option><option value="fixed">Fixed amount per visit</option><option value="percent">Percentage of the bill</option></Select>
      </Field>
      {f.copayType !== 'none' && <Field label={f.copayType === 'fixed' ? 'Copay amount (KES)' : 'Copay percentage'}><Input type="number" min={0} max={f.copayType === 'percent' ? 100 : undefined} value={f.copayValue} onChange={(e) => setF({ ...f, copayValue: e.target.value })} /></Field>}
      <Field label="Contact person"><Input value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Status"><Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive (cannot be picked at check-in)</option></Select></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Benefit limits, pre-authorisation rules, excluded services…" /></Field>
      {f.coverage === 'capitation' && <div className="sm:col-span-2"><Alert tone="blue">Capitation patients pay only the copay. The rest of each bill is shown as covered by capitation and is not claimed per visit. Use the utilisation report to compare the care given with the monthly fee.</Alert></div>}
      <div className="sm:col-span-2 space-y-2"><ErrorText error={m.error} /><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!f.name || !f.priceList || (!scheme && !f.code)}>Save scheme</Button></div>
    </div>
  );
}

function UtilisationView({ scheme }: { scheme: PayerScheme }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ['scheme-util', scheme._id, month], queryFn: async () => (await api<Utilisation>(`/billing/schemes/${scheme._id}/utilisation`, { query: { month } })).data });
  const u = q.data;
  return (
    <div className="space-y-3">
      <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      {!u ? <Loading /> : (
        <KV items={[
          ['Visits', u.visits], ['Patients seen', u.patients], ['Value of care (at scheme prices)', money(u.valueOfCare)], ['Average per patient', money(u.averagePerPatient)],
          ['Copay due from patients', money(u.copayDue)], ['Collected', money(u.collected)],
          ...(scheme.coverage === 'capitation'
            ? [['Covered by capitation', money(u.coveredByCapitation)] as [string, string], ...(scheme.capitationRate ? [['Members whose monthly fee covers this care', String(Math.ceil(u.coveredByCapitation / scheme.capitationRate))] as [string, string]] : [])]
            : [['To claim from the scheme', money(u.claimable)] as [string, string]]),
        ]} />
      )}
    </div>
  );
}

export default function SchemesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<PayerScheme | 'new' | null>(null);
  const [util, setUtil] = useState<PayerScheme | null>(null);
  const list = useQuery({ queryKey: ['schemes', 'all'], queryFn: async () => (await api<PayerScheme[]>('/billing/schemes', { query: { all: 'true' } })).data });
  const manage = can('billing.prices');
  return (
    <>
      <PageHeader title="Corporates & insurance schemes" subtitle="Price list, copay and how each scheme pays: per visit or capitation." crumbs={['Billing', 'Schemes']} actions={manage && <Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> New scheme</Button>} />
      <Card>
        {list.isLoading ? <Loading /> : (
          <Table head={['Code', 'Scheme', 'Type', 'Price list', 'Pays by', 'Copay', 'Status', '']} empty={(list.data ?? []).length === 0}>
            {list.data?.map((s) => (
              <tr key={s._id}>
                <Td className="font-mono text-xs">{s.code}</Td>
                <Td className="font-medium">{s.name}{s.contactPerson && <span className="muted block text-xs">{s.contactPerson}{s.phone ? ` · ${s.phone}` : ''}</span>}</Td>
                <Td className="capitalize">{s.kind}</Td>
                <Td className="font-mono text-xs">{s.priceList}</Td>
                <Td><Badge tone={s.coverage === 'capitation' ? 'blue' : 'gray'}>{coverageLabel(s.coverage)}</Badge>{s.coverage === 'capitation' && s.capitationRate ? <span className="muted block text-xs">{money(s.capitationRate)} / member / month</span> : null}</Td>
                <Td>{copayLabel(s.copay)}</Td>
                <Td><Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'active' : 'inactive'}</Badge></Td>
                <Td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setUtil(s)}>Utilisation</Button>{manage && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="muted mt-3 text-xs">Scheme-specific prices are set per service on <Link className="text-brand-600 underline" href="/billing/services">Services &amp; Prices</Link> using the scheme&apos;s price-list key. At check-in, reception picks the scheme and enters the member number; the bill then uses these terms. Changing a scheme later does not change bills already opened.</p>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New scheme' : 'Edit scheme'} wide>{edit && <SchemeForm scheme={edit === 'new' ? undefined : edit} onDone={() => { qc.invalidateQueries({ queryKey: ['schemes'] }); setEdit(null); }} />}</Modal>
      <Modal open={!!util} onClose={() => setUtil(null)} title={`${util?.name ?? ''}: utilisation`}>{util && <UtilisationView scheme={util} />}</Modal>
    </>
  );
}
