'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Select, Stat, Table, Tabs, Td } from '@/components/ui';
import { age, fmtDate, fmtDateTime } from '@/lib/utils';
import Link from 'next/link';

interface Entry { at: string; cervicalDilationCm?: number; descentFifths?: number; contractionsPer10?: number; fetalHeartRate?: number; liquor?: string; systolic?: number; diastolic?: number; maternalPulse?: number; temperatureC?: number; alerts: string[] }
interface Bundle {
  pregnancy: { _id: string; ancNumber: string; lmp?: string; edd?: string; gravida: number; para: number; riskLevel: string; riskFactors: string[]; status: string; bloodGroup?: string; hivStatus?: string; gestation?: { weeks: number; days: number } | null };
  patient: { _id: string; firstName: string; lastName: string; patientNumber: string; dateOfBirth?: string; phone?: string };
  anc: Array<{ _id: string; contactNumber: number; gestationWeeks?: number; weightKg?: number; systolic?: number; diastolic?: number; fundalHeightCm?: number; fetalHeartRate?: number; haemoglobin?: number; notes?: string; createdAt: string; byName?: string }>;
  labour: { _id: string; status: string; startedAt: string; activePhaseAt?: string; partograph: Entry[] } | null;
  delivery: { deliveredAt: string; mode: string; bloodLossMl?: number; complications: string[]; babies: Array<{ sex: string; birthWeightGrams: number; apgar1?: number; apgar5?: number; outcome: string; newbornPatientId?: string }> } | null;
}
type Tab = 'anc' | 'labour' | 'delivery';

function Partograph({ labour }: { labour: NonNullable<Bundle['labour']> }) {
  const start = labour.activePhaseAt ? new Date(labour.activePhaseAt).getTime() : null;
  const data = labour.partograph.map((e) => ({ h: start ? Math.round(((new Date(e.at).getTime() - start) / 3600_000) * 10) / 10 : 0, dilation: e.cervicalDilationCm, fhr: e.fetalHeartRate }));
  const alertLine = start ? [{ h: 0, v: 4 }, { h: 6, v: 10 }] : [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-64">
        <p className="label">Cervical dilation (cm) vs hours from active phase — alert (amber) and action (red) lines</p>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="h" type="number" domain={[0, 12]} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
            <Tooltip />
            {alertLine.length > 0 && <ReferenceLine segment={[{ x: 0, y: 4 }, { x: 6, y: 10 }]} stroke="#f59e0b" strokeWidth={2} />}
            {alertLine.length > 0 && <ReferenceLine segment={[{ x: 4, y: 4 }, { x: 10, y: 10 }]} stroke="#ef4444" strokeWidth={2} />}
            <Line dataKey="dilation" stroke="#0b8a72" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-64">
        <p className="label">Fetal heart rate (normal 110–160)</p>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="h" type="number" domain={[0, 12]} tick={{ fontSize: 11 }} />
            <YAxis domain={[80, 200]} tick={{ fontSize: 11 }} />
            <ReferenceLine y={110} stroke="#ef4444" strokeDasharray="4 4" />
            <ReferenceLine y={160} stroke="#ef4444" strokeDasharray="4 4" />
            <Tooltip />
            <Line dataKey="fhr" stroke="#0284c7" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function PregnancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('anc');
  const [anc, setAnc] = useState<Record<string, string>>({});
  const [pg, setPg] = useState<Record<string, string>>({});
  const [del, setDel] = useState({ mode: 'SVD', deliveredAt: '', bloodLossMl: '', indication: '', csType: 'emergency', placenta: 'Complete', perineum: 'Intact', attendantName: '' });
  const [babies, setBabies] = useState([{ sex: 'female', birthWeightGrams: '', apgar1: '', apgar5: '', outcome: 'live_birth' }]);
  const q = useQuery({ queryKey: ['pregnancy', id], queryFn: async () => (await api<Bundle>(`/maternity/pregnancies/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pregnancy', id] });
  const num = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => [k, ['presentation', 'urineProtein', 'fetalMovement', 'notes', 'liquor', 'moulding', 'oxytocin', 'drugs', 'urine'].includes(k) ? v : Number(v)]));
  const addAnc = useMutation({ mutationFn: () => api(`/maternity/pregnancies/${id}/anc`, { method: 'POST', body: num(anc) }), onSuccess: () => { setAnc({}); refresh(); } });
  const startLabour = useMutation({ mutationFn: () => api(`/maternity/pregnancies/${id}/labour`, { method: 'POST', body: {} }), onSuccess: refresh });
  const addPg = useMutation({ mutationFn: () => api<{ alerts: string[] }>(`/maternity/labour/${q.data!.labour!._id}/partograph`, { method: 'POST', body: num(pg) }), onSuccess: () => { setPg({}); refresh(); } });
  const deliver = useMutation({
    mutationFn: () => api<{ flags: string[] }>(`/maternity/pregnancies/${id}/delivery`, { method: 'POST', body: { mode: del.mode, deliveredAt: del.deliveredAt ? new Date(del.deliveredAt).toISOString() : new Date().toISOString(), bloodLossMl: del.bloodLossMl ? Number(del.bloodLossMl) : undefined, placenta: del.placenta, perineum: del.perineum, attendantName: del.attendantName || undefined, cSection: del.mode === 'c_section' ? { indication: del.indication, type: del.csType } : undefined, babies: babies.map((b) => ({ sex: b.sex, birthWeightGrams: Number(b.birthWeightGrams), apgar1: b.apgar1 ? Number(b.apgar1) : undefined, apgar5: b.apgar5 ? Number(b.apgar5) : undefined, outcome: b.outcome })) } }),
    onSuccess: refresh,
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const { pregnancy: p, patient } = q.data;
  const manage = can('maternity.manage');
  const lastAlerts = q.data.labour?.partograph.at(-1)?.alerts ?? [];
  return (
    <div className="space-y-5">
      <section className="surface rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <Link href={`/patients/${patient._id}`} className="text-xl font-semibold uppercase hover:underline">{patient.firstName} {patient.lastName}</Link>
            <p className="muted text-sm">{age(patient.dateOfBirth)} · {patient.patientNumber} · {p.ancNumber} · G{p.gravida} P{p.para} {p.bloodGroup && `· ${p.bloodGroup}`}</p>
            <div className="mt-2 flex flex-wrap gap-2"><Badge tone={p.riskLevel === 'high' ? 'red' : p.riskLevel === 'moderate' ? 'amber' : 'green'}>{p.riskLevel} risk</Badge>{p.riskFactors.map((r) => <Badge key={r}>{r}</Badge>)}</div>
          </div>
          <Badge tone="blue">{p.status.replace('_', ' ')}</Badge>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Gestation" value={p.gestation ? `${p.gestation.weeks}w ${p.gestation.days}d` : '—'} />
        <Stat label="EDD" value={fmtDate(p.edd)} />
        <Stat label="ANC contacts" value={q.data.anc.length} tone={q.data.anc.length >= 8 ? 'green' : 'amber'} hint="WHO recommends ≥ 8 contacts" />
        <Stat label="LMP" value={fmtDate(p.lmp)} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'anc', label: 'Antenatal care' }, { key: 'labour', label: 'Labour & partograph' }, { key: 'delivery', label: 'Delivery & newborn' }]} />
      {tab === 'anc' && (
        <Card>
          {manage && p.status === 'active' && (
            <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[['weightKg', 'Weight kg'], ['systolic', 'Systolic'], ['diastolic', 'Diastolic'], ['fundalHeightCm', 'Fundal ht cm'], ['fetalHeartRate', 'FHR'], ['haemoglobin', 'Hb g/dL'], ['urineProtein', 'Urine protein'], ['presentation', 'Presentation'], ['fetalMovement', 'Fetal movement']].map(([k, l]) => <Field key={k} label={l}><Input value={anc[k] ?? ''} onChange={(e) => setAnc({ ...anc, [k]: e.target.value })} /></Field>)}
                <Field label="Next visit"><Input type="date" value={anc.nextVisit ?? ''} onChange={(e) => setAnc({ ...anc, nextVisit: e.target.value })} /></Field>
              </div>
              <Field label="Notes"><Input value={anc.notes ?? ''} onChange={(e) => setAnc({ ...anc, notes: e.target.value })} /></Field>
              <ErrorText error={addAnc.error} />
              <Button onClick={() => addAnc.mutate()} loading={addAnc.isPending}>Record ANC contact</Button>
            </div>
          )}
          <Table head={['#', 'Date', 'GA', 'Wt', 'BP', 'FH', 'FHR', 'Hb', 'Notes / flags']} empty={q.data.anc.length === 0}>
            {q.data.anc.map((v) => <tr key={v._id}><Td>{v.contactNumber}</Td><Td>{fmtDate(v.createdAt)}</Td><Td>{v.gestationWeeks ?? '—'}w</Td><Td>{v.weightKg ?? '—'}</Td><Td>{v.systolic ? `${v.systolic}/${v.diastolic}` : '—'}</Td><Td>{v.fundalHeightCm ?? '—'}</Td><Td>{v.fetalHeartRate ?? '—'}</Td><Td>{v.haemoglobin ?? '—'}</Td><Td className="text-xs whitespace-pre-wrap">{v.notes}</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'labour' && (
        <Card>
          {!q.data.labour && manage && p.status === 'active' && <Button onClick={() => startLabour.mutate()}>Start labour record</Button>}
          {q.data.labour && (
            <div className="space-y-4">
              {lastAlerts.map((a) => <Alert key={a} tone={/ACTION/.test(a) ? 'red' : 'amber'}>{a}</Alert>)}
              <Partograph labour={q.data.labour} />
              {manage && q.data.labour.status === 'in_progress' && (
                <div className="space-y-2 border-t border-[var(--border)] pt-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                    {[['cervicalDilationCm', 'Dilation cm'], ['descentFifths', 'Descent /5'], ['contractionsPer10', 'Contr./10min'], ['fetalHeartRate', 'FHR'], ['liquor', 'Liquor (C/M/B/I)'], ['moulding', 'Moulding'], ['maternalPulse', 'Pulse'], ['systolic', 'Systolic'], ['diastolic', 'Diastolic'], ['temperatureC', 'Temp'], ['oxytocin', 'Oxytocin'], ['drugs', 'Drugs/IV']].map(([k, l]) => <Field key={k} label={l}><Input value={pg[k] ?? ''} onChange={(e) => setPg({ ...pg, [k]: e.target.value })} /></Field>)}
                  </div>
                  <ErrorText error={addPg.error} />
                  <Button onClick={() => addPg.mutate()} loading={addPg.isPending}>Add partograph entry</Button>
                </div>
              )}
              <Table head={['Time', 'Dil.', 'Desc.', 'Contr.', 'FHR', 'Liquor', 'BP', 'Alerts']}>
                {q.data.labour.partograph.map((e, i) => <tr key={i}><Td>{fmtDateTime(e.at)}</Td><Td>{e.cervicalDilationCm ?? '—'}</Td><Td>{e.descentFifths ?? '—'}</Td><Td>{e.contractionsPer10 ?? '—'}</Td><Td>{e.fetalHeartRate ?? '—'}</Td><Td>{e.liquor ?? '—'}</Td><Td>{e.systolic ? `${e.systolic}/${e.diastolic}` : '—'}</Td><Td className="text-xs text-red-600">{e.alerts.join('; ')}</Td></tr>)}
              </Table>
            </div>
          )}
        </Card>
      )}
      {tab === 'delivery' && (
        <Card>
          {q.data.delivery ? (
            <div className="space-y-3">
              <KV items={[['Delivered', fmtDateTime(q.data.delivery.deliveredAt)], ['Mode', q.data.delivery.mode.replace('_', ' ')], ['Blood loss', `${q.data.delivery.bloodLossMl ?? '—'} ml`], ['Complications / flags', q.data.delivery.complications.join('; ') || 'None']]} />
              <Table head={['Baby', 'Sex', 'Weight (g)', 'APGAR 1/5', 'Outcome', '']}>
                {q.data.delivery.babies.map((b, i) => <tr key={i}><Td>{i + 1}</Td><Td className="capitalize">{b.sex}</Td><Td className={b.birthWeightGrams < 2500 ? 'font-semibold text-red-600' : ''}>{b.birthWeightGrams}</Td><Td>{b.apgar1 ?? '—'}/{b.apgar5 ?? '—'}</Td><Td>{b.outcome.replace(/_/g, ' ')}</Td><Td>{b.newbornPatientId && <Link href={`/patients/${b.newbornPatientId}`} className="text-brand-600">Newborn record</Link>}</Td></tr>)}
              </Table>
            </div>
          ) : manage && ['active', 'in_labour'].includes(p.status) ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Mode"><Select value={del.mode} onChange={(e) => setDel({ ...del, mode: e.target.value })}><option value="SVD">SVD</option><option value="assisted_vacuum">Vacuum</option><option value="assisted_forceps">Forceps</option><option value="breech">Breech</option><option value="c_section">Caesarean section</option></Select></Field>
                <Field label="Delivered at"><Input type="datetime-local" value={del.deliveredAt} onChange={(e) => setDel({ ...del, deliveredAt: e.target.value })} /></Field>
                <Field label="Blood loss (ml)"><Input type="number" value={del.bloodLossMl} onChange={(e) => setDel({ ...del, bloodLossMl: e.target.value })} /></Field>
                {del.mode === 'c_section' && <><Field label="CS indication"><Input value={del.indication} onChange={(e) => setDel({ ...del, indication: e.target.value })} /></Field><Field label="CS type"><Select value={del.csType} onChange={(e) => setDel({ ...del, csType: e.target.value })}><option value="emergency">Emergency</option><option value="elective">Elective</option></Select></Field></>}
                <Field label="Placenta"><Input value={del.placenta} onChange={(e) => setDel({ ...del, placenta: e.target.value })} /></Field>
                <Field label="Perineum"><Input value={del.perineum} onChange={(e) => setDel({ ...del, perineum: e.target.value })} /></Field>
                <Field label="Attendant"><Input value={del.attendantName} onChange={(e) => setDel({ ...del, attendantName: e.target.value })} /></Field>
              </div>
              <p className="label">Babies</p>
              {babies.map((b, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Select value={b.sex} onChange={(e) => setBabies(babies.map((x, j) => (j === i ? { ...x, sex: e.target.value } : x)))}><option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option></Select>
                  <Input placeholder="Weight (g)" type="number" value={b.birthWeightGrams} onChange={(e) => setBabies(babies.map((x, j) => (j === i ? { ...x, birthWeightGrams: e.target.value } : x)))} />
                  <Input placeholder="APGAR 1'" type="number" value={b.apgar1} onChange={(e) => setBabies(babies.map((x, j) => (j === i ? { ...x, apgar1: e.target.value } : x)))} />
                  <Input placeholder="APGAR 5'" type="number" value={b.apgar5} onChange={(e) => setBabies(babies.map((x, j) => (j === i ? { ...x, apgar5: e.target.value } : x)))} />
                  <Select value={b.outcome} onChange={(e) => setBabies(babies.map((x, j) => (j === i ? { ...x, outcome: e.target.value } : x)))}><option value="live_birth">Live birth</option><option value="fresh_stillbirth">Fresh stillbirth</option><option value="macerated_stillbirth">Macerated stillbirth</option><option value="neonatal_death">Neonatal death</option></Select>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setBabies([...babies, { sex: 'female', birthWeightGrams: '', apgar1: '', apgar5: '', outcome: 'live_birth' }])}>Add baby (multiple birth)</Button>
              <ErrorText error={deliver.error} />
              <Button onClick={() => deliver.mutate()} loading={deliver.isPending} disabled={babies.some((b) => !b.birthWeightGrams)}>Record delivery</Button>
              <p className="muted text-xs">Live-born babies are registered as patients immediately and linked to the mother.</p>
            </div>
          ) : <p className="muted text-sm">No delivery recorded.</p>}
        </Card>
      )}
    </div>
  );
}
