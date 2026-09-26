'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, KV, Loading, PageHeader, statusTone, Textarea } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import type { RadRequest } from '@/features/lab/types';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';

export default function RadiologyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rad-req', id], queryFn: async () => (await api<RadRequest>(`/radiology/requests/${id}`)).data });
  const [sched, setSched] = useState({ scheduledAt: '', room: '' });
  const [rep, setRep] = useState<{ findings: string; impression: string; pacsViewerUrl: string } | null>(null);
  const act = useMutation({ mutationFn: ({ step, body }: { step: string; body?: object }) => api(`/radiology/requests/${id}/${step}`, { method: 'POST', body: body ?? {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rad-req', id] }) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const r = q.data;
  const report = rep ?? { findings: r.report?.findings ?? '', impression: r.report?.impression ?? '', pacsViewerUrl: r.pacsViewerUrl ?? '' };
  return (
    <>
      <PageHeader title={`${r.examName}`} crumbs={['Radiology', r.accessionNumber]} subtitle={<Badge tone={statusTone(r.status === 'verified' ? 'completed' : 'pending')}>{r.status.replace('_', ' ')}</Badge>} />
      <ErrorText error={act.error} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Request">
            <KV items={[['Patient', `${r.patient?.firstName} ${r.patient?.lastName}`], ['Number', r.patient?.patientNumber], ['Sex / age', `${r.patient?.gender} / ${age(r.patient?.dateOfBirth)}`], ['Modality', r.modality], ['Priority', r.priority], ['Requested by', r.requestedByName], ['Requested', fmtDateTime(r.createdAt)], ['Indication', r.clinicalIndication], ['Accession', r.accessionNumber], ['Study UID', <span key="u" className="font-mono text-xs break-all">{r.studyInstanceUid}</span>]]} />
          </Card>
          <Card title="Report">
            {['in_progress', 'reported'].includes(r.status) && can('radiology.report') ? (
              <div className="space-y-3">
                <Field label="Findings"><Textarea rows={8} value={report.findings} onChange={(e) => setRep({ ...report, findings: e.target.value })} /></Field>
                <Field label="Impression"><Textarea rows={3} value={report.impression} onChange={(e) => setRep({ ...report, impression: e.target.value })} /></Field>
                <Field label="PACS viewer link (optional)"><Input value={report.pacsViewerUrl} onChange={(e) => setRep({ ...report, pacsViewerUrl: e.target.value })} /></Field>
                <div className="flex gap-2">
                  <Button onClick={() => act.mutate({ step: 'report', body: { ...report, pacsViewerUrl: report.pacsViewerUrl || undefined } })} loading={act.isPending}>Save report</Button>
                  {r.status === 'reported' && <Button variant="secondary" onClick={() => act.mutate({ step: 'verify' })}>Verify & release</Button>}
                  {['reported', 'verified'].includes(r.status) && <a href={`/print/radiology/${r._id}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-2)]">Print report</a>}
                </div>
              </div>
            ) : r.report?.findings ? (
              <div className="space-y-3 text-sm">
                <div><p className="label">Findings</p><p className="whitespace-pre-wrap">{r.report.findings}</p></div>
                <div><p className="label">Impression</p><p className="font-semibold whitespace-pre-wrap">{r.report.impression}</p></div>
                <p className="muted text-xs">Reported by {r.report.reportedByName} {fmtDateTime(r.report.reportedAt)} {r.report.verifiedByName && `· verified by ${r.report.verifiedByName} ${fmtDateTime(r.report.verifiedAt)}`}</p>
                {r.pacsViewerUrl && <a className="text-brand-600" href={r.pacsViewerUrl} target="_blank" rel="noreferrer">Open images in PACS viewer</a>}
                <a className="block text-brand-600 hover:underline" href={`/print/radiology/${r._id}`} target="_blank" rel="noreferrer">Print report</a>
              </div>
            ) : <p className="muted text-sm">Not yet reported.</p>}
          </Card>
          <DocumentsPanel relatedTo={{ resource: 'radiology_request', id: r._id }} patientId={typeof r.patientId === 'object' ? r.patientId._id : r.patientId} category="radiology_report" />
        </div>
        <Card title="Workflow">
          <div className="space-y-3">
            {['requested', 'scheduled'].includes(r.status) && can('radiology.manage') && (
              <>
                <Field label="Schedule"><Input type="datetime-local" value={sched.scheduledAt} onChange={(e) => setSched({ ...sched, scheduledAt: e.target.value })} /></Field>
                <Field label="Room"><Input value={sched.room} onChange={(e) => setSched({ ...sched, room: e.target.value })} /></Field>
                <Button variant="outline" disabled={!sched.scheduledAt} onClick={() => act.mutate({ step: 'schedule', body: { scheduledAt: new Date(sched.scheduledAt).toISOString(), room: sched.room || undefined } })}>Save schedule</Button>
              </>
            )}
            {['requested', 'scheduled'].includes(r.status) && can('radiology.manage', 'radiology.report') && <Button className="w-full" onClick={() => act.mutate({ step: 'start' })}>Start exam</Button>}
            {['requested', 'scheduled'].includes(r.status) && can('radiology.order', 'radiology.manage') && <Button className="w-full" variant="ghost" onClick={() => { const reason = window.prompt('Reason for cancelling'); if (reason) act.mutate({ step: 'cancel', body: { reason } }); }}>Cancel request</Button>}
          </div>
        </Card>
      </div>
    </>
  );
}
