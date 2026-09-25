'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { VISIT_STATUS_LABEL, type ShaVisit } from '@/features/sha/shaVisitTypes';

export default function ShaVisitsPage() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['sha-visits', status], queryFn: async () => (await api<ShaVisit[]>('/sha/visits', { query: { status } })).data });
  return (
    <>
      <PageHeader title="SHA visits" subtitle="Consent, virtual claims and preauthorizations (DHA eClaims)" crumbs={['SHA', 'Visits']} actions={can('sha.authorization') && <Link href="/sha/visits/new"><Button><Plus className="h-4 w-4" /> Start SHA visit</Button></Link>} />
      <Card actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56"><option value="">All statuses</option>{Object.entries(VISIT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        <Table head={['Reference', 'Patient', 'Service', 'Interventions', 'DHA claim', 'Status', 'Created', '']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((v) => (
            <tr key={v._id}>
              <Td className="font-mono text-xs">{v.reference}</Td>
              <Td>{v.patientId?.firstName} {v.patientId?.lastName}<span className="muted block text-xs">{v.patientCrId}</span></Td>
              <Td>{v.serviceType}</Td>
              <Td className="text-xs">{v.interventions.map((i) => i.code).join(', ')}</Td>
              <Td className="font-mono text-xs">{v.dha?.claimId ? String(v.dha.claimId) : '—'}</Td>
              <Td><Badge tone={v.status.includes('pending') ? 'amber' : v.status === 'closed' ? 'gray' : 'blue'}>{VISIT_STATUS_LABEL[v.status] ?? v.status}</Badge></Td>
              <Td className="text-xs">{fmtDateTime(v.createdAt)}</Td>
              <Td><Link href={`/sha/visits/${v._id}`}><Button size="sm" variant="ghost">Open</Button></Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
