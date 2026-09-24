'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Card, Loading, PageHeader, statusTone, Table, Tabs, Td } from '@/components/ui';
import { RegisterFindPatient } from '@/features/patients/RegisterFindPatient';
import { CheckInForm } from '@/features/frontdesk/CheckInForm';
import { EmergencyForm } from '@/features/frontdesk/EmergencyForm';
import { fmtDateTime } from '@/lib/utils';
import type { Visit } from '@/features/frontdesk/types';

type Tab = 'find' | 'checkin' | 'visits' | 'emergency';

function TodaysVisits() {
  const q = useQuery({ queryKey: ['visits-today'], queryFn: async () => (await api<Visit[]>('/visits', { query: { today: 'true', limit: 100 } })).data, refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  return (
    <Card>
      <Table head={['Visit', 'Patient', 'Type', 'Payer', 'Priority', 'Status', 'Arrived']} empty={(q.data ?? []).length === 0}>
        {q.data?.map((v) => {
          const p = typeof v.patientId === 'object' ? v.patientId : null;
          return (
            <tr key={v._id} className="hover:bg-[var(--surface-2)]">
              <Td><Link href={`/visits/${v._id}`} className="font-mono text-xs font-semibold text-brand-600">{v.visitNumber}</Link></Td>
              <Td>{p?.firstName} {p?.lastName}<span className="muted block text-xs">{p?.patientNumber}</span></Td>
              <Td className="capitalize">{v.type.replace(/_/g, ' ')}</Td>
              <Td className="uppercase">{v.payer?.type}</Td>
              <Td><Badge tone={v.priority === 'emergency' ? 'red' : v.priority === 'urgent' ? 'amber' : 'gray'}>{v.priority}</Badge></Td>
              <Td><Badge tone={statusTone(v.status === 'closed' ? 'completed' : v.status === 'open' ? 'pending' : 'blue')}>{v.status.replace('_', ' ')}</Badge></Td>
              <Td>{fmtDateTime(v.createdAt)}</Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

export default function FrontDeskPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('find');
  return (
    <>
      <PageHeader title="Front Desk" crumbs={['Front Desk']} subtitle="Search the DHA Client Registry before registering to avoid duplicate records." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'find', label: 'Register / Find Patient' },
          ...(can('queue.manage') ? [{ key: 'checkin' as const, label: 'Check-in / Walk-in' }] : []),
          ...(can('queue.view', 'opd.view') ? [{ key: 'visits' as const, label: "Today's visits" }] : []),
          ...(can('patients.create') && can('queue.manage') ? [{ key: 'emergency' as const, label: 'Emergency' }] : []),
        ]}
      />
      {tab === 'find' && <RegisterFindPatient />}
      {tab === 'checkin' && <Card title="Check-in"><CheckInForm /></Card>}
      {tab === 'visits' && <TodaysVisits />}
      {tab === 'emergency' && <Card><EmergencyForm /></Card>}
    </>
  );
}
