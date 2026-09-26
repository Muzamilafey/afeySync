'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { age, fmtDate } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import { FITNESS_LABEL, REPORT_TYPES, type MedicalReport } from '@/features/medicalReports/shared';

interface Data { report: MedicalReport; patient: { patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string; nationalId?: string }; visit: { visitNumber: string; arrivedAt: string } | null }

export default function MedicalReportPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['medical-report', id], queryFn: async () => (await api<Data>(`/medical-reports/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const { report: r, patient: p, visit } = q.data;
  if (r.status === 'void') return <p className="text-red-700">This report ({r.reportNumber}) was voided: {r.voidReason}. It cannot be printed.</p>;
  const name = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
  const pronoun = p.gender === 'female' ? 'she' : p.gender === 'male' ? 'he' : 'the patient';
  const draft = r.status !== 'final';
  return (
    <div className="relative space-y-4 text-sm leading-relaxed">
      <PrintButton />
      {draft && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-bold text-slate-300/60 print:text-slate-300" style={{ transform: 'rotate(-30deg)' }}>DRAFT</div>}
      <Letterhead title={REPORT_TYPES[r.type].title} meta={<p className="text-xs">Ref: {r.reportNumber}<br />Date: {fmtDate(r.finalizedAt ?? r.createdAt)}</p>} />
      {r.addressedTo && <p><strong>{r.addressedTo}</strong></p>}
      {r.subject && <p><strong>RE: {r.subject.toUpperCase()}</strong></p>}
      <div className="grid grid-cols-2 gap-1 rounded border border-slate-300 p-3">
        <p>Patient: <strong>{name}</strong></p><p>Patient No: {p.patientNumber}</p>
        <p>Sex / Age: {p.gender} / {age(p.dateOfBirth)}</p><p>ID No: {p.nationalId ?? '—'}</p>
        {visit && <p>Seen on: {fmtDate(visit.arrivedAt)}</p>}{visit && <p>Visit No: {visit.visitNumber}</p>}
      </div>

      {r.type === 'sick_leave' && (
        <p>This is to certify that <strong>{name}</strong> was seen and examined at this facility{visit ? ` on ${fmtDate(visit.arrivedAt)}` : ''} and is, in my opinion, unfit for duty/school and requires <strong>{r.restDays} day(s)</strong> of rest from <strong>{fmtDate(r.restFrom)}</strong> to <strong>{fmtDate(r.restTo)}</strong> inclusive.</p>
      )}
      {r.type === 'attendance' && <p>This is to confirm that <strong>{name}</strong> attended this facility{visit ? ` on ${fmtDate(visit.arrivedAt)}` : ''} for medical care.</p>}
      {r.type === 'fitness' && r.fitness && (
        <p>This is to certify that I have examined <strong>{name}</strong>{r.fitnessPurpose ? ` for ${r.fitnessPurpose}` : ''} and found {pronoun} to be <strong>{FITNESS_LABEL[r.fitness]}</strong>{r.fitness === 'fit_with_restrictions' && r.restrictions ? `, subject to the following: ${r.restrictions}` : ''}.</p>
      )}
      {r.includeDiagnosis && r.diagnosis && <p><strong>Diagnosis:</strong> {r.diagnosis}</p>}
      {r.body && <div className="whitespace-pre-wrap">{r.body}</div>}
      {r.reviewDate && <p><strong>Review date:</strong> {fmtDate(r.reviewDate)}</p>}
      {r.addenda?.map((a, i) => <p key={i} className="border-l-2 border-slate-400 pl-3 text-xs"><strong>Addendum ({fmtDate(a.at)}, {a.byName}):</strong> {a.text}</p>)}

      <div className="grid grid-cols-2 gap-8 pt-10">
        <div>
          <p className="border-t border-slate-500 pt-1"><strong>{r.authorName}</strong></p>
          {r.authorCadre && <p className="text-xs capitalize">{r.authorCadre.replace(/_/g, ' ')}</p>}
          {r.authorLicence && <p className="text-xs">Reg. No: {r.authorLicence}</p>}
          <p className="text-xs">{draft ? 'Not yet signed' : `Signed electronically on ${fmtDate(r.finalizedAt)}`}</p>
        </div>
        <div><p className="border-t border-slate-500 pt-1 text-xs">Official stamp</p></div>
      </div>
      <p className="pt-4 text-[10px] text-slate-500">This document was issued by the facility above through AfeySync. Ref {r.reportNumber}. Any alteration makes it invalid.</p>
    </div>
  );
}
