'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useMe } from '@/hooks/useMe';
import { age, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';

interface B { admission: { admissionNumber: string; admittedAt: string; admissionDiagnosis: string; admittingDoctorName?: string; discharge?: { at: string; outcome: string; summary: string; finalDiagnosis: string; dischargeMedications?: string; followUp?: string; byName?: string } }; patient: { patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string }; ward: { name: string }; lengthOfStayDays: number }

export default function DischargePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['admission', id], queryFn: async () => (await api<B>(`/inpatient/admissions/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const { admission: a, patient: p } = q.data;
  const d = a.discharge;
  return (
    <div className="space-y-3 text-sm">
      <PrintButton />
      <div className="border-b-2 border-black pb-2 text-center"><p className="text-xl font-bold">{me?.tenant.name}</p><p className="font-bold tracking-wide">DISCHARGE SUMMARY</p></div>
      <div className="grid grid-cols-2 gap-1">
        <p>Patient: <strong>{p.firstName} {p.middleName} {p.lastName}</strong></p><p>Patient No: {p.patientNumber}</p>
        <p>Sex/Age: {p.gender} / {age(p.dateOfBirth)}</p><p>Admission No: {a.admissionNumber}</p>
        <p>Ward: {q.data.ward?.name}</p><p>Admitted: {fmtDateTime(a.admittedAt)}</p>
        <p>Discharged: {fmtDateTime(d?.at)}</p><p>Length of stay: {q.data.lengthOfStayDays} day(s)</p>
      </div>
      <p><strong>Admission diagnosis:</strong> {a.admissionDiagnosis}</p>
      <p><strong>Final diagnosis:</strong> {d?.finalDiagnosis}</p>
      <p><strong>Outcome:</strong> {d?.outcome}</p>
      <div><strong>Summary</strong><p className="whitespace-pre-wrap">{d?.summary}</p></div>
      {d?.dischargeMedications && <div><strong>Discharge medications</strong><p className="whitespace-pre-wrap">{d.dischargeMedications}</p></div>}
      {d?.followUp && <div><strong>Follow-up</strong><p className="whitespace-pre-wrap">{d.followUp}</p></div>}
      <p className="pt-8">Clinician: {d?.byName} ______________________</p>
    </div>
  );
}
