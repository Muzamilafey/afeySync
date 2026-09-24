'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select, statusTone, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Grant { _id: string; tenantId: string; reason: string; status: string; durationMinutes: number; permissions: string[]; createdAt: string; expiresAt?: string; approvedByName?: string }

export default function SupportPage() {
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ['owner-tenants-all'], queryFn: async () => (await ownerApi<Array<{ id: string; name: string }>>('/tenants', { query: { limit: 100 } })).data });
  const grants = useQuery({ queryKey: ['owner-grants'], queryFn: async () => (await ownerApi<Grant[]>('/support-access')).data });
  const [form, setForm] = useState({ tenantId: '', reason: '', durationMinutes: 30, permissions: 'patients.view,patients.search' });
  const [session, setSession] = useState<{ accessToken: string; expiresIn: number } | null>(null);
  const req = useMutation({ mutationFn: () => ownerApi('/support-access', { method: 'POST', body: { ...form, permissions: form.permissions.split(',').map((s) => s.trim()).filter(Boolean) } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-grants'] }) });
  const start = useMutation({ mutationFn: async (id: string) => (await ownerApi<{ accessToken: string; expiresIn: number }>(`/support-access/${id}/session`, { method: 'POST' })).data, onSuccess: setSession });
  const name = (id: string) => tenants.data?.find((t) => t.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title="Support Access" crumbs={['Owner', 'Support']} />
      <div className="mb-4"><Alert tone="blue">Support Access → Reason → Facility approval → Time limit → Audit. The platform owner cannot browse clinical records without an approved, time-limited grant.</Alert></div>
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card title="Request access">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); req.mutate(); }}>
            <Field label="Facility"><Select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}><option value="">Select…</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Reason / ticket"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <Field label="Duration (minutes)"><Input type="number" min={15} max={240} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} /></Field>
            <Field label="Permissions (comma separated)" hint="Administrative permissions cannot be granted to support."><Input value={form.permissions} onChange={(e) => setForm({ ...form, permissions: e.target.value })} /></Field>
            <ErrorText error={req.error} />
            <Button type="submit" loading={req.isPending} disabled={!form.tenantId}>Submit request</Button>
          </form>
        </Card>
        <Card title="My requests">
          <ErrorText error={start.error} />
          {session && <div className="mb-3"><Alert tone="amber" title={`Support session issued (${Math.round(session.expiresIn / 60)} min)`}>Use this token only against the facility API for the approved purpose. All actions are audited in the facility’s audit trail.</Alert></div>}
          <Table head={['Facility', 'Reason', 'Duration', 'Status', 'Expires', '']} empty={(grants.data ?? []).length === 0}>
            {grants.data?.map((g) => (
              <tr key={g._id}>
                <Td>{name(g.tenantId)}</Td>
                <Td className="max-w-xs text-sm">{g.reason}</Td>
                <Td>{g.durationMinutes}m</Td>
                <Td><Badge tone={statusTone(g.status === 'approved' ? 'active' : g.status)}>{g.status}</Badge></Td>
                <Td>{fmtDateTime(g.expiresAt)}</Td>
                <Td>{g.status === 'approved' && g.expiresAt && new Date(g.expiresAt) > new Date() && <Button size="sm" onClick={() => start.mutate(g._id)}>Start session</Button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
