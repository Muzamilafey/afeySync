'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Textarea } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/utils';

export interface Diagnosis { code?: string; display: string; system?: string; type?: string }
export interface Consultation {
  _id: string;
  status: 'draft' | 'final';
  providerId: string;
  providerName?: string;
  chiefComplaint?: string;
  historyOfPresentingIllness?: string;
  reviewOfSystems?: string;
  pastHistory?: string;
  examination?: string;
  assessment?: string;
  diagnoses: Diagnosis[];
  plan?: string;
  followUpDate?: string;
  followUpNotes?: string;
  finalizedAt?: string;
  addenda: Array<{ text: string; reason: string; byName?: string; at: string }>;
  createdAt: string;
}

const SECTIONS: Array<[keyof Consultation, string, number]> = [
  ['chiefComplaint', 'Chief complaint', 2],
  ['historyOfPresentingIllness', 'History of presenting illness', 4],
  ['reviewOfSystems', 'Review of systems', 3],
  ['pastHistory', 'Past medical / surgical / family / social history', 3],
  ['examination', 'Examination', 4],
  ['assessment', 'Assessment', 3],
  ['plan', 'Plan', 3],
];

function DiagnosisPicker({ onAdd }: { onAdd: (d: Diagnosis) => void }) {
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const r = useQuery({ queryKey: ['dx-search', q], queryFn: async () => (await api<Array<{ code?: string; display?: string; system?: string; uses?: number }>>('/opd/diagnoses/search', { query: { q } })), enabled: q.length >= 2 });
  const rows = Array.isArray(r.data?.data) ? r.data!.data : [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[120px_1fr_auto] gap-2">
        <Input placeholder="ICD code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input placeholder="Search diagnosis" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="outline" disabled={q.length < 2} onClick={() => { onAdd({ code: code || undefined, display: q, system: 'ICD-11' }); setQ(''); setCode(''); }}><Plus className="h-4 w-4" /> Add</Button>
      </div>
      {rows.length > 0 && (
        <ul className="surface rounded-md text-sm">
          {rows.map((d, i) => d.display && (
            <li key={i}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[var(--surface-2)]" onClick={() => { onAdd({ code: d.code, display: d.display!, system: d.system ?? 'ICD-11' }); setQ(''); }}>{d.code && <span className="font-mono text-xs">{d.code} </span>}{d.display} {d.uses && <span className="muted text-xs">· used {d.uses}×</span>}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConsultationEditor({ visitId, visitOpen }: { visitId: string; visitOpen: boolean }) {
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['consultations', visitId], queryFn: async () => (await api<Consultation[]>('/consultations', { query: { visitId } })).data });
  const mine = list.data?.find((c) => c.status === 'draft' && c.providerId === me?.user.id);
  const [form, setForm] = useState<Partial<Consultation>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [addendum, setAddendum] = useState({ text: '', reason: '' });
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mine && loadedFor.current !== mine._id) {
      setForm(mine);
      loadedFor.current = mine._id;
    }
  }, [mine]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['consultations', visitId] });
  const start = useMutation({ mutationFn: () => api('/consultations', { method: 'POST', body: { visitId } }), onSuccess: refresh });
  const save = useMutation({
    mutationFn: (patch: Partial<Consultation>) => api(`/consultations/${mine!._id}`, { method: 'PATCH', body: { ...patch, followUpDate: patch.followUpDate || undefined } }),
    onSuccess: () => setSaved(new Date().toLocaleTimeString()),
  });
  const finalize = useMutation({
    mutationFn: async () => {
      await api(`/consultations/${mine!._id}`, { method: 'PATCH', body: pick(form) });
      return api(`/consultations/${mine!._id}/finalize`, { method: 'POST' });
    },
    onSuccess: () => { loadedFor.current = null; refresh(); qc.invalidateQueries({ queryKey: ['visit', visitId] }); },
  });
  const addAddendum = useMutation({ mutationFn: (id: string) => api(`/consultations/${id}/addenda`, { method: 'POST', body: addendum }), onSuccess: () => { setAddendum({ text: '', reason: '' }); refresh(); } });

  const pick = (f: Partial<Consultation>) => ({ chiefComplaint: f.chiefComplaint, historyOfPresentingIllness: f.historyOfPresentingIllness, reviewOfSystems: f.reviewOfSystems, pastHistory: f.pastHistory, examination: f.examination, assessment: f.assessment, diagnoses: f.diagnoses, plan: f.plan, followUpDate: f.followUpDate || undefined, followUpNotes: f.followUpNotes });

  const finals = list.data?.filter((c) => c.status === 'final') ?? [];
  const others = list.data?.filter((c) => c.status === 'draft' && c.providerId !== me?.user.id) ?? [];
  return (
    <div className="space-y-5">
      {finals.map((c) => (
        <Card key={c._id} title={<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Consultation — {c.providerName} · finalized {fmtDateTime(c.finalizedAt)}</span>}>
          <div className="space-y-3 text-sm">
            {SECTIONS.map(([k, label]) => c[k] ? <div key={k}><p className="label">{label}</p><p className="whitespace-pre-wrap">{String(c[k])}</p></div> : null)}
            <div><p className="label">Diagnoses</p><div className="flex flex-wrap gap-2">{c.diagnoses.map((d, i) => <Badge key={i} tone="blue">{d.code && `${d.code} · `}{d.display} ({d.type})</Badge>)}</div></div>
            {c.followUpDate && <KV items={[['Follow-up', fmtDate(c.followUpDate)], ['Notes', c.followUpNotes]]} />}
            {c.addenda.map((a, i) => <Alert key={i} tone="blue" title={`Addendum — ${a.byName}, ${fmtDateTime(a.at)} (${a.reason})`}>{a.text}</Alert>)}
            {can('consultation.create') && (
              <div className="grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-[1fr_220px_auto]">
                <Input placeholder="Addendum text" value={addendum.text} onChange={(e) => setAddendum({ ...addendum, text: e.target.value })} />
                <Input placeholder="Reason" value={addendum.reason} onChange={(e) => setAddendum({ ...addendum, reason: e.target.value })} />
                <Button variant="outline" disabled={addendum.text.length < 3 || addendum.reason.length < 3} onClick={() => addAddendum.mutate(c._id)}>Add addendum</Button>
              </div>
            )}
          </div>
        </Card>
      ))}
      {others.map((c) => <Alert key={c._id} tone="amber">Draft consultation in progress by {c.providerName}.</Alert>)}
      {!mine && visitOpen && can('consultation.create') && <Button onClick={() => start.mutate()} loading={start.isPending}>Start consultation</Button>}
      <ErrorText error={start.error} />
      {mine && (
        <Card title="Consultation (draft)" actions={<span className="muted text-xs">{save.isPending ? 'Saving…' : saved ? `Saved ${saved}` : 'Autosaves when you leave a field'}</span>}>
          <div className="space-y-4">
            {SECTIONS.map(([k, label, rows]) => (
              <Field key={k} label={label}>
                <Textarea rows={rows} className="min-h-0" value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} onBlur={() => save.mutate(pick(form))} />
              </Field>
            ))}
            <div>
              <p className="label">Diagnoses</p>
              <div className="mb-2 flex flex-wrap gap-2">
                {(form.diagnoses ?? []).map((d, i) => (
                  <Badge key={i} tone="blue">
                    {d.code && `${d.code} · `}{d.display}
                    <select className="bg-transparent text-xs" value={d.type ?? 'primary'} onChange={(e) => { const next = [...(form.diagnoses ?? [])]; next[i] = { ...d, type: e.target.value }; setForm({ ...form, diagnoses: next }); save.mutate(pick({ ...form, diagnoses: next })); }}>
                      <option value="primary">primary</option><option value="secondary">secondary</option><option value="provisional">provisional</option>
                    </select>
                    <button onClick={() => { const next = (form.diagnoses ?? []).filter((_, j) => j !== i); setForm({ ...form, diagnoses: next }); save.mutate(pick({ ...form, diagnoses: next })); }} aria-label="Remove diagnosis"><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
              <DiagnosisPicker onAdd={(d) => { const next = [...(form.diagnoses ?? []), { ...d, type: (form.diagnoses ?? []).length ? 'secondary' : 'primary' }]; setForm({ ...form, diagnoses: next }); save.mutate(pick({ ...form, diagnoses: next })); }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Follow-up date"><Input type="date" value={form.followUpDate?.slice(0, 10) ?? ''} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} onBlur={() => save.mutate(pick(form))} /></Field>
              <Field label="Follow-up notes"><Input value={form.followUpNotes ?? ''} onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })} onBlur={() => save.mutate(pick(form))} /></Field>
            </div>
            <ErrorText error={save.error || finalize.error} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => save.mutate(pick(form))} loading={save.isPending}>SAVE DRAFT</Button>
              {can('consultation.finalize') && <Button onClick={() => finalize.mutate()} loading={finalize.isPending}>FINALIZE CONSULTATION</Button>}
            </div>
            <p className="muted text-xs">Finalized consultations cannot be edited; corrections are added as signed addenda.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
