'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useOwnerPlans } from '@/features/billing-docs/useOwnerPlans';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, StatusDot, statusTone, Table, Tabs, Td } from '@/components/ui';
import { ago, fmtDateTime } from '@/lib/utils';
import type { Branch } from '@/types/api';
import { BrandingEditor } from '@/features/branding/BrandingEditor';

interface Detail {
  tenant: { _id: string; name: string; slug: string; status: string; suspendedReason?: string; facilityCode?: string; county?: string; subCounty?: string; facilityLevel?: string; facilityType?: string; ownership?: string; phone?: string; email?: string; dhaRegistry?: { facilityRegistryCode?: string }; integrations: Record<string, boolean>; smsGateway?: 'auto' | 'africastalking' | 'talksasa'; stats?: { branches: number; users: number; patients: number; lastActivityAt?: string }; createdAt: string };
  domains: Array<{ _id: string; hostname: string; type: string; verified: boolean; verificationToken?: string; primary: boolean }>;
  subscription: { plan: string; status: string; billingCycle: string; amount: number; maxBranches: number; maxUsers: number; endsAt?: string } | null;
  database: { dbName: string; status: string; lastBackupAt?: string } | null;
  branches: Branch[];
  users: Array<{ _id: string; name: string; email: string; status: string; branchAccess: string; lastLoginAt?: string; roleIds: Array<{ name: string }> }>;
}
const PROVIDER_LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA HIE', mpesa: 'M-Pesa', africastalking: "Africa's Talking SMS", talksasa: 'Talksasa SMS', smtp: 'Email (SMTP)', slade360: 'Slade360 private insurance' };

type Tab = 'overview' | 'branches' | 'users' | 'domains' | 'branding' | 'subscription' | 'integrations' | 'health' | 'audit';

export default function FacilityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const plans = useOwnerPlans();
  const [modal, setModal] = useState<'suspend' | 'reset' | 'branch' | null>(null);
  const [reason, setReason] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [domain, setDomain] = useState('');
  const [branch, setBranch] = useState({ branchName: '', branchCode: '', county: '', facilityLevel: '' });
  const d = useQuery({ queryKey: ['owner-tenant', id], queryFn: async () => (await ownerApi<Detail>(`/tenants/${id}`)).data });
  const health = useQuery({ queryKey: ['owner-tenant-health', id], queryFn: async () => (await ownerApi<{ database: Record<string, unknown>; integrationFailures24h: number; lastBackupAt?: string }>(`/tenants/${id}/health`)).data, enabled: tab === 'health' });
  const audit = useQuery({ queryKey: ['owner-tenant-audit', id], queryFn: async () => (await ownerApi<Array<{ _id: string; createdAt: string; actorEmail?: string; action: string; result: string }>>(`/tenants/${id}/audit`)).data, enabled: tab === 'audit' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner-tenant', id] });

  const statusMut = useMutation({ mutationFn: (a: 'suspend' | 'activate') => ownerApi(`/tenants/${id}/${a}`, { method: 'POST', body: { reason: reason || undefined } }), onSuccess: () => { setModal(null); setReason(''); refresh(); } });
  const resetMut = useMutation({ mutationFn: async () => (await ownerApi<{ temporaryPassword: string; emailed?: boolean }>(`/tenants/${id}/reset-admin`, { method: 'POST', body: { email: resetEmail } })).data });
  const domainMut = useMutation({ mutationFn: () => ownerApi(`/tenants/${id}/domains`, { method: 'POST', body: { hostname: domain } }), onSuccess: () => { setDomain(''); refresh(); } });
  const verifyMut = useMutation({ mutationFn: (domainId: string) => ownerApi(`/tenants/${id}/domains/${domainId}/verify`, { method: 'POST' }), onSuccess: refresh });
  const removeDomain = useMutation({ mutationFn: (domainId: string) => ownerApi(`/tenants/${id}/domains/${domainId}`, { method: 'DELETE' }), onSuccess: refresh });
  const intMut = useMutation({ mutationFn: (body: Record<string, boolean | string>) => ownerApi(`/tenants/${id}/integrations`, { method: 'PUT', body }), onSuccess: refresh });
  const subMut = useMutation({ mutationFn: (body: Record<string, unknown>) => ownerApi(`/tenants/${id}/subscription`, { method: 'PUT', body }), onSuccess: refresh });
  const branchMut = useMutation({ mutationFn: () => ownerApi(`/tenants/${id}/branches`, { method: 'POST', body: Object.fromEntries(Object.entries(branch).filter(([, v]) => v)) }), onSuccess: () => { setModal(null); refresh(); } });

  if (d.isLoading) return <Loading />;
  if (d.error || !d.data) return <ErrorText error={d.error} />;
  const { tenant, subscription } = d.data;
  const sub = subscription;

  return (
    <>
      <PageHeader
        title={tenant.name}
        crumbs={['Owner', 'Facilities', tenant.slug]}
        subtitle={<StatusDot tone={statusTone(tenant.status)} label={tenant.status} />}
        actions={
          <>
            {tenant.status === 'active' ? <Button variant="danger" onClick={() => setModal('suspend')}>Suspend</Button> : <Button onClick={() => statusMut.mutate('activate')} loading={statusMut.isPending}>Activate</Button>}
            <Button variant="outline" onClick={() => setModal('reset')}>Reset admin</Button>
            <Button variant="outline" onClick={() => setModal('branch')}>Create branch</Button>
          </>
        }
      />
      {tenant.suspendedReason && <div className="mb-4"><Alert tone="red" title="Suspended">{tenant.suspendedReason}</Alert></div>}
      <ErrorText error={statusMut.error || domainMut.error || verifyMut.error || removeDomain.error || intMut.error || subMut.error} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={(['overview', 'branches', 'users', 'domains', 'branding', 'subscription', 'integrations', 'health', 'audit'] as Tab[]).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }))} />

      {tab === 'overview' && (
        <Card>
          <KV items={[['Slug', tenant.slug], ['Facility code', tenant.facilityCode], ['DHA registry code', tenant.dhaRegistry?.facilityRegistryCode], ['Level', tenant.facilityLevel], ['Type', tenant.facilityType], ['Ownership', tenant.ownership], ['County', tenant.county], ['Phone', tenant.phone], ['Email', tenant.email], ['Branches', tenant.stats?.branches], ['Users', tenant.stats?.users], ['Last activity', ago(tenant.stats?.lastActivityAt)], ['Database', d.data.database?.dbName], ['Created', fmtDateTime(tenant.createdAt)]]} />
          <p className="muted mt-4 text-xs">Clinical records are not visible from the owner portal. Use Support Access for approved, time-limited, audited access.</p>
        </Card>
      )}
      {tab === 'branches' && (
        <Card>
          <Table head={['Branch', 'Code', 'County', 'Level', 'Beds', 'Status']}>
            {d.data.branches.map((b) => <tr key={b._id}><Td className="font-medium">{b.branchName} {b.isMain && <Badge tone="blue">Main</Badge>}</Td><Td className="font-mono text-xs">{b.branchCode}</Td><Td>{b.county}</Td><Td>{b.facilityLevel}</Td><Td>{b.bedCapacity}</Td><Td><StatusDot tone={statusTone(b.status)} label={b.status} /></Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'users' && (
        <Card>
          <Table head={['Name', 'Roles', 'Access', 'Status', 'Last login']}>
            {d.data.users.map((u) => <tr key={u._id}><Td className="font-medium">{u.name}<span className="muted block text-xs">{u.email}</span></Td><Td>{u.roleIds.map((r) => r.name).join(', ')}</Td><Td>{u.branchAccess}</Td><Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td><Td>{ago(u.lastLoginAt)}</Td></tr>)}
          </Table>
        </Card>
      )}
      {tab === 'domains' && (
        <Card>
          <div className="mb-4 flex gap-2">
            <Input className="max-w-sm" placeholder="hospital.co.ke or main.hospital.co.ke" value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase().trim())} />
            <Button onClick={() => domainMut.mutate()} loading={domainMut.isPending} disabled={!domain}>Add domain</Button>
          </div>
          <Table head={['Hostname', 'Type', 'Verified', 'Verification TXT', '']}>
            {d.data.domains.map((dm) => (
              <tr key={dm._id}>
                <Td className="font-medium">{dm.hostname} {dm.primary && <Badge tone="blue">primary</Badge>}</Td>
                <Td>{dm.type}</Td>
                <Td><Badge tone={dm.verified ? 'green' : 'amber'}>{dm.verified ? 'verified' : 'pending'}</Badge></Td>
                <Td className="font-mono text-xs break-all">{dm.verified ? '—' : dm.verificationToken}</Td>
                <Td className="whitespace-nowrap">
                  {!dm.verified && <Button size="sm" variant="outline" onClick={() => verifyMut.mutate(dm._id)}>Verify DNS</Button>}
                  {dm.type !== 'platform_subdomain' && <Button size="sm" variant="ghost" onClick={() => removeDomain.mutate(dm._id)}>Remove</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {tab === 'subscription' && (
        <Card title="Subscription" actions={<div className="flex flex-wrap gap-2">{(['invoice', 'quotation', 'contract'] as const).map((t) => <Link key={t} href={`/owner/billing/new?type=${t}&tenantId=${id}`}><Button size="sm" variant="outline">New {t === 'contract' ? 'agreement' : t}</Button></Link>)}</div>}>
          {sub ? (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                subMut.mutate({ plan: f.get('plan'), status: f.get('status'), billingCycle: f.get('billingCycle'), amount: Number(f.get('amount')), maxBranches: Number(f.get('maxBranches')), maxUsers: Number(f.get('maxUsers')) });
              }}
            >
              <Field label="Plan" hint="Changing plan applies its modules and limits"><Select name="plan" defaultValue={sub.plan}>{(plans.data ?? []).map((p) => <option key={p.key} value={p.key}>{p.name}{p.active ? '' : ' (inactive)'}</option>)}{plans.data && !plans.data.some((p) => p.key === sub.plan) && <option value={sub.plan}>{sub.plan}</option>}</Select></Field>
              <Field label="Status"><Select name="status" defaultValue={sub.status}>{['trialing', 'active', 'past_due', 'cancelled'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
              <Field label="Billing"><Select name="billingCycle" defaultValue={sub.billingCycle}>{['monthly', 'quarterly', 'annual'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
              <Field label="Amount (KES)"><Input name="amount" type="number" defaultValue={sub.amount} /></Field>
              <Field label="Max branches"><Input name="maxBranches" type="number" defaultValue={sub.maxBranches} /></Field>
              <Field label="Max users"><Input name="maxUsers" type="number" defaultValue={sub.maxUsers} /></Field>
              <div><Button type="submit" loading={subMut.isPending}>Save subscription</Button></div>
            </form>
          ) : <p className="muted text-sm">No subscription.</p>}
        </Card>
      )}
      {tab === 'integrations' && (
        <Card title="Enabled providers for this facility">
          <div className="space-y-3">
            {Object.entries(tenant.integrations).filter(([k]) => !['africastalking', 'talksasa'].includes(k)).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <span className="font-medium">{PROVIDER_LABEL[k] ?? k.toUpperCase()}</span>
                <input type="checkbox" checked={v} onChange={(e) => intMut.mutate({ [k]: e.target.checked })} />
              </label>
            ))}
            <p className="muted text-xs">SMS is available to every facility (paid from its SMS wallet); no switch is needed.</p>
            <Field label="SMS gateway for this facility" hint="Automatic uses Africa's Talking, or Talksasa when Africa's Talking is not set up in Owner → Integrations.">
              <Select value={tenant.smsGateway ?? 'auto'} onChange={(e) => intMut.mutate({ smsGateway: e.target.value })}>
                <option value="auto">Automatic</option>
                <option value="africastalking">Africa&apos;s Talking</option>
                <option value="talksasa">Talksasa</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}
      {tab === 'branding' && <BrandingEditor tenantId={id} address={tenant.slug} />}
      {tab === 'health' && (
        <Card title="Database health">
          {health.isLoading ? <Loading /> : health.data && <KV items={[...Object.entries(health.data.database).map(([k, v]) => [k, String(v ?? '—')] as [string, string]), ['Integration failures (24h)', String(health.data.integrationFailures24h)], ['Last backup', fmtDateTime(health.data.lastBackupAt)]]} />}
        </Card>
      )}
      {tab === 'audit' && (
        <Card>
          <Table head={['Time', 'Actor', 'Action', 'Result']} empty={(audit.data ?? []).length === 0}>
            {audit.data?.map((a) => <tr key={a._id}><Td>{fmtDateTime(a.createdAt)}</Td><Td>{a.actorEmail ?? 'system'}</Td><Td className="font-mono text-xs">{a.action}</Td><Td><Badge tone={statusTone(a.result)}>{a.result}</Badge></Td></tr>)}
          </Table>
        </Card>
      )}

      <Modal open={modal === 'suspend'} onClose={() => setModal(null)} title="Suspend facility">
        <div className="space-y-3">
          <Alert tone="amber">All users of this facility will be blocked immediately.</Alert>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button variant="danger" disabled={!reason} onClick={() => statusMut.mutate('suspend')} loading={statusMut.isPending}>Suspend facility</Button>
        </div>
      </Modal>
      <Modal open={modal === 'reset'} onClose={() => { setModal(null); resetMut.reset(); }} title="Reset facility administrator">
        <div className="space-y-3">
          <Field label="Administrator email"><Select value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}><option value="">Select…</option>{d.data.users.filter((u) => u.roleIds.some((r) => /Administrator|Owner/.test(r.name))).map((u) => <option key={u._id} value={u.email}>{u.email}</option>)}</Select></Field>
          <ErrorText error={resetMut.error} />
          {resetMut.data && <Alert tone="amber" title="Temporary password (shown once)"><code>{resetMut.data.temporaryPassword}</code>{resetMut.data.emailed && <span className="mt-1 block text-xs">The administrator was also emailed a link to choose a new password.</span>}</Alert>}
          <Button onClick={() => resetMut.mutate()} disabled={!resetEmail} loading={resetMut.isPending}>Reset password</Button>
        </div>
      </Modal>
      <Modal open={modal === 'branch'} onClose={() => setModal(null)} title="Create branch">
        <div className="grid gap-3 sm:grid-cols-2">
          {(['branchName', 'branchCode', 'county', 'facilityLevel'] as const).map((k) => <Field key={k} label={k}><Input value={branch[k]} onChange={(e) => setBranch({ ...branch, [k]: k === 'branchCode' ? e.target.value.toUpperCase() : e.target.value })} /></Field>)}
          <div className="col-span-full space-y-2"><ErrorText error={branchMut.error} /><Button onClick={() => branchMut.mutate()} loading={branchMut.isPending}>Create branch</Button></div>
        </div>
      </Modal>
    </>
  );
}
