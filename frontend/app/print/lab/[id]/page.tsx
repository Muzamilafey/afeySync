'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { age, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import type { LabItem } from '@/features/lab/types';

interface Report { orderNumber: string; orderedByName?: string; createdAt: string; clinicalNotes?: string; items: LabItem[]; pending: string[]; patient: { patientNumber: string; firstName: string; middleName?: string; lastName: string; gender: string; dateOfBirth?: string }; branch: { branchName: string; phone?: string; physicalAddress?: string }; facility: string }

export default function LabReportPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['lab-report', id], queryFn: async () => (await api<Report>(`/laboratory/orders/${id}/report`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const r = q.data;
  return (
    <div className="text-sm">
      <PrintButton />
      <Letterhead title="LABORATORY REPORT" meta={<p className="text-xs">{r.orderNumber}</p>} />
      <div className="my-3 grid grid-cols-2 gap-1">
        <p>Patient: <strong>{r.patient.firstName} {r.patient.middleName} {r.patient.lastName}</strong></p>
        <p>Patient No: {r.patient.patientNumber}</p>
        <p>Sex/Age: {r.patient.gender} / {age(r.patient.dateOfBirth)}</p>
        <p>Order: {r.orderNumber} · {fmtDateTime(r.createdAt)}</p>
        <p>Requested by: {r.orderedByName}</p>
        <p>Clinical notes: {r.clinicalNotes ?? '—'}</p>
      </div>
      {r.items.map((i) => (
        <div key={i._id} className="mb-4">
          <p className="border-b font-bold">{i.testName} <span className="font-normal">({i.accessionNumber})</span></p>
          <table className="w-full">
            <thead><tr className="text-left"><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
            <tbody>{i.results.map((x) => <tr key={x.parameter} className={x.flag && x.flag !== 'N' ? 'font-bold' : ''}><td>{x.name}</td><td>{x.value}</td><td>{x.unit}</td><td>{x.referenceRange}</td><td>{x.critical ? `${x.flag} CRITICAL` : x.flag === 'N' ? '' : x.flag}</td></tr>)}</tbody>
          </table>
          {i.comment && <p>Comment: {i.comment}</p>}
          <p className="text-xs">Performed: {i.resultedByName} · Verified: {i.verifiedByName} · Approved: {i.approvedByName} ({fmtDateTime(i.releasedAt)})</p>
        </div>
      ))}
      {r.pending.length > 0 && <p className="italic">Pending: {r.pending.join(', ')}</p>}
      <p className="mt-6 text-xs">Results relate only to the specimens tested. Interpret in clinical context.</p>
    </div>
  );
}
