'use client';

import { EPrescriptionControls } from '@/features/pharmacy/EPrescriptionControls';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, statusTone, Table, Tabs, Td } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { ItemPicker } from '@/features/pharmacy/ItemPicker';
import type { Item, Location, Prescription } from '@/features/pharmacy/types';

function Dispense({ rx, onDone }: { rx: Prescription; onDone: () => void }) {
  const locs = useQuery({ queryKey: ['locations'], queryFn: async () => (await api<Location[]>('/pharmacy/locations')).data });
  const [locationId, setLocationId] = useState('');
  const loc = locationId || locs.data?.find((l) => l.type === 'pharmacy')?._id || '';
  const pending = rx.items.filter((i) => i.status !== 'cancelled' && i.dispensedQuantity < i.quantity);
  const [picks, setPicks] = useState<Record<string, { item?: Item; itemId?: string; qty: number }>>(() => Object.fromEntries(pending.map((i) => [i._id, { itemId: i.itemId, qty: i.quantity - i.dispensedQuantity }])));
  const items = useQuery({ queryKey: ['rx-items', rx._id, loc], queryFn: async () => (await api<Item[]>('/pharmacy/items', { query: { limit: 500 } })).data });
  const m = useMutation({ mutationFn: () => api(`/pharmacy/prescriptions/${rx._id}/dispense`, { method: 'POST', body: { locationId: loc, lines: Object.entries(picks).filter(([, p]) => p.itemId && p.qty > 0).map(([rxItemId, p]) => ({ rxItemId, itemId: p.itemId, quantity: p.qty })) } }), onSuccess: onDone });
  const allergies = typeof rx.patientId === 'object' ? rx.patientId.allergies ?? [] : [];
  return (
    <div className="space-y-3">
      {allergies.length > 0 && <Alert tone="red" title="Allergies">{allergies.map((a) => a.substance).join(', ')}</Alert>}
      <Field label="Dispense from"><Select value={loc} onChange={(e) => setLocationId(e.target.value)}>{locs.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
      {pending.map((i) => {
        const p = picks[i._id];
        const it = p.item ?? items.data?.find((x) => x._id === p.itemId);
        return (
          <div key={i._id} className="grid gap-2 rounded border border-[var(--border)] p-2 sm:grid-cols-[1fr_1fr_100px]">
            <div className="text-sm"><p className="font-medium">{i.drugName}</p><p className="muted text-xs">{i.dose} {i.frequency} {i.durationDays && `× ${i.durationDays}d`} · outstanding {i.quantity - i.dispensedQuantity}</p></div>
            <div>{it ? <p className="text-sm">{it.name} <span className={`text-xs ${(it.stock?.usable ?? 0) >= p.qty ? 'text-emerald-600' : 'text-red-600'}`}>({it.stock?.usable ?? 0} usable)</span> <button className="text-xs text-brand-600" onClick={() => setPicks({ ...picks, [i._id]: { ...p, item: undefined, itemId: undefined } })}>change</button></p> : <ItemPicker onPick={(x) => setPicks({ ...picks, [i._id]: { ...p, item: x, itemId: x._id } })} placeholder="Select stock item" />}</div>
            <Input type="number" min={0} max={i.quantity - i.dispensedQuantity} value={p.qty} onChange={(e) => setPicks({ ...picks, [i._id]: { ...p, qty: Number(e.target.value) } })} />
          </div>
        );
      })}
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!loc}>Dispense (FEFO)</Button>
      <p className="muted text-xs">Batches are selected First-Expiry-First-Out; expired stock is never dispensed. Partial dispensing is allowed.</p>
    </div>
  );
}

const URGENCY_TONE = { stat: 'red', urgent: 'amber', routine: 'gray' } as const;

export default function PharmacyPage() {
  return <Suspense><PharmacyQueue /></Suspense>;
}

function PharmacyQueue() {
  const can = useCan();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [source, setSource] = useState<'opd' | 'ward' | 'discharge'>(params.get('view') === 'ward' ? 'ward' : params.get('view') === 'discharge' ? 'discharge' : 'opd');
  const [tab, setTab] = useState<'pending,partially_dispensed' | 'dispensed'>('pending,partially_dispensed');
  const [sel, setSel] = useState<Prescription | null>(null);
  const q = useQuery({ queryKey: ['rx-queue', source, tab], queryFn: async () => (await api<Prescription[]>('/pharmacy/prescriptions', { query: { status: tab, source, limit: 100 } })).data, refetchInterval: 20_000 });
  const wardPending = useQuery({ queryKey: ['rx-queue', 'ward', 'count'], queryFn: async () => (await api<Prescription[]>('/pharmacy/prescriptions', { query: { status: 'pending,partially_dispensed', source: 'ward', limit: 100 } })).data, refetchInterval: 20_000 });
  const wardCount = wardPending.data?.length ?? 0;
  const statCount = wardPending.data?.filter((r) => r.urgency === 'stat').length ?? 0;
  const cancel = useMutation({ mutationFn: ({ rx, reason }: { rx: Prescription; reason: string }) => api(`/pharmacy/prescriptions/${rx._id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rx-queue'] }) });
  return (
    <>
      <PageHeader title="Pharmacy" crumbs={['Pharmacy', 'Prescriptions']} actions={<div className="flex gap-2">{can('pharmacy.sell') && <Link href="/pharmacy/pos"><Button>Pharmacy POS</Button></Link>}<Link href="/inventory"><Button variant="outline">Stock</Button></Link></div>} />
      <Tabs value={source} onChange={setSource} tabs={[{ key: 'opd', label: 'Outpatient prescriptions' }, { key: 'ward', label: `Ward requests${wardCount ? ` (${wardCount})` : ''}` }, { key: 'discharge', label: 'Discharge drugs' }]} />
      {source === 'ward' && statCount > 0 && tab !== 'dispensed' && <Alert tone="red" title="STAT requests waiting">{statCount} STAT ward request{statCount > 1 ? 's are' : ' is'} at the top of the list. Dispense these first.</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pending,partially_dispensed', label: 'To dispense' }, { key: 'dispensed', label: 'Dispensed' }]} />
      <Card>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error || cancel.error} />
        <Table head={source !== 'opd' ? ['Rx', 'Patient', 'Ward / bed', 'Drugs', 'Ordered by', 'Status', ''] : ['Rx', 'Patient', 'Drugs', 'Prescriber', 'Status', '']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((rx) => {
            const p = typeof rx.patientId === 'object' ? rx.patientId : null;
            return (
              <tr key={rx._id}>
                <Td className="font-mono text-xs">{rx.rxNumber}<span className="muted block">{fmtDateTime(rx.createdAt)}</span><a href={`/print/prescription/${rx._id}`} target="_blank" rel="noreferrer" className="block font-sans text-brand-600 hover:underline">Print</a>{rx.admissionId && rx.urgency && rx.urgency !== 'routine' && <Badge tone={URGENCY_TONE[rx.urgency]}>{rx.urgency.toUpperCase()}</Badge>}</Td>
                <Td>{p?.firstName} {p?.lastName}<span className="muted block text-xs capitalize">{p?.gender} · {age(p?.dateOfBirth)} · {p?.patientNumber}</span>{!!p?.allergies?.length && <Badge tone="red">Allergies</Badge>}</Td>
                {source !== 'opd' && <Td>{rx.ward?.name ?? '—'}{rx.ward?.bedNumber && <span className="muted block text-xs">Bed {rx.ward.bedNumber}</span>}</Td>}
                <Td className="text-sm">{rx.items.map((i) => <span key={i._id} className={`block ${i.status === 'cancelled' ? 'line-through opacity-50' : ''}`}>{i.drugName} — {i.dose} {i.frequency} · {i.dispensedQuantity}/{i.quantity}</span>)}</Td>
                <Td>{rx.prescriberName}</Td>
                <Td><Badge tone={statusTone(rx.status === 'dispensed' ? 'completed' : 'pending')}>{rx.status.replace('_', ' ')}</Badge>{rx.admissionId && rx.dispenses.length > 0 && (rx.receipts?.at(-1)?.dispenseCount ?? 0) >= rx.dispenses.length ? <Badge tone="green">received on ward</Badge> : rx.admissionId && rx.dispenses.length > 0 ? <Badge tone="blue">awaiting ward receipt</Badge> : null}{rx.ePrescription?.status && <EPrescriptionControls rx={rx} />}</Td>
                <Td className="whitespace-nowrap">
                  {can('pharmacy.dispense') && rx.status !== 'dispensed' && <Button size="sm" onClick={() => setSel(rx)}>Dispense</Button>}{' '}
                  {can('pharmacy.dispense') && rx.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => { const reason = window.prompt('Reason for cancelling'); if (reason) cancel.mutate({ rx, reason }); }}>Cancel</Button>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Dispense ${sel?.rxNumber}`} wide>{sel && <Dispense rx={sel} onDone={() => { setSel(null); qc.invalidateQueries({ queryKey: ['rx-queue'] }); }} />}</Modal>
    </>
  );
}
