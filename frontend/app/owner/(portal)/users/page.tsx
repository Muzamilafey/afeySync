'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { ago } from '@/lib/utils';

interface U { _id: string; name: string; email: string; role: string; status: string; lastLoginAt?: string }

export default function PlatformUsers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-users'], queryFn: async () => (await ownerApi<U[]>('/users')).data });
  const [f, setF] = useState({ name: '', email: '', role: 'platform_support', password: '' });
  const m = useMutation({ mutationFn: () => ownerApi('/users', { method: 'POST', body: f }), onSuccess: () => { setF({ name: '', email: '', role: 'platform_support', password: '' }); qc.invalidateQueries({ queryKey: ['owner-users'] }); } });
  return (
    <>
      <PageHeader title="Platform Users" crumbs={['Owner', 'Users']} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <ErrorText error={q.error} />
          <Table head={['Name', 'Role', 'Status', 'Last login']}>
            {q.data?.map((u) => <tr key={u._id}><Td className="font-medium">{u.name}<span className="muted block text-xs">{u.email}</span></Td><Td>{u.role.replace('_', ' ')}</Td><Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td><Td>{ago(u.lastLoginAt)}</Td></tr>)}
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
