'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, PenLine, Printer } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { REPORT_TYPES, type MedicalReport, type ReportType } from './shared';

interface Form { type: ReportType; addressedTo: string; subject: string; body: string; diagnosis: string; includeDiagnosis: boolean; restFrom: string; restTo: string; fitness: '' | 'fit' | 'fit_with_restrictions' | 'unfit'; fitnessPurpose: string; restrictions: string; reviewDate: string }
const today = () => new Date().toISOString().slice(0, 10);
const blank = (type: ReportType, diagnosis = ''): Form => ({ type, addressedTo: type === 'medical_report' || type === 'attendance' ? 'To whom it may concern' : '', subject: '', body: '', diagnosis, includeDiagnosis: false, restFrom: today(), restTo: today(), fitness: '', fitnessPurpose: '', restrictions: '', reviewDate: '' });
const days = (a: string, b: string) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400_000) + 1 : 0);

/** Sick notes, medical reports, fitness certificates and attendance letters for a visit (or a patient). */
export function MedicalReportsPanel({ visitId, patientId, open = true }: { visitId?: string; patientId: string; open?: boolean }) {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const key = ['medical-reports', visitId ?? patientId];
  const list = useQuery({ queryKey: key, queryFn: async () => (await api<MedicalReport[]>('/medical-reports', { query: visitId ? { visitId } : { patientId } })).data });
  const consults = useQuery({ queryKey: ['consultations', visitId], enabled: !!visitId, queryFn: async () => (await api<Array<{ diagnoses: Array<{ code?: string; display: string }> }>>('/consultations', { query: { visitId } })).data });
  const visitDx = (consults.data ?? []).flatMap((c) => c.diagnoses).map((d) => (d.code ? `${d.display} (${d.code})` : d.display)).join('; ');

  const [editing, setEditing] = useState<{ id?: string; form: Form } | null>(null);
  const [addendum, setAddendum] = useState<{ id: string; text: string } | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: async ({ sign }: { sign: boolean }) => {
      const f = editing!.form;
      const body = {
        type: f.type, visitId, patientId: visitId ? undefined : patientId,
        addressedTo: f.addressedTo, subject: f.subject, body: f.body, diagnosis: f.diagnosis, includeDiagnosis: f.includeDiagnosis,
        restFrom: f.type === 'sick_leave' ? f.restFrom : undefined, restTo: f.type === 'sick_leave' ? f.restTo : undefined,
        fitness: f.type === 'fitness' ? f.fitness || undefined : undefined, fitnessPurpose: f.fitnessPurpose, restrictions: f.restrictions, reviewDate: f.reviewDate || undefined,
      };
      const r = editing!.id ? await api<MedicalReport>(`/medical-reports/${editing!.id}`, { method: 'PUT', body }) : await api<MedicalReport>('/medical-reports', { method: 'POST', body });
      if (sign) await api(`/medical-reports/${r.data._id}/finalize`, { method: 'POST' });
      return { id: r.data._id, sign };
    },
    onSuccess: ({ id, sign }) => { setEditing(null); refresh(); if (sign) window.open(`/print/medical-report/${id}`, '_blank'); },
  });
  const addNote = useMutation({ mutationFn: () => api(`/medical-reports/${addendum!.id}/addendum`, { method: 'POST', body: { text: addendum!.text } }), onSuccess: () => { setAddendum(null); refresh(); } });
  const doVoid = useMutation({ mutationFn: () => api(`/medical-reports/${voiding!.id}/void`, { method: 'POST', body: { reason: voiding!.reason } }), onSuccess: () => { setVoiding(null); refresh(); } });

  const f = editing?.form;
  const set = (p: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));
  const edit = (r: MedicalReport) => setEditing({ id: r._id, form: { type: r.type, addressedTo: r.addressedTo ?? '', subject: r.subject ?? '', body: r.body ?? '', diagnosis: r.diagnosis ?? '', includeDiagnosis: !!r.includeDiagnosis, restFrom: r.restFrom?.slice(0, 10) ?? '', restTo: r.restTo?.slice(0, 10) ?? '', fitness: r.fitness ?? '', fitnessPurpose: r.fitnessPurpose ?? '', restrictions: r.restrictions ?? '', reviewDate: r.reviewDate?.slice(0, 10) ?? '' } });

  return (
    <Card
      title="Medical reports & certificates"
      actions={can('medicalreports.create') && open && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(REPORT_TYPES) as ReportType[]).map((t) => <Button key={t} size="sm" variant="outline" onClick={() => setEditing({ form: blank(t, visitDx) })}><FilePlus2 className="h-3.5 w-3.5" /> {REPORT_TYPES[t].label}</Button>)}
        </div>
      )}
    >
      {list.isLoading ? <Loading /> : list.error ? <ErrorText error={list.error} /> : !list.data?.length ? (
        <p className="muted text-sm">No sick notes, reports or certificates yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.data.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{REPORT_TYPES[r.type].label} <span className="muted font-normal">· {r.reportNumber}</span></p>
                <p className="muted text-xs">
                  {r.type === 'sick_leave' && r.restDays ? `${r.restDays} day(s) from ${fmtDate(r.restFrom)} · ` : ''}
                  {r.authorName} · {fmtDate(r.finalizedAt ?? r.createdAt)}
                  {r.addenda?.length ? ` · ${r.addenda.length} addend${r.addenda.length === 1 ? 'um' : 'a'}` : ''}
                  {r.status === 'void' ? ` · Void: ${r.voidReason}` : ''}
                </p>
              </div>
              <Badge tone={r.status === 'final' ? 'green' : r.status === 'void' ? 'red' : 'amber'}>{r.status === 'final' ? 'Signed' : r.status === 'void' ? 'Void' : 'Draft'}</Badge>
              <div className="flex gap-1.5">
                {r.status === 'draft' && r.authorId === me.data?.user.id && <Button size="sm" variant="outline" onClick={() => edit(r)}><PenLine className="h-3.5 w-3.5" /> Continue</Button>}
                {r.status !== 'void' && <a href={`/print/medical-report/${r._id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--surface-2)]"><Printer className="h-3.5 w-3.5" /> Print</a>}
                {r.status === 'final' && can('medicalreports.create') && <Button size="sm" variant="ghost" onClick={() => setAddendum({ id: r._id, text: '' })}>Addendum</Button>}
                {r.status !== 'void' && can('medicalreports.create') && (r.authorId === me.data?.user.id || can('admin.settings')) && <Button size="sm" variant="ghost" onClick={() => setVoiding({ id: r._id, reason: '' })}>Void</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={f ? REPORT_TYPES[f.type].label : ''} wide>
        {f && (
          <div className="space-y-3">
            <p className="muted text-sm">{REPORT_TYPES[f.type].hint}</p>
            {(f.type === 'medical_report' || f.type === 'attendance' || f.type === 'fitness') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Addressed to"><Input value={f.addressedTo} onChange={(e) => set({ addressedTo: e.target.value })} placeholder="e.g. The Human Resource Manager, ABC Ltd" /></Field>
                <Field label="Subject (optional)"><Input value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></Field>
              </div>
            )}
            {f.type === 'sick_leave' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="First day off *"><Input type="date" value={f.restFrom} onChange={(e) => set({ restFrom: e.target.value })} /></Field>
                <Field label="Last day off *"><Input type="date" value={f.restTo} onChange={(e) => set({ restTo: e.target.value })} /></Field>
                <Field label="Number of days"><div className="field bg-[var(--surface-2)]">{days(f.restFrom, f.restTo) > 0 ? `${days(f.restFrom, f.restTo)} day(s)` : '—'}</div></Field>
              </div>
            )}
            {f.type === 'fitness' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Fit for (purpose)"><Input value={f.fitnessPurpose} onChange={(e) => set({ fitnessPurpose: e.target.value })} placeholder="e.g. employment, school, driving, sports, travel" /></Field>
                <Field label="Result *">
                  <Select value={f.fitness} onChange={(e) => set({ fitness: e.target.value as Form['fitness'] })}>
                    <option value="">Choose…</option><option value="fit">Fit</option><option value="fit_with_restrictions">Fit with restrictions</option><option value="unfit">Not fit</option>
                  </Select>
                </Field>
                {f.fitness === 'fit_with_restrictions' && <Field label="Restrictions *" className="sm:col-span-2"><Textarea rows={2} value={f.restrictions} onChange={(e) => set({ restrictions: e.target.value })} /></Field>}
              </div>
            )}
            <Field label={f.type === 'medical_report' ? 'Report *' : 'Remarks (optional)'}><Textarea rows={f.type === 'medical_report' ? 8 : 3} value={f.body} onChange={(e) => set({ body: e.target.value })} placeholder={f.type === 'medical_report' ? 'History, findings, investigations, treatment, current condition and recommendations.' : ''} /></Field>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includeDiagnosis} onChange={(e) => set({ includeDiagnosis: e.target.checked })} /> Include the diagnosis on the printout</label>
              <p className="muted mt-1 text-xs">Only with the patient’s consent. Sick notes for employers usually leave it out.</p>
              {f.includeDiagnosis && <Input className="mt-2" value={f.diagnosis} onChange={(e) => set({ diagnosis: e.target.value })} placeholder="Diagnosis" />}
            </div>
            <Field label="Review date (optional)"><Input type="date" value={f.reviewDate} onChange={(e) => set({ reviewDate: e.target.value })} /></Field>
            <ErrorText error={save.error} />
            <Alert tone="amber">Once signed, the report cannot be changed. Corrections are added as an addendum, or the report is voided and a new one written.</Alert>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => save.mutate({ sign: false })} loading={save.isPending && !save.variables?.sign}>Save draft</Button>
              <Button onClick={() => save.mutate({ sign: true })} loading={save.isPending && !!save.variables?.sign}>Sign & print</Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!addendum} onClose={() => setAddendum(null)} title="Add an addendum">
        <Textarea rows={4} value={addendum?.text ?? ''} onChange={(e) => setAddendum((a) => (a ? { ...a, text: e.target.value } : a))} placeholder="What needs to be added or corrected" />
        <ErrorText error={addNote.error} />
        <div className="mt-3 flex justify-end"><Button onClick={() => addNote.mutate()} loading={addNote.isPending} disabled={(addendum?.text.trim().length ?? 0) < 3}>Add addendum</Button></div>
      </Modal>
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Void this report">
        <p className="muted mb-2 text-sm">The report stays on record marked VOID and can no longer be printed.</p>
        <Textarea rows={3} value={voiding?.reason ?? ''} onChange={(e) => setVoiding((v) => (v ? { ...v, reason: e.target.value } : v))} placeholder="Reason" />
        <ErrorText error={doVoid.error} />
        <div className="mt-3 flex justify-end"><Button variant="danger" onClick={() => doVoid.mutate()} loading={doVoid.isPending} disabled={(voiding?.reason.trim().length ?? 0) < 5}>Void report</Button></div>
      </Modal>
    </Card>
  );
}
