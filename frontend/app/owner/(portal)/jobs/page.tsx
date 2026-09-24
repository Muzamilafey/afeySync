'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Button, Card, ErrorText, Loading, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Job { _id: string; type: string; tenantId?: string; status: string; attempts: number; maxAttempts: number; runAt: string; lastError?: string; updatedAt: string }

export default function JobsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['owner-jobs', status], queryFn: async () => (await ownerApi<Job[]>('/jobs', { query: { status } })).data, refetchInterval: 15_000 });
  const retry = useMutation({ mutationFn: (id: string) => ownerApi(`/jobs/${id}/retry`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-jobs'] }) });
  return (
    <>
      <PageHeader title="Jobs & Queues" crumbs={['Owner', 'Jobs']} subtitle="SMS, email, callback and sync jobs. Transient failures retry with exponential backoff; permanent failures go to the dead-letter queue." />
      <Card>
        <Select className="mb-3 max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['queued', 'running', 'completed', 'failed', 'dead'].map((s) => <option key={s}>{s}</option>)}
        </Select>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error || retry.error} />
        {q.data && (
          <Table head={['Updated', 'Type', 'Tenant', 'Status', 'Attempts', 'Next run', 'Last error', '']} empty={q.data.length === 0}>
            {q.data.map((j) => (
              <tr key={j._id}>
                <Td>{fmtDateTime(j.updatedAt)}</Td>
                <Td className="font-mono text-xs">{j.type}</Td>
                <Td className="font-mono text-[11px]">{j.tenantId ?? 'platform'}</Td>
                <Td><Badge tone={statusTone(j.status)}>{j.status}</Badge></Td>
                <Td>{j.attempts}/{j.maxAttempts}</Td>
                <Td>{fmtDateTime(j.runAt)}</Td>
                <Td className="max-w-xs text-xs text-red-600">{j.lastError}</Td>
                <Td>{['dead', 'failed'].includes(j.status) && <Button size="sm" variant="outline" onClick={() => retry.mutate(j._id)}>Retry</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
