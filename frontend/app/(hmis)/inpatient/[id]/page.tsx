'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, Select, Stat, statusTone, Table, Tabs, Td, Textarea } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { VitalsForm, type VitalsRow } from '@/features/opd/VitalsForm';
import { VisitOrders } from '@/features/opd/VisitOrders';

interface Bundle {
  admission: { _id: string; admissionNumber: string; status: string; admittedAt: string; admissionDiagnosis: string; admittingDoctorName?: string; visitId?: string; transfers: Array<{ at: string; reason: string }>; discharge?: { at: string; outcome: string; summary: string; finalDiagnosis: string; byName?: string } };
  patient: { _id: string; patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string; allergies?: Array<{ substance: string }>; sha?: { status: string } };
  ward: { name: string };
  bed: { number: string };
  notes: Array<{ _id: string; kind: string; text: string; byName?: string; createdAt: string }>;
  vitals: VitalsRow[];
  mar: Array<{ _id: string; drugName: string; dose?: string; route?: string; status: string; givenAt: string; byName?: string; notes?: string }>;
  fluids: Array<{ _id: string; direction: string; route: string; volumeMl: number; at: string }>;
  fluidBalance24h: { intake: number; output: number; net: number };
  lengthOfStayDays: number;
}
type Tab = 'notes' | 'vitals' | 'mar' | 'fluids' | 'orders' | 'discharge';

export default function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('notes');
  const [note, setNote] = useState({ kind: can('nursing.record') ? 'nursing' : 'doctor_round', text: '' });
  const [mar, setMar] = useState({ drugName: '', dose: '', route: '', status: 'given', notes: '' });
  const [fluid, setFluid] = useState({ direction: 'intake', route: 'IV', volumeMl: '' });
  const [dis, setDis] = useState({ outcome: 'recovered', summary: '', finalDiagnosis: '', dischargeMedications: '', followUp: '' });
  const [transfer, setTransfer] = useState(false);
  const [toBed, setToBed] = useState({ wardId: '', bedId: '', reason: '' });
  const q = useQuery({ queryKey: ['admission', id], queryFn: async () => (await api<Bundle>(`/inpatient/admissions/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admission', id] });
  const post = useMutation({ mutationFn: ({ path, body }: { path: string; body: object }) => api(`/inpatient/admissions/${id}/${path}`, { method: 'POST', body }), onSuccess: () => { refresh(); setNote({ ...note, text: '' }); setMar({ drugName: '', dose: '', route: '', status: 'given', notes: '' }); setFluid({ ...fluid, volumeMl: '' }); setTransfer(false); } });
  const wards = useQuery({ queryKey: ['wards'], queryFn: async () => (await api<Array<{ _id: string; name: string; available: number }>>('/inpatient/wards')).data, enabled: transfer });
  const beds = useQuery({ queryKey: ['free-beds', toBed.wardId], queryFn: async () => (await api<Array<{ _id: string; number: string }>>('/inpatient/beds', { query: { wardId: toBed.wardId, status: 'available' } })).data, enabled: !!toBed.wardId });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const { admission: a, patient: p } = q.data;
  const active = a.status === 'admitted';
  return (
    <div className="space-y-5">
      <section className="surface rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/patients/${p._id}`} className="text-xl font-semibold uppercase hover:underline">{p.firstName} {p.middleName} {p.lastName}</Link>
            <p className="muted text-sm capitalize">{p.gender} | {age(p.dateOfBirth)} | {p.patientNumber} | {q.data.ward?.name} — bed {q.data.bed?.number}</p>
            <div className="mt-2 flex flex-wrap gap-2">{p.allergies?.length ? <Badge tone="red">Allergies: {p.allergies.map((x) => x.substance).join(', ')}</Badge> : <Badge>No known allergies</Badge>}<Badge tone={statusTone(p.sha?.status)}>SHA {p.sha?.status ?? 'unknown'}</Badge></div>
          </div>
          <div className="text-right">
            <p className="font-mono font-semibold">{a.admissionNumber}</p>
            <p className="muted text-xs">Admitted {fmtDateTime(a.admittedAt)} by {a.admittingDoctorName}</p>
            <Badge tone={active ? 'blue' : 'gray'}>{a.status}</Badge>
            <div className="mt-2 flex justify-end gap-2">
              {active && can('inpatient.transfer') && <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>Transfer</Button>}
              {!active && <Link href={`/print/discharge/${a._id}`} target="_blank"><Button size="sm" variant="outline"><Printer className="h-4 w-4" /> Discharge summary</Button></Link>}
            </div>
          </div>
        </div>
        <p className="mt-2 text-sm"><span className="muted">Admission diagnosis:</span> {a.admissionDiagnosis}</p>
      </section>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Length of stay" value={`${q.data.lengthOfStayDays} d`} />
        <Stat label="Intake (24h)" value={`${q.data.fluidBalance24h.intake} ml`} />
        <Stat label="Output (24h)" value={`${q.data.fluidBalance24h.output} ml`} />
        <Stat label="Balance (24h)" value={`${q.data.fluidBalance24h.net > 0 ? '+' : ''}${q.data.fluidBalance24h.net} ml`} tone={Math.abs(q.data.fluidBalance24h.net) > 1500 ? 'red' : 'gray'} />
      </div>
      <ErrorText error={post.error} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'notes', label: 'Notes & rounds' }, { key: 'vitals', label: 'Vitals' }, { key: 'mar', label: 'Medication (MAR)' }, { key: 'fluids', label: 'Fluid chart' }, { key: 'orders', label: 'Orders' }, { key: 'discharge', label: active ? 'Discharge' : 'Discharge summary' }]} />
      {tab === 'notes' && (
        <Card>
          {active && (
            <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
              <Select className="max-w-60" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })}>
                {can('nursing.record') && <><option value="nursing">Nursing note</option><option value="handover">Handover</option></>}
                {can('consultation.create') && <><option value="doctor_round">Doctor's round</option><option value="progress">Progress note</option></>}
              </Select>
              <Textarea value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
              <Button onClick={() => post.mutate({ path: 'notes', body: note })} disabled={note.text.length < 2}>Add note</Button>
            </div>
          )}
          <ul className="space-y-3">{q.data.notes.map((n) => <li key={n._id} className="text-sm"><p className="muted text-xs">{fmtDateTime(n.createdAt)} · <Badge tone={n.kind === 'doctor_round' || n.kind === 'progress' ? 'purple' : 'blue'}>{n.kind.replace('_', ' ')}</Badge> · {n.byName}</p><p className="whitespace-pre-wrap">{n.text}</p></li>)}</ul>
        </Card>
      )}
      {tab === 'vitals' && (
        <Card>
          {active && can('nursing.record', 'opd.create') && <div className="mb-4 border-b border-[var(--border)] pb-4"><VitalsForm admissionId={id} onSaved={refresh} /></div>}
          <Table head={['Time', 'T°C', 'Pulse', 'RR', 'BP', 'SpO₂', 'Flags', 'By']} empty={q.data.vitals.length === 0}>
            {q.data.vitals.map((v) => <tr key={v._id}><Td>{fmtDateTime(v.recordedAt)}</Td><Td>{v.temperatureC ?? '—'}</Td><Td>{v.pulse ?? '—'}</Td><Td>{v.respiratoryRate ?? '—'}</Td><Td>{v.systolic ? `${v.systolic}/${v.diastolic}` : '—'}</Td><Td>{v.spo2 ?? '—'}</Td><Td className="text-xs text-red-600">{v.flags?.join(', ')}</Td><Td>{v.recordedByName}</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'mar' && (
        <Card>
          {active && can('nursing.record') && (
            <div className="mb-4 grid gap-2 border-b border-[var(--border)] pb-4 sm:grid-cols-[2fr_1fr_1fr_1fr_2fr_auto]">
              <Input placeholder="Drug" value={mar.drugName} onChange={(e) => setMar({ ...mar, drugName: e.target.value })} />
              <Input placeholder="Dose" value={mar.dose} onChange={(e) => setMar({ ...mar, dose: e.target.value })} />
              <Input placeholder="Route" value={mar.route} onChange={(e) => setMar({ ...mar, route: e.target.value })} />
              <Select value={mar.status} onChange={(e) => setMar({ ...mar, status: e.target.value })}><option value="given">Given</option><option value="held">Held</option><option value="refused">Refused</option><option value="missed">Missed</option></Select>
              <Input placeholder={mar.status === 'given' ? 'Notes' : 'Reason (required)'} value={mar.notes} onChange={(e) => setMar({ ...mar, notes: e.target.value })} />
              <Button onClick={() => post.mutate({ path: 'mar', body: { ...mar, dose: mar.dose || undefined, route: mar.route || undefined, notes: mar.notes || undefined } })} disabled={mar.drugName.length < 2}>Record</Button>
            </div>
          )}
          <Table head={['Time', 'Drug', 'Dose', 'Route', 'Status', 'By', 'Notes']} empty={q.data.mar.length === 0}>
            {q.data.mar.map((m) => <tr key={m._id}><Td>{fmtDateTime(m.givenAt)}</Td><Td>{m.drugName}</Td><Td>{m.dose}</Td><Td>{m.route}</Td><Td><Badge tone={m.status === 'given' ? 'green' : 'amber'}>{m.status}</Badge></Td><Td>{m.byName}</Td><Td className="text-xs">{m.notes}</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'fluids' && (
        <Card>
          {active && can('nursing.record') && (
            <div className="mb-4 grid gap-2 border-b border-[var(--border)] pb-4 sm:grid-cols-4">
              <Select value={fluid.direction} onChange={(e) => setFluid({ ...fluid, direction: e.target.value })}><option value="intake">Intake</option><option value="output">Output</option></Select>
              <Input placeholder="Route (IV, oral, urine, drain…)" value={fluid.route} onChange={(e) => setFluid({ ...fluid, route: e.target.value })} />
              <Input type="number" placeholder="Volume (ml)" value={fluid.volumeMl} onChange={(e) => setFluid({ ...fluid, volumeMl: e.target.value })} />
              <Button onClick={() => post.mutate({ path: 'fluids', body: { ...fluid, volumeMl: Number(fluid.volumeMl) } })} disabled={!fluid.volumeMl}>Add</Button>
            </div>
          )}
          <Table head={['Time', 'Direction', 'Route', 'Volume']} empty={q.data.fluids.length === 0}>
            {q.data.fluids.map((f) => <tr key={f._id}><Td>{fmtDateTime(f.at)}</Td><Td className="capitalize">{f.direction}</Td><Td>{f.route}</Td><Td>{f.volumeMl} ml</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'orders' && (a.visitId ? <VisitOrders visitId={a.visitId} patientId={p._id} open={active} /> : <p className="muted">No linked visit.</p>)}
      {tab === 'discharge' && (
        <Card>
          {active && can('inpatient.discharge') ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Outcome"><Select value={dis.outcome} onChange={(e) => setDis({ ...dis, outcome: e.target.value })}>{['recovered', 'improved', 'referred', 'against_advice', 'absconded', 'deceased'].map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}</Select></Field>
              <Field label="Final diagnosis"><Input value={dis.finalDiagnosis} onChange={(e) => setDis({ ...dis, finalDiagnosis: e.target.value })} /></Field>
              <Field label="Discharge summary" className="col-span-full"><Textarea rows={6} value={dis.summary} onChange={(e) => setDis({ ...dis, summary: e.target.value })} /></Field>
              <Field label="Discharge medications"><Textarea rows={3} value={dis.dischargeMedications} onChange={(e) => setDis({ ...dis, dischargeMedications: e.target.value })} /></Field>
              <Field label="Follow-up"><Textarea rows={3} value={dis.followUp} onChange={(e) => setDis({ ...dis, followUp: e.target.value })} /></Field>
              <div className="col-span-full"><Button onClick={() => post.mutate({ path: 'discharge', body: { ...dis, dischargeMedications: dis.dischargeMedications || undefined, followUp: dis.followUp || undefined } })} disabled={dis.summary.length < 10 || dis.finalDiagnosis.length < 2} loading={post.isPending}>Discharge (bed-day charges posted)</Button></div>
            </div>
          ) : a.discharge ? (
            <KV items={[['Outcome', a.discharge.outcome], ['Discharged', fmtDateTime(a.discharge.at)], ['By', a.discharge.byName], ['Final diagnosis', a.discharge.finalDiagnosis], ['Summary', a.discharge.summary]]} />
          ) : <p className="muted text-sm">Not discharged.</p>}
        </Card>
      )}
      <Modal open={transfer} onClose={() => setTransfer(false)} title="Transfer patient">
        <div className="space-y-3">
          <Field label="Ward"><Select value={toBed.wardId} onChange={(e) => setToBed({ ...toBed, wardId: e.target.value, bedId: '' })}><option value="">Select…</option>{wards.data?.map((w) => <option key={w._id} value={w._id}>{w.name} ({w.available} free)</option>)}</Select></Field>
          <Field label="Bed"><Select value={toBed.bedId} onChange={(e) => setToBed({ ...toBed, bedId: e.target.value })}><option value="">Select…</option>{beds.data?.map((b) => <option key={b._id} value={b._id}>{b.number}</option>)}</Select></Field>
          <Field label="Reason"><Input value={toBed.reason} onChange={(e) => setToBed({ ...toBed, reason: e.target.value })} /></Field>
          <Button onClick={() => post.mutate({ path: 'transfer', body: { toBedId: toBed.bedId, reason: toBed.reason } })} disabled={!toBed.bedId || toBed.reason.length < 3}>Transfer</Button>
        </div>
      </Modal>
    </div>
  );
}
