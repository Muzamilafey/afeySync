'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Loading, PageHeader, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { useCan } from '@/hooks/useMe';
import { MfaPolicyCard } from '@/features/auth/MfaPolicyCard';
import { GoogleToggleCard } from '@/features/auth/GoogleToggleCard';
import { AdmissionOtpPolicyCard } from '@/features/inpatient/AdmissionOtpPolicyCard';

interface Grant { _id: string; requestedByEmail: string; reason: string; permissions: string[]; durationMinutes: number; status: string; createdAt: string; expiresAt?: string; approvedByName?: string }

export default function SupportAccessPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['support-access'], queryFn: async () => (await api<Grant[]>('/admin/support-access')).data });
  const act = useMutation({ mutationFn: ({ id, d }: { id: string; d: string }) => api(`/admin/support-access/${id}/${d}`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['support-access'] }) });
  return (
    <>
      <PageHeader title="Security" crumbs={['Admin', 'Security']} />
      {can('admin.settings') && <div className="mb-5 grid max-w-5xl gap-5 lg:grid-cols-2"><MfaPolicyCard realm="tenant" /><GoogleToggleCard /><AdmissionOtpPolicyCard /></div>}
      <h2 className="mb-2 text-base font-semibold">Support access</h2>
      <div className="mb-4"><Alert tone="blue" title="Platform staff cannot browse your patient records">AfeySync support can only access clinical data after a facility administrator approves a specific, time-limited request. All access is audited in your audit trail.</Alert></div>
      <Card>
        {q.isLoading && <Loading />}
        <ErrorText error={q.error || act.error} />
        {q.data && (
          <Table head={['Requested', 'By', 'Reason', 'Permissions', 'Duration', 'Status', '']} empty={q.data.length === 0}>
            {q.data.map((g) => (
              <tr key={g._id}>
                <Td>{fmtDateTime(g.createdAt)}</Td>
                <Td>{g.requestedByEmail}</Td>
                <Td className="max-w-xs">{g.reason}</Td>
                <Td className="text-xs">{g.permissions.join(', ')}</Td>
                <Td>{g.durationMinutes} min{g.expiresAt && <span className="muted block text-xs">until {fmtDateTime(g.expiresAt)}</span>}</Td>
                <Td><Badge tone={statusTone(g.status === 'approved' ? 'active' : g.status)}>{g.status}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {g.status === 'pending' && <><Button size="sm" onClick={() => act.mutate({ id: g._id, d: 'approve' })}>Approve</Button> <Button size="sm" variant="outline" onClick={() => act.mutate({ id: g._id, d: 'reject' })}>Reject</Button></>}
                  {g.status === 'approved' && <Button size="sm" variant="danger" onClick={() => act.mutate({ id: g._id, d: 'revoke' })}>Revoke</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
