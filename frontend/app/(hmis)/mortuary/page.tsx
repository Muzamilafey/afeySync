'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Tabs, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import type { Patient } from '@/types/api';

interface Case { _id: string; mortuaryNumber: string; status: string; deceased: { name: string; sex?: string; age?: string; idNumber?: string }; dateOfDeath: string; placeOfDeath: string; causeOfDeath?: string; admittedAt: string; storage?: { chamber?: string; tray?: string }; storageDays?: number; nextOfKin: Array<{ name: string; relationship: string; phone?: string; idNumber?: string }>; releaseAuthorization?: { releaseTo: string; releaseToIdNumber: string; burialPermitNumber: string; byName?: string; at: string }; invoice?: { _id: string; invoiceNumber: string; totals: { balance: number } } | null }

export default function MortuaryPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'admitted,release_authorized' | 'released'>('admitted,release_authorized');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [f, setF] = useState({ name: '', sex: 'unknown', age: '', idNumber: '', dateOfDeath: '', placeOfDeath: 'in_facility', causeOfDeath: '', chamber: '', tray: '', kinName: '', kinRel: '', kinPhone: '', kinId: '' });
  const [rel, setRel] = useState({ releaseTo: '', releaseToIdNumber: '', burialPermitNumber: '' });
  const [collectId, setCollectId] = useState('');
  const list = useQuery({ queryKey: ['mortuary', tab], queryFn: async () => (await api<Case[]>('/mortuary/cases', { query: { status: tab } })).data });
  const detail = useQuery({ queryKey: ['mortuary-case', sel], queryFn: async () => (await api<Case>(`/mortuary/cases/${sel}`)).data, enabled: !!sel });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mortuary'] }); qc.invalidateQueries({ queryKey: ['mortuary-case'] }); };
  const admit = useMutation({
    mutationFn: () => api('/mortuary/cases', { method: 'POST', body: { patientId: patient?._id, deceased: patient ? undefined : { name: f.name, sex: f.sex, age: f.age || undefined, idNumber: f.idNumber || undefined }, dateOfDeath: f.dateOfDeath ? new Date(f.dateOfDeath).toISOString() : new Date().toISOString(), placeOfDeath: f.placeOfDeath, causeOfDeath: f.causeOfDeath || undefined, storage: f.chamber ? { chamber: f.chamber, tray: f.tray } : undefined, nextOfKin: f.kinName ? [{ name: f.kinName, relationship: f.kinRel, phone: f.kinPhone || undefined, idNumber: f.kinId || undefined }] : [] } }),
    onSuccess: () => { setOpen(false); setPatient(null); refresh(); },
  });
  const authorize = useMutation({ mutationFn: () => api(`/mortuary/cases/${sel}/authorize-release`, { method: 'POST', body: rel }), onSuccess: refresh });
  const release = useMutation({ mutationFn: () => api(`/mortuary/cases/${sel}/release`, { method: 'POST', body: { releaseToIdNumber: collectId } }), onSuccess: refresh });
  const outstanding = authorize.error instanceof ApiError && authorize.error.code === 'MORTUARY_BILL_OUTSTANDING' ? (authorize.error.details as { invoiceId: string; balance: number }) : null;
  const c = detail.data;
  return (
    <>
      <PageHeader title="Mortuary" crumbs={['Mortuary']} actions={can('mortuary.manage') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Admit body</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'admitted,release_authorized', label: 'In storage' }, { key: 'released', label: 'Released' }]} />
      <Card>
        {list.isLoading && <Loading />}
        <Table head={['No.', 'Deceased', 'Date of death', 'Place', 'Storage', 'Days', 'Status', '']} empty={(list.data ?? []).length === 0}>
          {list.data?.map((x) => (
            <tr key={x._id}>
              <Td className="font-mono text-xs">{x.mortuaryNumber}</Td><Td className="font-medium">{x.deceased.name}<span className="muted block text-xs">{x.deceased.sex} {x.deceased.age && `· ${x.deceased.age}y`}</span></Td>
              <Td>{fmtDateTime(x.dateOfDeath)}</Td><Td>{x.placeOfDeath.replace(/_/g, ' ')}</Td><Td>{x.storage?.chamber ? `${x.storage.chamber}-${x.storage.tray}` : '—'}</Td><Td>{x.storageDays}</Td>
              <Td><Badge tone={x.status === 'released' ? 'gray' : x.status === 'release_authorized' ? 'amber' : 'blue'}>{x.status.replace('_', ' ')}</Badge></Td>
              <Td><Button size="sm" variant="ghost" onClick={() => setSel(x._id)}>Open</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Admit body" wide>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Registered patient (death in facility)" className="col-span-full"><PatientPicker value={patient} onChange={setPatient} /></Field>
          {!patient && <>
            <Field label="Name of deceased"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Sex"><Select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
            <Field label="Age"><Input value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} /></Field>
            <Field label="ID number"><Input value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} /></Field>
          </>}
          <Field label="Date/time of death"><Input type="datetime-local" value={f.dateOfDeath} onChange={(e) => setF({ ...f, dateOfDeath: e.target.value })} /></Field>
          <Field label="Place"><Select value={f.placeOfDeath} onChange={(e) => setF({ ...f, placeOfDeath: e.target.value })}><option value="in_facility">In facility</option><option value="brought_in_dead">Brought in dead</option><option value="other">Other</option></Select></Field>
          <Field label="Cause of death" className="sm:col-span-2"><Input value={f.causeOfDeath} onChange={(e) => setF({ ...f, causeOfDeath: e.target.value })} /></Field>
          <Field label="Chamber"><Input value={f.chamber} onChange={(e) => setF({ ...f, chamber: e.target.value })} /></Field>
          <Field label="Tray"><Input value={f.tray} onChange={(e) => setF({ ...f, tray: e.target.value })} /></Field>
          <Field label="Next of kin"><Input value={f.kinName} onChange={(e) => setF({ ...f, kinName: e.target.value })} /></Field>
          <Field label="Relationship"><Input value={f.kinRel} onChange={(e) => setF({ ...f, kinRel: e.target.value })} /></Field>
          <Field label="Kin phone"><Input value={f.kinPhone} onChange={(e) => setF({ ...f, kinPhone: e.target.value })} /></Field>
          <Field label="Kin ID"><Input value={f.kinId} onChange={(e) => setF({ ...f, kinId: e.target.value })} /></Field>
          <div className="col-span-full space-y-2"><ErrorText error={admit.error} /><Button onClick={() => admit.mutate()} loading={admit.isPending} disabled={!patient && f.name.length < 2}>Admit</Button></div>
        </div>
      </Modal>
      <Modal open={!!sel} onClose={() => { setSel(null); authorize.reset(); release.reset(); }} title={c ? `${c.mortuaryNumber} — ${c.deceased.name}` : 'Loading'} wide>
        {c && (
          <div className="space-y-4">
            <KV items={[['Date of death', fmtDateTime(c.dateOfDeath)], ['Cause', c.causeOfDeath], ['Admitted', fmtDateTime(c.admittedAt)], ['Storage', c.storage?.chamber ? `${c.storage.chamber}-${c.storage.tray}` : '—'], ['Next of kin', c.nextOfKin.map((k) => `${k.name} (${k.relationship}) ${k.phone ?? ''}`).join('; ')], ['Bill', c.invoice ? <Link key="i" className="text-brand-600" href={`/billing/invoices/${c.invoice._id}`}>{c.invoice.invoiceNumber} · balance {money(c.invoice.totals.balance)}</Link> : '—']]} />
            {c.status === 'admitted' && can('mortuary.release') && (
              <div className="grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-3">
                <Field label="Release to"><Input value={rel.releaseTo} onChange={(e) => setRel({ ...rel, releaseTo: e.target.value })} /></Field>
                <Field label="Their ID number"><Input value={rel.releaseToIdNumber} onChange={(e) => setRel({ ...rel, releaseToIdNumber: e.target.value })} /></Field>
                <Field label="Burial permit no."><Input value={rel.burialPermitNumber} onChange={(e) => setRel({ ...rel, burialPermitNumber: e.target.value })} /></Field>
                <div className="col-span-full space-y-2">
                  {outstanding ? <Alert tone="amber" title="Bill outstanding">Balance {money(outstanding.balance)}. <Link className="font-semibold underline" href={`/billing/invoices/${outstanding.invoiceId}`}>Open bill</Link> to settle or waive, then authorize again.</Alert> : <ErrorText error={authorize.error} />}
                  <Button onClick={() => authorize.mutate()} loading={authorize.isPending}>Authorize release (posts storage charges)</Button>
                </div>
              </div>
            )}
            {c.status === 'release_authorized' && (
              <div className="space-y-2 border-t border-[var(--border)] pt-3">
                <Alert tone="blue">Authorized by {c.releaseAuthorization?.byName} to {c.releaseAuthorization?.releaseTo} · permit {c.releaseAuthorization?.burialPermitNumber}</Alert>
                {can('mortuary.manage') && <div className="flex gap-2"><Input placeholder="Collector’s ID number (must match)" value={collectId} onChange={(e) => setCollectId(e.target.value)} /><Button onClick={() => release.mutate()} loading={release.isPending}>Release body</Button></div>}
                <ErrorText error={release.error} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
