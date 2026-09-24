'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, statusTone, Table, Tabs, Td, Textarea } from '@/components/ui';
import { age, fmtDate } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import type { Patient } from '@/types/api';

type Tab = 'immunization' | 'growth' | 'defaulters' | 'fp' | 'fp-defaulters';
interface Sched { vaccine: string; dose: number; ageDays: number; regional?: boolean; dueDate: string; givenAt?: string; status: string }
const FP_METHODS: Array<[string, string]> = [['coc_pills', 'Combined pills'], ['pop_pills', 'Progestin-only pills'], ['injectable_dmpa', 'Injectable (DMPA)'], ['implant', 'Implant'], ['iucd', 'IUCD'], ['condoms', 'Condoms'], ['emergency_pill', 'Emergency pill'], ['btl', 'Tubal ligation'], ['vasectomy', 'Vasectomy'], ['lam', 'LAM'], ['natural', 'Natural methods'], ['counselling_only', 'Counselling only']];

function Immunization({ patient }: { patient: Patient }) {
  const can = useCan();
  const qc = useQueryClient();
  const [batch, setBatch] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['imm', patient._id], queryFn: async () => (await api<{ schedule: Sched[] }>(`/mch/patients/${patient._id}/immunizations`)).data });
  const give = useMutation({ mutationFn: (s: Sched) => api('/mch/immunizations', { method: 'POST', body: { patientId: patient._id, vaccine: s.vaccine, dose: s.dose, batchNumber: batch[`${s.vaccine}${s.dose}`] || undefined } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['imm', patient._id] }) });
  if (!patient.dateOfBirth) return <p className="muted text-sm">Record the child’s date of birth to compute the schedule.</p>;
  return (
    <>
      <ErrorText error={give.error} />
      <Table head={['Vaccine', 'Dose', 'Due', 'Status', 'Given', '']}>
        {q.data?.schedule.map((s) => (
          <tr key={`${s.vaccine}${s.dose}`}>
            <Td>{s.vaccine}{s.regional && <Badge className="ml-1">regional</Badge>}</Td><Td>{s.dose}</Td><Td>{fmtDate(s.dueDate)}</Td>
            <Td><Badge tone={s.status === 'given' ? 'green' : s.status === 'overdue' ? 'red' : s.status === 'due' ? 'amber' : 'gray'}>{s.status}</Badge></Td>
            <Td>{fmtDate(s.givenAt)}</Td>
            <Td className="whitespace-nowrap">{s.status !== 'given' && s.status !== 'upcoming' && can('mch.manage') && <><Input className="inline-block w-28" placeholder="Batch" value={batch[`${s.vaccine}${s.dose}`] ?? ''} onChange={(e) => setBatch({ ...batch, [`${s.vaccine}${s.dose}`]: e.target.value })} /> <Button size="sm" onClick={() => give.mutate(s)}>Give</Button></>}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function Growth({ patient }: { patient: Patient }) {
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = useState({ weightKg: '', heightCm: '', muacCm: '', headCircumferenceCm: '' });
  const q = useQuery({ queryKey: ['growth', patient._id], queryFn: async () => (await api<Array<{ _id: string; measuredAt: string; ageMonths?: number; weightKg?: number; heightCm?: number; muacCm?: number; nutritionStatus?: string }>>(`/mch/patients/${patient._id}/growth`)).data });
  const add = useMutation({ mutationFn: () => api('/mch/growth', { method: 'POST', body: { patientId: patient._id, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])) } }), onSuccess: () => { setF({ weightKg: '', heightCm: '', muacCm: '', headCircumferenceCm: '' }); qc.invalidateQueries({ queryKey: ['growth', patient._id] }); } });
  return (
    <div className="space-y-4">
      {can('mch.manage') && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([['weightKg', 'Weight kg'], ['heightCm', 'Length/height cm'], ['muacCm', 'MUAC cm'], ['headCircumferenceCm', 'Head circ. cm']] as const).map(([k, l]) => <Field key={k} label={l}><Input type="number" step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <div className="flex items-end"><Button onClick={() => add.mutate()} loading={add.isPending}>Record</Button></div>
        </div>
      )}
      <ErrorText error={add.error} />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={q.data ?? []}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="ageMonths" tick={{ fontSize: 11 }} label={{ value: 'age (months)', position: 'insideBottom', offset: -2, fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line dataKey="weightKg" name="Weight (kg)" stroke="#0b8a72" strokeWidth={2} dot /></LineChart>
        </ResponsiveContainer>
      </div>
      <Table head={['Date', 'Age (m)', 'Weight', 'Height', 'MUAC', 'Nutrition']}>
        {q.data?.map((g) => <tr key={g._id}><Td>{fmtDate(g.measuredAt)}</Td><Td>{g.ageMonths}</Td><Td>{g.weightKg}</Td><Td>{g.heightCm}</Td><Td>{g.muacCm}</Td><Td>{g.nutritionStatus && <Badge tone={/Severe/.test(g.nutritionStatus) ? 'red' : /Moderate/.test(g.nutritionStatus) ? 'amber' : 'green'}>{g.nutritionStatus}</Badge>}</Td></tr>)}
      </Table>
    </div>
  );
}

function FamilyPlanning({ patient }: { patient: Patient }) {
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = useState({ visitType: 'new', method: 'injectable_dmpa', counselling: '', sideEffects: '', quantity: '', batchNumber: '' });
  const q = useQuery({ queryKey: ['fp', patient._id], queryFn: async () => (await api<Array<{ _id: string; method: string; visitType: string; nextDue?: string; createdAt: string; byName?: string }>>('/family-planning/visits', { query: { patientId: patient._id } })).data });
  const add = useMutation({ mutationFn: () => api('/family-planning/visits', { method: 'POST', body: { patientId: patient._id, visitType: f.visitType, method: f.method, counselling: f.counselling || undefined, sideEffects: f.sideEffects || undefined, quantity: f.quantity ? Number(f.quantity) : undefined, batchNumber: f.batchNumber || undefined } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['fp', patient._id] }) });
  return (
    <div className="space-y-4">
      {can('fp.manage') && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Visit"><Select value={f.visitType} onChange={(e) => setF({ ...f, visitType: e.target.value })}><option value="new">New</option><option value="revisit">Revisit</option><option value="switch">Switch</option><option value="removal">Removal</option></Select></Field>
          <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{FP_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Quantity / cycles"><Input type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Counselling" className="sm:col-span-2"><Textarea rows={2} className="min-h-0" value={f.counselling} onChange={(e) => setF({ ...f, counselling: e.target.value })} /></Field>
          <Field label="Batch"><Input value={f.batchNumber} onChange={(e) => setF({ ...f, batchNumber: e.target.value })} /></Field>
          <div className="col-span-full"><ErrorText error={add.error} /><Button onClick={() => add.mutate()} loading={add.isPending}>Record FP visit</Button></div>
        </div>
      )}
      <Table head={['Date', 'Visit', 'Method', 'Next due', 'By']}>
        {q.data?.map((v) => <tr key={v._id}><Td>{fmtDate(v.createdAt)}</Td><Td>{v.visitType}</Td><Td>{FP_METHODS.find(([k]) => k === v.method)?.[1]}</Td><Td>{fmtDate(v.nextDue)}</Td><Td>{v.byName}</Td></tr>)}
      </Table>
    </div>
  );
}

export default function MchPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>(can('mch.view') ? 'immunization' : 'fp');
  const [patient, setPatient] = useState<Patient | null>(null);
  const def = useQuery({ queryKey: ['mch-defaulters'], queryFn: async () => (await api<Array<{ patient: { _id: string; firstName: string; lastName: string; patientNumber: string; dateOfBirth?: string; phone?: string }; overdue: string[] }>>('/mch/defaulters')).data, enabled: tab === 'defaulters' });
  const fpDef = useQuery({ queryKey: ['fp-defaulters'], queryFn: async () => (await api<Array<{ _id: string; method: string; nextDue: string; patientId: { _id: string; firstName: string; lastName: string; phone?: string } }>>('/family-planning/defaulters')).data, enabled: tab === 'fp-defaulters' });
  return (
    <>
      <PageHeader title="MCH & Family Planning" crumbs={['MCH / FP']} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[...(can('mch.view') ? [{ key: 'immunization' as const, label: 'Immunization' }, { key: 'growth' as const, label: 'Growth monitoring' }, { key: 'defaulters' as const, label: 'Immunization defaulters' }] : []), ...(can('fp.view') ? [{ key: 'fp' as const, label: 'Family planning' }, { key: 'fp-defaulters' as const, label: 'FP defaulters' }] : [])]} />
      {['immunization', 'growth', 'fp'].includes(tab) && (
        <Card>
          <Field label={tab === 'fp' ? 'Client' : 'Child'}><PatientPicker value={patient} onChange={setPatient} /></Field>
          {patient && <p className="muted my-2 text-sm capitalize">{patient.gender} · {age(patient.dateOfBirth)} · born {fmtDate(patient.dateOfBirth)}</p>}
          <div className="mt-4">{patient && (tab === 'immunization' ? <Immunization patient={patient} /> : tab === 'growth' ? <Growth patient={patient} /> : <FamilyPlanning patient={patient} />)}</div>
        </Card>
      )}
      {tab === 'defaulters' && (
        <Card>
          {def.isLoading && <Loading />}
          <Table head={['Child', 'Age', 'Phone', 'Overdue']} empty={(def.data ?? []).length === 0}>
            {def.data?.map((r) => <tr key={r.patient._id}><Td><Link href={`/patients/${r.patient._id}`} className="text-brand-600">{r.patient.firstName} {r.patient.lastName}</Link></Td><Td>{age(r.patient.dateOfBirth)}</Td><Td>{r.patient.phone}</Td><Td className="text-xs">{r.overdue.map((o) => <Badge key={o} tone="red" className="mr-1">{o}</Badge>)}</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'fp-defaulters' && (
        <Card>
          <Table head={['Client', 'Phone', 'Method', 'Was due']} empty={(fpDef.data ?? []).length === 0}>
            {fpDef.data?.map((r) => <tr key={r._id}><Td>{r.patientId.firstName} {r.patientId.lastName}</Td><Td>{r.patientId.phone}</Td><Td>{FP_METHODS.find(([k]) => k === r.method)?.[1]}</Td><Td><Badge tone={statusTone('failed')}>{fmtDate(r.nextDue)}</Badge></Td></tr>)}
          </Table>
        </Card>
      )}
    </>
  );
}
