'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Card, ErrorText, Input, Loading, PageHeader, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface A { _id: string; createdAt: string; actorEmail?: string; action: string; resource?: string; resourceId?: string; tenantId?: string; result: string; ip?: string }

export default function PlatformAudit() {
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['owner-audit', action], queryFn: async () => (await ownerApi<A[]>('/audit', { query: { action, limit: 100 } })).data });
  return (
    <>
      <PageHeader title="Platform Audit" crumbs={['Owner', 'Audit']} />
      <Card>
        <Input className="mb-3 max-w-xs" placeholder="Filter by action (e.g. tenant.create)" value={action} onChange={(e) => setAction(e.target.value)} />
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        {q.data && (
          <Table head={['Time', 'Actor', 'Action', 'Resource', 'Tenant', 'Result', 'IP']} empty={q.data.length === 0}>
            {q.data.map((a) => (
              <tr key={a._id}><Td>{fmtDateTime(a.createdAt)}</Td><Td>{a.actorEmail ?? 'system'}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="text-xs">{a.resource} {a.resourceId}</Td><Td className="font-mono text-[11px]">{a.tenantId}</Td><Td><Badge tone={statusTone(a.result)}>{a.result}</Badge></Td><Td className="text-xs">{a.ip}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
