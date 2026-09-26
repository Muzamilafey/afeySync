'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, ScanLine } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Select, statusTone, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { ResultsTable } from '@/features/lab/ResultsTable';
import { LabTestSelector, type LabSelection } from '@/features/lab/LabTestSelector';
import type { LabOrder, LabTest, RadRequest } from '@/features/lab/types';
import { PrescriptionPanel } from '@/features/pharmacy/PrescriptionPanel';

function LabPanel({ visitId, open }: { visitId: string; open: boolean }) {
  const can = useCan();
  const qc = useQueryClient();
  const [sel, setSel] = useState<LabSelection>({ tests: [], packages: [] });
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const orders = useQuery({ queryKey: ['visit-lab', visitId], queryFn: async () => (await api<LabOrder[]>('/laboratory/orders', { query: { visitId } })).data, enabled: can('lab.view', 'lab.order') });
  const order = useMutation({ mutationFn: () => api('/laboratory/orders', { method: 'POST', body: { visitId, tests: sel.tests.map((t) => t.code), packages: sel.packages.map((p) => p.code), priority, clinicalNotes: notes || undefined } }), onSuccess: () => { setSel({ tests: [], packages: [] }); setNotes(''); qc.invalidateQueries({ queryKey: ['visit-lab', visitId] }); qc.invalidateQueries({ queryKey: ['visit', visitId] }); } });
  return (
    <Card title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Laboratory</span>}>
      {open && can('lab.order') && (
        <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
          <LabTestSelector value={sel} onChange={setSel} enabled={can('lab.order') && open} />
          <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></Select>
            <Input placeholder="Clinical notes for the lab" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button disabled={!sel.tests.length && !sel.packages.length} onClick={() => order.mutate()} loading={order.isPending}>Order {sel.tests.length + sel.packages.reduce((n, p) => n + p.testCodes.length, 0) || ''}</Button>
          </div>
          <ErrorText error={order.error} />
        </div>
      )}
      {(orders.data ?? []).length === 0 && <p className="muted text-sm">No lab orders.</p>}
      {orders.data?.map((o) => (
        <div key={o._id} className="mb-3">
          <p className="mb-1 text-xs"><Link href={`/laboratory/orders/${o._id}`} className="font-mono text-brand-600">{o.orderNumber}</Link> · {fmtDateTime(o.createdAt)} · {o.priority}</p>
          {o.items.map((i) => (
            <div key={i._id} className="mb-2 rounded border border-[var(--border)] p-2">
              <p className="flex justify-between text-sm font-medium">{i.testName} <Badge tone={statusTone(i.status === 'released' ? 'completed' : ['rejected', 'cancelled'].includes(i.status) ? 'failed' : 'pending')}>{i.status}</Badge></p>
              {i.status === 'released' && <ResultsTable item={i} />}
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}

function RadiologyPanel({ visitId, open }: { visitId: string; open: boolean }) {
  const can = useCan();
  const qc = useQueryClient();
  const [exam, setExam] = useState('');
  const [indication, setIndication] = useState('');
  const [priority, setPriority] = useState('routine');
  const [warning, setWarning] = useState<string[]>([]);
  const exams = useQuery({ queryKey: ['rad-exams'], queryFn: async () => (await api<Array<{ code: string; name: string; modality: string; requiresPreauth: boolean }>>('/radiology/exams')).data, enabled: can('radiology.order') && open });
  const reqs = useQuery({ queryKey: ['visit-rad', visitId], queryFn: async () => (await api<RadRequest[]>('/radiology/requests', { query: { visitId } })).data, enabled: can('radiology.view', 'radiology.order') });
  const order = useMutation({
    mutationFn: async () => api<RadRequest>('/radiology/requests', { method: 'POST', body: { visitId, examCode: exam, clinicalIndication: indication, priority } }),
    onSuccess: (r) => { setWarning(((r as unknown as { warnings?: string[] }).warnings) ?? []); setExam(''); setIndication(''); qc.invalidateQueries({ queryKey: ['visit-rad', visitId] }); },
  });
  return (
    <Card title={<span className="flex items-center gap-2"><ScanLine className="h-4 w-4" /> Radiology</span>}>
      {open && can('radiology.order') && (
        <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <Select value={exam} onChange={(e) => setExam(e.target.value)}><option value="">Select exam…</option>{exams.data?.map((e) => <option key={e.code} value={e.code}>{e.modality} · {e.name}{e.requiresPreauth ? ' (preauth)' : ''}</option>)}</Select>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></Select>
          </div>
          <Field label="Clinical indication"><Textarea rows={2} className="min-h-0" value={indication} onChange={(e) => setIndication(e.target.value)} /></Field>
          <ErrorText error={order.error} />
          {warning.map((w) => <Alert key={w} tone="amber">{w} <Link className="font-semibold underline" href="/sha/claims">Create preauthorization</Link></Alert>)}
          <Button disabled={!exam || indication.length < 3} onClick={() => order.mutate()} loading={order.isPending}>Request imaging</Button>
        </div>
      )}
      {(reqs.data ?? []).length === 0 && <p className="muted text-sm">No imaging requests.</p>}
      <Table head={['Exam', 'Status', 'Impression']}>
        {reqs.data?.map((r) => <tr key={r._id}><Td><Link href={`/radiology/${r._id}`} className="text-brand-600">{r.examName}</Link><span className="muted block font-mono text-xs">{r.accessionNumber}</span></Td><Td><Badge tone={statusTone(r.status === 'verified' ? 'completed' : 'pending')}>{r.status}</Badge></Td><Td className="text-sm">{r.status === 'verified' ? r.report?.impression : '—'}</Td></tr>)}
      </Table>
    </Card>
  );
}

export function VisitOrders({ visitId, patientId, open }: { visitId: string; patientId: string; open: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <LabPanel visitId={visitId} open={open} />
      <RadiologyPanel visitId={visitId} open={open} />
      <div className="xl:col-span-2"><PrescriptionPanel visitId={visitId} patientId={patientId} open={open} /></div>
    </div>
  );
}
