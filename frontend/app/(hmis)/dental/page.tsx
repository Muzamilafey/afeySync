'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { cn, fmtDateTime } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { ServicePicker } from '@/features/billing/ServicePicker';
import type { Patient } from '@/types/api';

type Tooth = { status: string; surfaces?: string[]; notes?: string };
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const STATUS_STYLE: Record<string, string> = { sound: 'bg-white dark:bg-slate-900', caries: 'bg-red-200 dark:bg-red-900', filled: 'bg-sky-200 dark:bg-sky-900', missing: 'bg-slate-300 dark:bg-slate-700 line-through', extracted: 'bg-slate-400 dark:bg-slate-600 line-through', crown: 'bg-amber-200 dark:bg-amber-900', root_canal: 'bg-violet-200 dark:bg-violet-900', fractured: 'bg-orange-200 dark:bg-orange-900', implant: 'bg-emerald-200 dark:bg-emerald-900', bridge: 'bg-teal-200 dark:bg-teal-900', impacted: 'bg-pink-200 dark:bg-pink-900' };
interface DentalVisit { _id: string; diagnosis?: string; examination?: string; dentistName?: string; createdAt: string; treatmentPlan: Array<{ _id: string; tooth?: string; procedure: string; serviceCode?: string; status: string }> }

export default function DentalPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Tooth>({ status: 'sound', surfaces: [] });
  const [visitOpen, setVisitOpen] = useState(false);
  const [visit, setVisit] = useState({ examination: '', diagnosis: '', notes: '' });
  const [plan, setPlan] = useState<Array<{ tooth: string; procedure: string; serviceCode?: string }>>([]);
  const q = useQuery({ queryKey: ['dental', patient?._id], queryFn: async () => (await api<{ teeth: Record<string, Tooth>; visits: DentalVisit[] }>(`/dental/patients/${patient!._id}/chart`)).data, enabled: !!patient });
  const refresh = () => qc.invalidateQueries({ queryKey: ['dental', patient?._id] });
  const saveTooth = useMutation({ mutationFn: () => api(`/dental/patients/${patient!._id}/chart`, { method: 'PUT', body: { teeth: { [sel!]: edit } } }), onSuccess: () => { setSel(null); refresh(); } });
  const createVisit = useMutation({ mutationFn: () => api('/dental/visits', { method: 'POST', body: { patientId: patient!._id, ...visit, treatmentPlan: plan.map((p) => ({ ...p, tooth: p.tooth || undefined })) } }), onSuccess: () => { setVisitOpen(false); setPlan([]); refresh(); } });
  const planAct = useMutation({ mutationFn: ({ v, i, a }: { v: string; i: string; a: string }) => api(`/dental/visits/${v}/plan/${i}/${a}`, { method: 'POST' }), onSuccess: refresh });
  const teeth = q.data?.teeth ?? {};
  const toothBtn = (n: number) => {
    const t = teeth[String(n)];
    return (
      <button key={n} onClick={() => { if (can('dental.manage')) { setSel(String(n)); setEdit(t ?? { status: 'sound', surfaces: [] }); } }} className={cn('flex h-12 w-9 flex-col items-center justify-center rounded border border-[var(--border)] text-[10px] font-semibold', STATUS_STYLE[t?.status ?? 'sound'])} title={t ? `${t.status} ${t.surfaces?.join('') ?? ''}` : 'sound'}>
        {n}<span className="font-normal">{t?.surfaces?.join('')}</span>
      </button>
    );
  };
  return (
    <>
      <PageHeader title="Dental" crumbs={['Dental']} actions={patient && can('dental.manage') && <Button onClick={() => setVisitOpen(true)}><Plus className="h-4 w-4" /> Dental visit</Button>} />
      <Card className="mb-5"><Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field></Card>
      {patient && (
        <div className="grid gap-5 xl:grid-cols-[auto_1fr]">
          <Card title="Dental chart (FDI)">
            <div className="space-y-2 overflow-x-auto">
              <div className="flex gap-1">{UPPER.map(toothBtn)}</div>
              <div className="flex gap-1">{LOWER.map(toothBtn)}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1 text-xs">{Object.keys(STATUS_STYLE).map((s) => <span key={s} className={cn('rounded border border-[var(--border)] px-1.5', STATUS_STYLE[s])}>{s.replace('_', ' ')}</span>)}</div>
          </Card>
          <Card title="Visits & treatment plans">
            <ErrorText error={planAct.error} />
            {(q.data?.visits ?? []).length === 0 && <p className="muted text-sm">No dental visits.</p>}
            {q.data?.visits.map((v) => (
              <div key={v._id} className="mb-3 rounded border border-[var(--border)] p-3 text-sm">
                <p className="muted text-xs">{fmtDateTime(v.createdAt)} · {v.dentistName}</p>
                {v.diagnosis && <p><strong>Dx:</strong> {v.diagnosis}</p>}
                {v.examination && <p className="whitespace-pre-wrap">{v.examination}</p>}
                <ul className="mt-2 space-y-1">
                  {v.treatmentPlan.map((t) => (
                    <li key={t._id} className="flex items-center justify-between gap-2">
                      <span>{t.tooth && <Badge>{t.tooth}</Badge>} {t.procedure} <span className="muted text-xs">{t.serviceCode}</span></span>
                      <span className="flex items-center gap-1"><Badge tone={t.status === 'done' ? 'green' : t.status === 'cancelled' ? 'gray' : 'amber'}>{t.status}</Badge>{t.status === 'planned' && can('dental.manage') && <><Button size="sm" onClick={() => planAct.mutate({ v: v._id, i: t._id, a: 'done' })}>Done</Button><Button size="sm" variant="ghost" onClick={() => planAct.mutate({ v: v._id, i: t._id, a: 'cancel' })}>Cancel</Button></>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        </div>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Tooth ${sel}`}>
        <div className="space-y-3">
          <Field label="Condition"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
          <div className="flex gap-2 text-sm">{['M', 'O', 'D', 'B', 'L'].map((sfc) => <label key={sfc} className="flex items-center gap-1"><input type="checkbox" checked={edit.surfaces?.includes(sfc) ?? false} onChange={(e) => setEdit({ ...edit, surfaces: e.target.checked ? [...(edit.surfaces ?? []), sfc] : (edit.surfaces ?? []).filter((x) => x !== sfc) })} />{sfc}</label>)}</div>
          <Field label="Notes"><Input value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <ErrorText error={saveTooth.error} />
          <Button onClick={() => saveTooth.mutate()} loading={saveTooth.isPending}>Save</Button>
        </div>
      </Modal>
      <Modal open={visitOpen} onClose={() => setVisitOpen(false)} title="Dental visit" wide>
        <div className="space-y-3">
          <Field label="Examination"><Textarea rows={3} value={visit.examination} onChange={(e) => setVisit({ ...visit, examination: e.target.value })} /></Field>
          <Field label="Diagnosis"><Input value={visit.diagnosis} onChange={(e) => setVisit({ ...visit, diagnosis: e.target.value })} /></Field>
          <p className="label">Treatment plan</p>
          {plan.map((p, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_120px_auto] gap-2">
              <Input placeholder="Tooth" value={p.tooth} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, tooth: e.target.value } : x)))} />
              <Input placeholder="Procedure" value={p.procedure} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, procedure: e.target.value } : x)))} />
              <span className="self-center font-mono text-xs">{p.serviceCode ?? '—'}</span>
              <Button variant="ghost" onClick={() => setPlan(plan.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <ServicePicker onPick={(s) => setPlan([...plan, { tooth: '', procedure: s.name, serviceCode: s.code }])} />
          <Button size="sm" variant="outline" onClick={() => setPlan([...plan, { tooth: '', procedure: '' }])}>Add unbilled item</Button>
          <Field label="Notes"><Input value={visit.notes} onChange={(e) => setVisit({ ...visit, notes: e.target.value })} /></Field>
          <ErrorText error={createVisit.error} />
          <Button onClick={() => createVisit.mutate()} loading={createVisit.isPending}>Save visit</Button>
        </div>
      </Modal>
    </>
  );
}
