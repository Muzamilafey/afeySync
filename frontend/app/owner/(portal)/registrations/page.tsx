'use client';

import { useState } from 'react';
import { useOwnerPlans } from '@/features/billing-docs/useOwnerPlans';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { INTEREST_COPY } from '@/features/onboarding/constants';

interface Application {
  _id: string; reference: string; status: 'submitted' | 'approved' | 'rejected'; slug: string; address: string; plan: string; interests: string[];
  facility: { name: string; legalName?: string; facilityType?: string; facilityLevel?: string; ownership?: string; facilityCode?: string; registrationNumber?: string; county?: string; subCounty?: string; physicalAddress?: string; phone?: string; email?: string; bedCapacity?: number };
  branches: Array<{ branchName: string; branchCode: string; county?: string; physicalAddress?: string }>;
  admin: { name: string; email: string; phone?: string; jobTitle?: string };
  expectedUsers?: number; heardFrom?: string; notes?: string; submittedAt?: string; reviewedByName?: string; reviewedAt?: string; rejectionReason?: string; autoApproved?: boolean; provisioningError?: string; ip?: string;
}
const TONE = { submitted: 'amber', approved: 'green', rejected: 'red' } as const;

export default function RegistrationsPage() {
  const qc = useQueryClient();
  const plans = useOwnerPlans();
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Application | null>(null);
  const [plan, setPlan] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const list = useQuery({ queryKey: ['owner-applications', status, q], queryFn: async () => ownerApi<Application[]>('/onboarding/applications', { query: { status: status || undefined, q: q.trim() || undefined, limit: 100 } }) });
  const settings = useQuery({ queryKey: ['owner-onboarding-settings'], queryFn: async () => (await ownerApi<{ approvalMode: 'manual' | 'automatic' }>('/onboarding/settings')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner-applications'] });
  const mode = useMutation({ mutationFn: (approvalMode: string) => ownerApi('/onboarding/settings', { method: 'PUT', body: { approvalMode } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-onboarding-settings'] }) });
  const approve = useMutation({ mutationFn: async (a: Application) => (await ownerApi<{ loginUrl: string }>(`/onboarding/applications/${a._id}/approve`, { method: 'POST', body: plan ? { plan } : {} })).data, onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['owner-tenants'] }); } });
  const reject = useMutation({ mutationFn: (a: Application) => ownerApi(`/onboarding/applications/${a._id}/reject`, { method: 'POST', body: { reason } }), onSuccess: () => { setOpen(null); setRejecting(false); setReason(''); refresh(); } });
  const pending = (list.data?.meta as { pending?: number } | undefined)?.pending ?? 0;
  const show = (a: Application) => { setOpen(a); setPlan(a.plan); setRejecting(false); setReason(''); approve.reset(); reject.reset(); };

  return (
    <>
      <PageHeader title="Facility registrations" crumbs={['Owner', 'Registrations']} subtitle={<span>Self-service applications from <code>/get-started</code>. {pending > 0 && <Badge tone="amber">{pending} awaiting review</Badge>}</span>} />
      <Card title="Approval mode" className="mb-5">
        {settings.data ? (
          <div className="flex flex-wrap items-center gap-4">
            <Select className="max-w-xs" value={settings.data.approvalMode} onChange={(e) => mode.mutate(e.target.value)} disabled={mode.isPending}>
              <option value="manual">Manual review (recommended)</option>
              <option value="automatic">Automatic after email verification</option>
            </Select>
            <p className="muted flex-1 text-sm">{settings.data.approvalMode === 'manual' ? 'Each registration waits for a platform owner to approve it before a facility is created.' : 'A facility is created as soon as the applicant confirms their email. Use only when you are ready to accept sign-ups without review.'}</p>
          </div>
        ) : <Loading />}
        <ErrorText error={mode.error} />
      </Card>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select className="max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="submitted">Awaiting review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select>
        <Input className="max-w-xs" placeholder="Facility, address, email or reference" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorText error={list.error} /> : (
        <Table head={['Facility', 'Address', 'County', 'Plan', 'Administrator', 'Submitted', 'Status', '']} empty={!list.data?.data.length}>
          {list.data?.data.map((a) => (
            <tr key={a._id}>
              <Td><span className="font-medium">{a.facility.name}</span><div className="muted text-xs">{a.reference} · {a.facility.facilityType}</div></Td>
              <Td className="font-mono text-xs">{a.address}</Td>
              <Td>{a.facility.county}</Td>
              <Td className="capitalize">{a.plan}</Td>
              <Td>{a.admin.name}<div className="muted text-xs">{a.admin.email}</div></Td>
              <Td className="text-xs">{a.submittedAt ? fmtDateTime(a.submittedAt) : '—'}</Td>
              <Td><Badge tone={TONE[a.status]}>{a.status}</Badge>{a.provisioningError && <div className="text-xs text-red-600">setup failed</div>}</Td>
              <Td><Button size="sm" variant={a.status === 'submitted' ? 'primary' : 'ghost'} onClick={() => show(a)}>{a.status === 'submitted' ? 'Review' : 'View'}</Button></Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.facility.name} · ${open.reference}` : ''} wide>
        {open && (
          <div className="space-y-5">
            {approve.data ? (
              <Alert tone="green" title="Facility created">The administrator has been emailed. Sign-in page: <a className="font-medium underline" href={approve.data.loginUrl} target="_blank" rel="noreferrer">{approve.data.loginUrl} <ExternalLink className="inline h-3 w-3" /></a></Alert>
            ) : open.provisioningError ? <Alert tone="red" title="Previous setup attempt failed">{open.provisioningError}</Alert> : null}
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="label mb-2">Facility</p>
                <KV items={[['Name', open.facility.name], ['Legal name', open.facility.legalName], ['Type', [open.facility.facilityType, open.facility.facilityLevel].filter(Boolean).join(' · ')], ['Ownership', open.facility.ownership], ['KMHFL code', open.facility.facilityCode], ['Licence no.', open.facility.registrationNumber], ['Location', [open.facility.physicalAddress, open.facility.subCounty, open.facility.county].filter(Boolean).join(', ')], ['Phone', open.facility.phone], ['Email', open.facility.email], ['Beds', open.facility.bedCapacity]]} />
              </div>
              <div>
                <p className="label mb-2">Administrator</p>
                <KV items={[['Name', open.admin.name], ['Title', open.admin.jobTitle], ['Email (verified)', open.admin.email], ['Mobile', open.admin.phone]]} />
                <p className="label mt-4 mb-2">Setup</p>
                <KV items={[['Address', open.address], ['Branches', open.branches.map((b) => `${b.branchName} (${b.branchCode})`).join(', ')], ['Modules', open.interests.map((i) => INTEREST_COPY[i]?.label ?? i).join(', ') || '—'], ['Expected users', open.expectedUsers], ['Heard from', open.heardFrom], ['Submitted', open.submittedAt ? fmtDateTime(open.submittedAt) : '—'], ['From IP', open.ip]]} />
              </div>
            </div>
            {open.notes && <div><p className="label mb-1">Notes from the applicant</p><p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm whitespace-pre-wrap">{open.notes}</p></div>}
            {open.status !== 'submitted' ? (
              <Alert tone={open.status === 'approved' ? 'green' : 'amber'}>{open.status === 'approved' ? `Approved ${open.autoApproved ? 'automatically' : `by ${open.reviewedByName}`}` : `Rejected by ${open.reviewedByName}: ${open.rejectionReason}`} {open.reviewedAt && `on ${fmtDateTime(open.reviewedAt)}`}.</Alert>
            ) : !approve.data && (
              rejecting ? (
                <div className="space-y-3">
                  <Field label="Reason (sent to the applicant)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <ErrorText error={reject.error} />
                  <div className="flex gap-2"><Button variant="danger" onClick={() => reject.mutate(open)} loading={reject.isPending} disabled={reason.trim().length < 5}>Reject registration</Button><Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button></div>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
                  <Field label="Plan"><Select value={plan} onChange={(e) => setPlan(e.target.value)}>{(plans.data ?? []).filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
                  <Button onClick={() => approve.mutate(open)} loading={approve.isPending}>Approve & create facility</Button>
                  <Button variant="ghost" onClick={() => setRejecting(true)}>Reject…</Button>
                  <div className="w-full"><ErrorText error={approve.error} /></div>
                  <p className="muted w-full text-xs">Approving creates the facility database, its web address, default roles and the administrator account with the password they chose, then emails them the sign-in link. The facility starts on a 30-day trial.</p>
                </div>
              )
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
