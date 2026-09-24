'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Badge, Button, Card, ErrorText, Input, KV, Loading, Modal, PageHeader, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Audit { _id: string; createdAt: string; userName?: string; actorType: string; action: string; resource?: string; resourceId?: string; result: string; ip?: string; device?: string; oldValue?: unknown; newValue?: unknown; requestId?: string }

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Audit | null>(null);
  const q = useQuery({ queryKey: ['audit', action, resourceId, page], queryFn: () => api<Audit[]>('/admin/audit', { query: { action, resourceId, page, limit: 50 } }) });
  const total = Number(q.data?.meta?.total ?? 0);
  return (
    <>
      <PageHeader title="Audit Trail" crumbs={['Admin', 'Audit']} subtitle="Append-only record of every important action." />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="max-w-60" placeholder="Action (e.g. patient.view)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input className="max-w-60" placeholder="Resource ID" value={resourceId} onChange={(e) => { setResourceId(e.target.value); setPage(1); }} />
        </div>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        {q.data && (
          <>
            <Table head={['Time', 'User', 'Action', 'Resource', 'Result', 'IP', '']} empty={q.data.data.length === 0}>
              {q.data.data.map((a) => (
                <tr key={a._id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</Td>
                  <Td>{a.userName ?? a.actorType}{a.actorType === 'support' && <Badge tone="amber" className="ml-1">support</Badge>}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.resource} <span className="muted">{a.resourceId}</span></Td>
                  <Td><Badge tone={statusTone(a.result)}>{a.result}</Badge></Td>
                  <Td className="text-xs">{a.ip}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setSel(a)}>Details</Button></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="muted">{total} records</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} title="Audit record" wide>
        {sel && (
          <div className="space-y-3">
            <KV items={[['Action', sel.action], ['User', sel.userName], ['Actor', sel.actorType], ['Time', fmtDateTime(sel.createdAt)], ['IP', sel.ip], ['Device', sel.device], ['Request ID', sel.requestId]]} />
            <div className="grid gap-3 md:grid-cols-2">
              <div><p className="label">Old value</p><pre className="max-h-72 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs">{JSON.stringify(sel.oldValue, null, 2) ?? '—'}</pre></div>
              <div><p className="label">New value</p><pre className="max-h-72 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs">{JSON.stringify(sel.newValue, null, 2) ?? '—'}</pre></div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
