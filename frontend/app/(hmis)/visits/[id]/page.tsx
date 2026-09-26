'use client';

import { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { MedicalReportsPanel } from '@/features/medicalReports/MedicalReportsPanel';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, Select, statusTone, Table, Tabs, Td, Textarea } from '@/components/ui';
import { age, fmtDateTime, money } from '@/lib/utils';
import { ConsultationEditor } from '@/features/opd/ConsultationEditor';
import { VitalsForm, type VitalsRow } from '@/features/opd/VitalsForm';
import { VisitOrders } from '@/features/opd/VisitOrders';
import { STAGES, STAGE_LABEL } from '@/features/frontdesk/types';
import { ServicePicker } from '@/features/billing/ServicePicker';

interface VisitBundle {
  visit: { _id: string; visitNumber: string; type: string; status: string; priority: string; payer: { type: string; scheme?: string; memberNumber?: string }; complaint?: string; createdAt: string; referralIn?: { from?: string } };
  patient: { _id: string; patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string; phone?: string; allergies?: Array<{ substance: string; reaction?: string }>; clientRegistryId?: string; sha?: { status: string } };
  queue: Array<{ _id: string; stage: string; ticket: string; status: string; createdAt: string; doneAt?: string }>;
  vitals: VitalsRow[];
  invoice: { _id: string; invoiceNumber: string; status: string; totals: { net: number; paid: number; balance: number } } | null;
  procedures: Array<{ _id: string; name: string; status: string; notes?: string; createdAt: string }>;
  referrals: Array<{ _id: string; referralNumber: string; direction: string; toFacility?: string; toDepartment?: string; reason: string; status: string }>;
}
type Tab = 'overview' | 'consultation' | 'orders' | 'procedures' | 'reports' | 'billing';

function VisitInner({ id }: { id: string }) {
  const params = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'overview');
  const [modal, setModal] = useState<'vitals' | 'route' | 'referral' | 'procedure' | null>(null);
  const [stage, setStage] = useState('laboratory');
  const [ref, setRef] = useState({ direction: 'out', toFacility: '', toDepartment: '', reason: '', clinicalSummary: '', urgency: 'routine' });
  const [proc, setProc] = useState<{ serviceCode?: string; name: string; notes: string; done: boolean }>({ name: '', notes: '', done: true });
  const q = useQuery({ queryKey: ['visit', id], queryFn: async () => (await api<VisitBundle>(`/visits/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['visit', id] });
  const route = useMutation({ mutationFn: () => api(`/visits/${id}/route`, { method: 'POST', body: { stage } }), onSuccess: () => { setModal(null); refresh(); } });
  const close = useMutation({ mutationFn: (force: boolean) => api(`/visits/${id}/close`, { method: 'POST', body: { force } }), onSuccess: refresh });
  const referral = useMutation({ mutationFn: () => api('/referrals', { method: 'POST', body: { ...ref, patientId: q.data!.patient._id, visitId: id, toFacility: ref.toFacility || undefined, toDepartment: ref.toDepartment || undefined } }), onSuccess: () => { setModal(null); refresh(); } });
  const procedure = useMutation({ mutationFn: () => api('/opd/procedures', { method: 'POST', body: { visitId: id, ...proc } }), onSuccess: () => { setModal(null); setProc({ name: '', notes: '', done: true }); refresh(); } });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const { visit, patient } = q.data;
  const open = ['open', 'in_progress'].includes(visit.status);

  return (
    <div className="space-y-5">
      <section className="surface rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/patients/${patient._id}`} className="text-xl font-semibold uppercase hover:underline">{patient.firstName} {patient.middleName} {patient.lastName}</Link>
            <p className="muted text-sm capitalize">{patient.gender} | {age(patient.dateOfBirth)} | {patient.patientNumber} {patient.clientRegistryId && `| ${patient.clientRegistryId}`}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {patient.allergies?.length ? <Badge tone="red">Allergies: {patient.allergies.map((a) => a.substance).join(', ')}</Badge> : <Badge>No known allergies</Badge>}
              <Badge tone={statusTone(patient.sha?.status)}>SHA: {(patient.sha?.status ?? 'unknown').replace('_', ' ')}</Badge>
              <Badge tone="purple" className="uppercase">{visit.payer.type}{visit.payer.scheme && ` · ${visit.payer.scheme}`}</Badge>
              {visit.priority !== 'normal' && <Badge tone={visit.priority === 'emergency' ? 'red' : 'amber'}>{visit.priority}</Badge>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono font-semibold">{visit.visitNumber}</p>
            <p className="muted text-xs">{visit.type.replace(/_/g, ' ')} · {fmtDateTime(visit.createdAt)}</p>
            <Badge tone={statusTone(visit.status === 'closed' ? 'completed' : 'pending')}>{visit.status.replace('_', ' ')}</Badge>
            {open && (
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setModal('route')}>Send to…</Button>
                <Button size="sm" variant="secondary" onClick={() => close.mutate(false)} loading={close.isPending}>Close visit</Button>
              </div>
            )}
          </div>
        </div>
        {visit.complaint && <p className="mt-2 text-sm"><span className="muted">Complaint:</span> {visit.complaint}</p>}
      </section>
      {close.error && (close.error as { code?: string }).code === 'CONSULTATION_DRAFT_OPEN' ? (
        <Alert tone="amber" title="Consultation still in draft">Finalize it first, or <button className="font-semibold underline" onClick={() => close.mutate(true)}>close anyway</button>.</Alert>
      ) : <ErrorText error={close.error} />}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview & Vitals' }, ...(can('consultation.view') ? [{ key: 'consultation' as const, label: 'Consultation' }] : []), { key: 'orders', label: 'Orders' }, { key: 'procedures', label: 'Procedures & Referrals' }, ...(can('medicalreports.view', 'medicalreports.create') ? [{ key: 'reports' as const, label: 'Reports & certificates' }] : []), ...(can('billing.view') ? [{ key: 'billing' as const, label: 'Billing' }] : [])]} />

      {tab === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card title="Vitals" actions={open && (can('opd.create') || can('nursing.record')) && <Button size="sm" onClick={() => setModal('vitals')}>Record vitals</Button>}>
            <Table head={['Time', 'T°C', 'Pulse', 'RR', 'BP', 'SpO₂', 'Wt', 'BMI', 'Triage', 'Flags']} empty={q.data.vitals.length === 0}>
              {q.data.vitals.map((v) => (
                <tr key={v._id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(v.recordedAt)}<span className="muted block">{v.recordedByName}</span></Td>
                  <Td>{v.temperatureC ?? '—'}</Td><Td>{v.pulse ?? '—'}</Td><Td>{v.respiratoryRate ?? '—'}</Td>
                  <Td>{v.systolic ? `${v.systolic}/${v.diastolic ?? '—'}` : '—'}</Td><Td>{v.spo2 ?? '—'}</Td><Td>{v.weightKg ?? '—'}</Td><Td>{v.bmi ?? '—'}</Td>
                  <Td><Badge tone={v.triageCategory === 'emergency' ? 'red' : v.triageCategory === 'priority' ? 'amber' : 'gray'}>{v.triageCategory}</Badge></Td>
                  <Td className="text-xs text-red-600">{v.flags?.join(', ')}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Patient journey">
            <ol className="space-y-2 text-sm">
              {q.data.queue.map((e) => <li key={e._id} className="flex justify-between"><span>{STAGE_LABEL[e.stage]} <span className="muted font-mono text-xs">{e.ticket}</span></span><Badge tone={statusTone(e.status === 'done' ? 'completed' : e.status === 'waiting' ? 'pending' : e.status === 'cancelled' ? 'failed' : 'active')}>{e.status.replace('_', ' ')}</Badge></li>)}
            </ol>
          </Card>
        </div>
      )}
      {tab === 'consultation' && <ConsultationEditor visitId={id} visitOpen={open} />}
      {tab === 'orders' && <VisitOrders visitId={id} patientId={patient._id} open={open} />}
      {tab === 'reports' && <MedicalReportsPanel visitId={id} patientId={patient._id} />}
      {tab === 'procedures' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Procedures" actions={open && can('consultation.create', 'nursing.record') && <Button size="sm" onClick={() => setModal('procedure')}>Add procedure</Button>}>
            <Table head={['Procedure', 'Status', 'Time']} empty={q.data.procedures.length === 0}>
              {q.data.procedures.map((p) => <tr key={p._id}><Td>{p.name}<span className="muted block text-xs">{p.notes}</span></Td><Td><Badge tone={statusTone(p.status === 'done' ? 'completed' : p.status === 'ordered' ? 'pending' : 'failed')}>{p.status}</Badge></Td><Td>{fmtDateTime(p.createdAt)}</Td></tr>)}
            </Table>
          </Card>
          <Card title="Referrals" actions={open && can('consultation.create') && <Button size="sm" onClick={() => setModal('referral')}>Refer</Button>}>
            <Table head={['Ref', 'To', 'Reason', 'Status']} empty={q.data.referrals.length === 0}>
              {q.data.referrals.map((r) => <tr key={r._id}><Td className="font-mono text-xs">{r.referralNumber}</Td><Td>{r.toFacility ?? r.toDepartment}</Td><Td>{r.reason}</Td><Td><Badge>{r.status}</Badge></Td></tr>)}
            </Table>
          </Card>
        </div>
      )}
      {tab === 'billing' && (
        <Card title="Bill">
          {q.data.invoice ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm"><p className="font-mono font-semibold">{q.data.invoice.invoiceNumber}</p><p>Net {money(q.data.invoice.totals.net)} · Paid {money(q.data.invoice.totals.paid)} · <strong>Balance {money(q.data.invoice.totals.balance)}</strong></p></div>
              <Link href={`/billing/invoices/${q.data.invoice._id}`}><Button>Open invoice</Button></Link>
            </div>
          ) : <p className="muted text-sm">No charges posted for this visit yet.</p>}
        </Card>
      )}

      <Modal open={modal === 'vitals'} onClose={() => setModal(null)} title="Record vitals" wide><VitalsForm visitId={id} onSaved={() => { setModal(null); refresh(); }} /></Modal>
      <Modal open={modal === 'route'} onClose={() => setModal(null)} title="Send patient to">
        <div className="space-y-3">
          <Select value={stage} onChange={(e) => setStage(e.target.value)}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
          <ErrorText error={route.error} />
          <Button onClick={() => route.mutate()} loading={route.isPending}>Add to queue</Button>
        </div>
      </Modal>
      <Modal open={modal === 'referral'} onClose={() => setModal(null)} title="Referral" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Direction"><Select value={ref.direction} onChange={(e) => setRef({ ...ref, direction: e.target.value })}><option value="out">To another facility</option><option value="internal">Internal (department)</option></Select></Field>
          <Field label="Urgency"><Select value={ref.urgency} onChange={(e) => setRef({ ...ref, urgency: e.target.value })}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></Select></Field>
          {ref.direction === 'out' ? <Field label="Facility"><Input value={ref.toFacility} onChange={(e) => setRef({ ...ref, toFacility: e.target.value })} /></Field> : <Field label="Department"><Input value={ref.toDepartment} onChange={(e) => setRef({ ...ref, toDepartment: e.target.value })} /></Field>}
          <Field label="Reason" className="col-span-full"><Input value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })} /></Field>
          <Field label="Clinical summary" className="col-span-full"><Textarea value={ref.clinicalSummary} onChange={(e) => setRef({ ...ref, clinicalSummary: e.target.value })} /></Field>
          <div className="col-span-full space-y-2"><ErrorText error={referral.error} /><Button onClick={() => referral.mutate()} loading={referral.isPending} disabled={ref.reason.length < 3}>Create referral</Button></div>
        </div>
      </Modal>
      <Modal open={modal === 'procedure'} onClose={() => setModal(null)} title="Procedure">
        <div className="space-y-3">
          <Field label="Billable service (optional)"><ServicePicker onPick={(s) => setProc({ ...proc, serviceCode: s.code, name: proc.name || s.name })} /></Field>
          {proc.serviceCode && <Badge>{proc.serviceCode}</Badge>}
          <Field label="Procedure"><Input value={proc.name} onChange={(e) => setProc({ ...proc, name: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={proc.notes} onChange={(e) => setProc({ ...proc, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={proc.done} onChange={(e) => setProc({ ...proc, done: e.target.checked })} /> Performed now</label>
          <ErrorText error={procedure.error} />
          <Button onClick={() => procedure.mutate()} loading={procedure.isPending} disabled={proc.name.length < 2}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}

export default function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><VisitInner id={id} /></Suspense>;
}
