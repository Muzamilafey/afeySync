'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Button, Card, ErrorText, Input, Loading, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Log { _id: string; requestId: string; tenantId?: string; provider: string; operation: string; method?: string; status: string; httpStatus?: number; latencyMs?: number; externalReference?: string; errorCode?: string; errorMessage?: string; retryCount: number; createdAt: string }

export default function LogsPage() {
  const [f, setF] = useState({ tenantId: '', provider: '', operation: '', status: '', reference: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['owner-logs', f, page], queryFn: () => ownerApi<Log[]>('/integration-logs', { query: { ...f, page, limit: 50 } }) });
  const total = Number(q.data?.meta?.total ?? 0);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Integration Logs" crumbs={['Owner', 'Support', 'Integration Logs']} subtitle="Request metadata only — secrets, tokens and patient payloads are never logged." />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <Input placeholder="Tenant ID" value={f.tenantId} onChange={(e) => set('tenantId', e.target.value)} />
          <Select value={f.provider} onChange={(e) => set('provider', e.target.value)}><option value="">All providers</option>{['sha', 'dha', 'mpesa', 'africastalking', 'talksasa', 'smtp'].map((p) => <option key={p}>{p}</option>)}</Select>
          <Input placeholder="Operation" value={f.operation} onChange={(e) => set('operation', e.target.value)} />
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Any status</option><option value="success">success</option><option value="failure">failure</option></Select>
          <Input placeholder="Reference / request ID" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
          <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
          <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        </div>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        {q.data && (
          <>
            <Table head={['Time', 'Request ID', 'Provider', 'Operation', 'Status', 'HTTP', 'Latency', 'External ref', 'Error', 'Retries']} empty={q.data.data.length === 0}>
              {q.data.data.map((l) => (
                <tr key={l._id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</Td>
                  <Td className="font-mono text-[11px]">{l.requestId?.slice(0, 18)}</Td>
                  <Td className="uppercase">{l.provider}</Td>
                  <Td className="font-mono text-xs">{l.operation}</Td>
                  <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td>
                  <Td>{l.httpStatus ?? '—'}</Td>
                  <Td>{l.latencyMs != null ? `${l.latencyMs} ms` : '—'}</Td>
                  <Td className="font-mono text-xs">{l.externalReference ?? '—'}</Td>
                  <Td className="text-xs text-red-600">{l.errorCode} {l.errorMessage}</Td>
                  <Td>{l.retryCount}</Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="muted">{total} entries</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
