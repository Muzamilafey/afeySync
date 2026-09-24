'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, statusTone, Table, Tabs, Td } from '@/components/ui';
import { ago } from '@/lib/utils';
import type { Branch } from '@/types/api';

interface Role { _id: string; key: string; name: string; scope: 'tenant' | 'branch'; system: boolean; permissions: string[] }
interface User { _id: string; name: string; email: string; status: string; branchAccess: 'all' | 'specific'; roleIds: Role[]; branchIds: Array<{ _id: string; branchName: string }>; lastLoginAt?: string }

function UserForm({ roles, branches, onDone }: { roles: Role[]; branches: Branch[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [form, setForm] = useState({ name: '', email: '', phone: '', roleId: '', branchAccess: 'specific' as 'all' | 'specific', branchIds: [] as string[], cadre: '', licenseNumber: '' });
  const [temp, setTemp] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () =>
      (
        await api<{ temporaryPassword?: string }>('/users', {
          method: 'POST',
          body: { name: form.name, email: form.email, phone: form.phone || undefined, roleIds: [form.roleId], branchAccess: form.branchAccess, branchIds: form.branchIds, practitioner: form.cadre || form.licenseNumber ? { cadre: form.cadre, licenseNumber: form.licenseNumber } : undefined },
        })
      ).data,
    onSuccess: (d) => {
      setTemp(d.temporaryPassword ?? null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  if (temp) return (
    <div className="space-y-3">
      <Alert tone="green" title="User created">Share this temporary password securely. The user must change it at first login.</Alert>
      <code className="block rounded bg-[var(--surface-2)] p-3 text-center font-mono text-lg">{temp}</code>
      <Button onClick={onDone}>Done</Button>
    </div>
  );
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Role">
        <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
          <option value="">Select role…</option>
          {roles.filter((r) => me?.user.branchAccess === 'all' || r.scope === 'branch').map((r) => <option key={r._id} value={r._id}>{r.name}{r.scope === 'tenant' ? ' (tenant-wide)' : ''}</option>)}
        </Select>
      </Field>
      <Field label="Branch access">
        <Select value={form.branchAccess} onChange={(e) => setForm({ ...form, branchAccess: e.target.value as 'all' | 'specific' })} disabled={me?.user.branchAccess !== 'all'}>
          <option value="specific">Specific branches</option>
          <option value="all">All branches</option>
        </Select>
      </Field>
      {form.branchAccess === 'specific' && (
        <div className="col-span-full">
          <p className="label">Branches</p>
          <div className="flex flex-wrap gap-3">
            {branches.map((b) => (
              <label key={b._id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.branchIds.includes(b._id)} onChange={(e) => setForm({ ...form, branchIds: e.target.checked ? [...form.branchIds, b._id] : form.branchIds.filter((x) => x !== b._id) })} /> {b.branchName}
              </label>
            ))}
          </div>
        </div>
      )}
      <Field label="Cadre (clinical staff)"><Input value={form.cadre} onChange={(e) => setForm({ ...form, cadre: e.target.value })} placeholder="e.g. Clinical Officer" /></Field>
      <Field label="Licence number"><Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} /></Field>
      <div className="col-span-full space-y-2">
        <ErrorText error={m.error} />
        <Button type="submit" loading={m.isPending} disabled={!form.roleId}>Create user</Button>
      </div>
    </form>
  );
}

function RoleForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const groups = useQuery({ queryKey: ['perm-catalog'], queryFn: async () => (await api<Record<string, { label: string; permissions: Record<string, string> }>>('/permissions')).data });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'branch' | 'tenant'>('branch');
  const [perms, setPerms] = useState<string[]>([]);
  const mine = new Set(me?.permissions ?? []);
  const m = useMutation({ mutationFn: () => api('/roles', { method: 'POST', body: { name, scope, permissions: perms } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); onDone(); } });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Scope"><Select value={scope} onChange={(e) => setScope(e.target.value as 'branch' | 'tenant')}><option value="branch">Branch</option><option value="tenant">Tenant-wide</option></Select></Field>
      </div>
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {groups.data && Object.entries(groups.data).map(([k, g]) => (
          <div key={k}>
            <p className="label">{g.label}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {Object.entries(g.permissions).map(([p, desc]) => (
                <label key={p} className={`flex items-center gap-2 text-sm ${mine.has(p) ? '' : 'opacity-40'}`} title={mine.has(p) ? p : 'You cannot grant a permission you do not hold'}>
                  <input type="checkbox" disabled={!mine.has(p)} checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} /> {desc}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ErrorText error={m.error} />
      <Button type="submit" loading={m.isPending} disabled={!name || !perms.length}>Create role</Button>
    </form>
  );
}

export default function UsersPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'users' | 'roles'>(can('admin.users') ? 'users' : 'roles');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<'user' | 'role' | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['users', q], queryFn: async () => (await api<User[]>('/users', { query: { q, limit: 100 } })).data, enabled: can('admin.users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => (await api<Role[]>('/roles')).data });
  const branches = useQuery({ queryKey: ['branches'], queryFn: async () => (await api<Branch[]>('/branches')).data });
  const action = useMutation({
    mutationFn: async ({ id, act }: { id: string; act: 'suspend' | 'activate' | 'reset-password' }) => (await api<{ temporaryPassword?: string }>(`/users/${id}/${act}`, { method: 'POST' })).data,
    onSuccess: (d) => {
      if (d?.temporaryPassword) setReset(d.temporaryPassword);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <>
      <PageHeader title="Users & Roles" crumbs={['Admin', 'Users']} actions={tab === 'users' ? can('admin.users') && <Button onClick={() => setModal('user')}><Plus className="h-4 w-4" /> Add user</Button> : can('admin.roles') && <Button onClick={() => setModal('role')}><Plus className="h-4 w-4" /> Custom role</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('admin.users') ? [{ key: 'users' as const, label: 'Users' }] : []), { key: 'roles', label: 'Roles' }]} />
      <ErrorText error={action.error} />
      {tab === 'users' && (
        <Card>
          <Input className="mb-3 max-w-sm" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
          {users.isLoading && <Loading />}
          {users.data && (
            <Table head={['Name', 'Roles', 'Branches', 'Status', 'Last login', '']} empty={users.data.length === 0}>
              {users.data.map((u) => (
                <tr key={u._id}>
                  <Td className="font-medium">{u.name}<span className="muted block text-xs">{u.email}</span></Td>
                  <Td>{u.roleIds.map((r) => <Badge key={r._id} className="mr-1">{r.name}</Badge>)}</Td>
                  <Td>{u.branchAccess === 'all' ? <Badge tone="purple">All branches</Badge> : u.branchIds.map((b) => b.branchName).join(', ')}</Td>
                  <Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td>
                  <Td>{ago(u.lastLoginAt)}</Td>
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: u._id, act: u.status === 'active' ? 'suspend' : 'activate' })}>{u.status === 'active' ? 'Suspend' : 'Activate'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: u._id, act: 'reset-password' })}>Reset password</Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === 'roles' && (
        <Card>
          <Table head={['Role', 'Scope', 'Permissions', 'Type']}>
            {roles.data?.map((r) => (
              <tr key={r._id}>
                <Td className="font-medium">{r.name}</Td>
                <Td><Badge tone={r.scope === 'tenant' ? 'purple' : 'gray'}>{r.scope}</Badge></Td>
                <Td className="max-w-xl"><span className="muted text-xs">{r.permissions.length} permissions — {r.permissions.slice(0, 6).join(', ')}{r.permissions.length > 6 ? '…' : ''}</span></Td>
                <Td>{r.system ? 'System' : 'Custom'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Modal open={modal === 'user'} onClose={() => setModal(null)} title="Add user" wide>
        {roles.data && branches.data && <UserForm roles={roles.data} branches={branches.data} onDone={() => setModal(null)} />}
      </Modal>
      <Modal open={modal === 'role'} onClose={() => setModal(null)} title="Create custom role" wide>
        <RoleForm onDone={() => setModal(null)} />
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title="Temporary password">
        <Alert tone="amber">Share securely. All sessions for this user were signed out.</Alert>
        <code className="mt-3 block rounded bg-[var(--surface-2)] p-3 text-center font-mono text-lg">{reset}</code>
      </Modal>
    </>
  );
}
