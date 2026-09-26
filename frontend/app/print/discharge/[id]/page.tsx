'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { age, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface B { admission: { admissionNumber: string; admittedAt: string; admissionDiagnosis: string; admittingDoctorName?: string; discharge?: { at: string; outcome: string; summary: string; finalDiagnosis: string; dischargeMedications?: string; followUp?: string; byName?: string } }; patient: { patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string }; ward: { name: string }; lengthOfStayDays: number }

export default function DischargePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['admission', id], queryFn: async () => (await api<B>(`/inpatient/admissions/${id}`)).data });
  const tto = useQuery({ queryKey: ['rx', id, 'discharge'], queryFn: async () => (await api<Array<{ status: string; items: Array<{ drugName: string; dose?: string; frequency?: string; route?: string; durationDays?: number; quantity: number; instructions?: string; status: string }> }>>('/pharmacy/prescriptions', { query: { admissionId: id, purpose: 'discharge' } })).data, retry: false });
  const takeHome = (tto.data ?? []).filter((r) => r.status !== 'cancelled').flatMap((r) => r.items.filter((i) => i.status !== 'cancelled'));
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const { admission: a, patient: p } = q.data;
  const d = a.discharge;
  return (
    <div className="space-y-3 text-sm">
      <PrintButton />
      <Letterhead title="DISCHARGE SUMMARY" meta={<p className="text-xs">{a.admissionNumber}</p>} />
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
      {takeHome.length > 0 && (
        <div>
          <strong>Take-home medicines</strong>
          <table className="mt-1 w-full text-xs"><thead><tr className="border-b text-left"><th>Medicine</th><th>Dose</th><th>How often</th><th>Route</th><th>Days</th><th>Qty</th></tr></thead>
            <tbody>{takeHome.map((i, k) => <tr key={k} className="border-b"><td className="py-0.5">{i.drugName}{i.instructions ? ` (${i.instructions})` : ''}</td><td>{i.dose}</td><td>{i.frequency}</td><td>{i.route}</td><td>{i.durationDays ?? '—'}</td><td>{i.quantity}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {d?.dischargeMedications && <div><strong>Discharge medications</strong><p className="whitespace-pre-wrap">{d.dischargeMedications}</p></div>}
      {d?.followUp && <div><strong>Follow-up</strong><p className="whitespace-pre-wrap">{d.followUp}</p></div>}
      <p className="pt-8">Clinician: {d?.byName} ______________________</p>
    </div>
  );
}
