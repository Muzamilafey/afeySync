'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { age, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface R {
  requestNumber: string; accessionNumber: string; examName?: string; examCode: string; modality?: string; clinicalIndication?: string; priority: string; status: string; performedAt?: string; requestedByName?: string; createdAt: string;
  report?: { findings?: string; impression?: string; reportedByName?: string; reportedAt?: string; verifiedByName?: string; verifiedAt?: string };
  patient: { patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string };
}

/** Imaging report. Only a verified report is final; anything else prints as PRELIMINARY. */
export default function RadiologyReportPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['radiology-print', id], queryFn: async () => (await api<R>(`/radiology/requests/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const r = q.data;
  const p = r.patient;
  const final = r.status === 'verified';
  return (
    <div className="space-y-4 text-sm">
      <PrintButton />
      <Letterhead title="IMAGING REPORT" meta={<p className="text-xs">Accession: {r.accessionNumber}<br />{r.requestNumber}</p>} />
      {!final && <p className="rounded border-2 border-amber-500 p-2 text-center font-bold text-amber-700">PRELIMINARY: not yet verified</p>}
      <div className="grid grid-cols-2 gap-1 rounded border border-slate-300 p-3">
        <p>Patient: <strong>{[p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')}</strong></p><p>Patient No: {p.patientNumber}</p>
        <p>Sex / Age: {p.gender} / {age(p.dateOfBirth)}</p><p>Examination: <strong>{r.examName ?? r.examCode}</strong> ({r.modality})</p>
        <p>Requested by: {r.requestedByName ?? '—'}</p><p>Performed: {fmtDateTime(r.performedAt)}</p>
      </div>
      {r.clinicalIndication && <p><strong>Clinical indication:</strong> {r.clinicalIndication}</p>}
      <div><h2 className="font-bold">Findings</h2><p className="whitespace-pre-wrap">{r.report?.findings || '—'}</p></div>
      <div><h2 className="font-bold">Impression</h2><p className="whitespace-pre-wrap font-medium">{r.report?.impression || '—'}</p></div>
      <div className="grid grid-cols-2 gap-8 pt-8 text-xs">
        <p className="border-t border-slate-500 pt-1">Reported by: <strong>{r.report?.reportedByName ?? '—'}</strong><br />{fmtDateTime(r.report?.reportedAt)}</p>
        <p className="border-t border-slate-500 pt-1">Verified by: <strong>{r.report?.verifiedByName ?? '—'}</strong><br />{fmtDateTime(r.report?.verifiedAt)}</p>
      </div>
    </div>
  );
}
