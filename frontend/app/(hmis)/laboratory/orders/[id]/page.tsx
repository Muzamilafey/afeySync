'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, ErrorText, KV, Loading, PageHeader, statusTone } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { ResultsTable } from '@/features/lab/ResultsTable';
import type { LabOrder } from '@/features/lab/types';

export default function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['lab-order', id], queryFn: async () => (await api<LabOrder & { patient: { _id: string; patientNumber: string; firstName: string; lastName: string; gender: string; dateOfBirth?: string } }>(`/laboratory/orders/${id}`)).data });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const o = q.data;
  return (
    <>
      <PageHeader title={`Lab order ${o.orderNumber}`} crumbs={['Laboratory', o.orderNumber]} actions={<Link href={`/print/lab/${o._id}`} target="_blank"><Button variant="outline"><Printer className="h-4 w-4" /> Print report</Button></Link>} />
      <Card className="mb-5"><KV items={[['Patient', `${o.patient.firstName} ${o.patient.lastName}`], ['Number', o.patient.patientNumber], ['Sex / age', `${o.patient.gender} / ${age(o.patient.dateOfBirth)}`], ['Ordered by', o.orderedByName], ['Ordered', fmtDateTime(o.createdAt)], ['Priority', o.priority], ['Clinical notes', o.clinicalNotes]]} /></Card>
      <div className="space-y-4">
        {o.items.map((i) => (
          <Card key={i._id} title={<span>{i.testName} <span className="muted font-mono text-xs">{i.accessionNumber}</span></span>} actions={<Badge tone={statusTone(i.status === 'released' ? 'completed' : i.status === 'rejected' || i.status === 'cancelled' ? 'failed' : 'pending')}>{i.status}</Badge>}>
            {i.results.length > 0 ? <ResultsTable item={i} /> : <p className="muted text-sm">No results yet.</p>}
            {i.comment && <p className="mt-2 text-sm">Comment: {i.comment}</p>}
            {i.rejectionReason && <p className="mt-2 text-sm text-red-600">{i.rejectionReason}</p>}
            <p className="muted mt-2 text-xs">{[i.resultedByName && `Entered: ${i.resultedByName}`, i.verifiedByName && `Verified: ${i.verifiedByName}`, i.approvedByName && `Approved: ${i.approvedByName} ${fmtDateTime(i.releasedAt)}`].filter(Boolean).join(' · ')}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
