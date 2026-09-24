'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Badge, Card, ErrorText, Loading, PageHeader, Select, statusTone, Table, Tabs, Td } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import type { RadRequest } from '@/features/lab/types';

type Tab = 'requested,scheduled' | 'in_progress' | 'reported' | 'verified';

export default function RadiologyPage() {
  const [tab, setTab] = useState<Tab>('requested,scheduled');
  const [modality, setModality] = useState('');
  const q = useQuery({ queryKey: ['rad', tab, modality], queryFn: async () => (await api<RadRequest[]>('/radiology/requests', { query: { status: tab, modality, limit: 200 } })).data, refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Radiology" crumbs={['Radiology', 'Worklist']} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'requested,scheduled', label: 'Requested / scheduled' }, { key: 'in_progress', label: 'In progress' }, { key: 'reported', label: 'To verify' }, { key: 'verified', label: 'Verified' }]} />
      <Card>
        <Select className="mb-3 max-w-40" value={modality} onChange={(e) => setModality(e.target.value)}><option value="">All modalities</option>{['XR', 'US', 'CT', 'MR', 'MG', 'FL', 'ECG', 'OTHER'].map((m) => <option key={m}>{m}</option>)}</Select>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        <Table head={['Accession', 'Exam', 'Patient', 'Indication', 'Priority', 'Status', 'Requested']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((r) => {
            const p = typeof r.patientId === 'object' ? r.patientId : null;
            return (
              <tr key={r._id} className="hover:bg-[var(--surface-2)]">
                <Td><Link href={`/radiology/${r._id}`} className="font-mono text-xs font-semibold text-brand-600">{r.accessionNumber}</Link></Td>
                <Td>{r.examName}<span className="muted block text-xs">{r.modality}</span></Td>
                <Td>{p?.firstName} {p?.lastName}<span className="muted block text-xs capitalize">{p?.gender} · {age(p?.dateOfBirth)}</span></Td>
                <Td className="max-w-xs text-xs">{r.clinicalIndication}</Td>
                <Td><Badge tone={r.priority === 'routine' ? 'gray' : 'red'}>{r.priority}</Badge></Td>
                <Td><Badge tone={statusTone(r.status === 'verified' ? 'completed' : 'pending')}>{r.status.replace('_', ' ')}</Badge>{r.scheduledAt && <span className="muted block text-xs">{fmtDateTime(r.scheduledAt)} {r.room}</span>}</Td>
                <Td>{fmtDateTime(r.createdAt)}<span className="muted block text-xs">{r.requestedByName}</span></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
