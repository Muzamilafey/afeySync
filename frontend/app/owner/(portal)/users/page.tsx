'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { ago } from '@/lib/utils';

interface U { _id: string; name: string; email: string; role: string; status: string; lastLoginAt?: string; mfa?: { totp?: { confirmedAt?: string }; email?: { enabledAt?: string } }; google?: { email?: string } }
const mfaOn = (u: U) => [u.mfa?.totp?.confirmedAt && 'App', u.mfa?.email?.enabledAt && 'Email'].filter(Boolean) as string[];

export default function PlatformUsers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-users'], queryFn: async () => (await ownerApi<U[]>('/users')).data });
  const [f, setF] = useState({ name: '', email: '', role: 'platform_support', password: '' });
  const reset = useMutation({ mutationFn: (id: string) => ownerApi(`/users/${id}/mfa/reset`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-users'] }) });
  const m = useMutation({ mutationFn: () => ownerApi('/users', { method: 'POST', body: f }), onSuccess: () => { setF({ name: '', email: '', role: 'platform_support', password: '' }); qc.invalidateQueries({ queryKey: ['owner-users'] }); } });
  return (
    <>
      <PageHeader title="Platform Users" crumbs={['Owner', 'Users']} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <ErrorText error={q.error ?? reset.error} />
          <Table head={['Name', 'Role', '2-step', 'Status', 'Last login', '']}>
            {q.data?.map((u) => (
              <tr key={u._id}>
                <Td className="font-medium">{u.name}<span className="muted block text-xs">{u.email}</span></Td>
                <Td>{u.role.replace('_', ' ')}</Td>
                <Td>{mfaOn(u).length ? <Badge tone="green">{mfaOn(u).join(' · ')}</Badge> : <Badge>off</Badge>}</Td>
                <Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td>
                <Td>{ago(u.lastLoginAt)}</Td>
                <Td>{mfaOn(u).length > 0 && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Reset two-step verification for ${u.name}? Confirm their identity first.`)) reset.mutate(u._id); }}>Reset 2-step</Button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add platform user">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="platform_support">Platform Support</option><option value="platform_admin">Platform Admin</option><option value="super_owner">Super Platform Owner</option></Select></Field>
            <Field label="Initial password" hint="10+ chars, upper, lower, digit"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
            <ErrorText error={m.error} />
            <Button type="submit" loading={m.isPending}>Create</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
