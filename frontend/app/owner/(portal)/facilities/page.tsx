'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Button, Card, ErrorText, Input, Loading, PageHeader, Select, StatusDot, statusTone, Table, Td } from '@/components/ui';
import { ago } from '@/lib/utils';

interface Row { id: string; name: string; slug: string; facilityCode?: string; county?: string; status: string; branches: number; users: number; lastActivityAt?: string; integrations: Record<string, boolean>; subscription?: { plan: string; status: string } | null }

export default function FacilitiesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['owner-tenants', q, status, page], queryFn: () => ownerApi<Row[]>('/tenants', { query: { q, status, page, limit: 25 } }) });
  const total = Number(list.data?.meta?.total ?? 0);
  return (
    <>
      <PageHeader title="Facilities" crumbs={['Owner', 'Facilities']} actions={<Link href="/owner/facilities/new"><Button>+ NEW FACILITY</Button></Link>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="max-w-sm" placeholder="Search facility, code, county…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="provisioning">Provisioning</option>
          </Select>
        </div>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error} />
        {list.data && (
          <>
            <Table head={['Facility', 'Code', 'County', 'Branches', 'Users', 'Status', 'Subscription', 'SHA', 'DHA', 'Database', 'Last activity', '']} empty={list.data.data.length === 0}>
              {list.data.data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}<span className="muted block text-xs">{t.slug}</span></Td>
                  <Td className="font-mono text-xs">{t.facilityCode ?? '—'}</Td>
                  <Td>{t.county ?? '—'}</Td>
                  <Td>{t.branches}</Td>
                  <Td>{t.users}</Td>
                  <Td><StatusDot tone={statusTone(t.status)} label={t.status} /></Td>
                  <Td>{t.subscription ? <Badge tone={statusTone(t.subscription.status)} className="capitalize">{t.subscription.plan}</Badge> : '—'}</Td>
                  <Td><Badge tone={t.integrations?.sha ? 'green' : 'gray'}>{t.integrations?.sha ? 'On' : 'Off'}</Badge></Td>
                  <Td><Badge tone={t.integrations?.dha ? 'green' : 'gray'}>{t.integrations?.dha ? 'On' : 'Off'}</Badge></Td>
                  <Td><Badge tone={t.status === 'active' ? 'green' : 'gray'}>Dedicated</Badge></Td>
                  <Td>{ago(t.lastActivityAt)}</Td>
                  <Td><Link href={`/owner/facilities/${t.id}`} className="font-medium text-brand-600">View</Link></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="muted">{total} facilities</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
