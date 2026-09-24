'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useMe } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, StatusDot } from '@/components/ui';
import type { Branch } from '@/types/api';

const FIELDS: Array<[keyof Branch, string, string?]> = [
  ['branchName', 'Branch name *'],
  ['branchCode', 'Branch code *'],
  ['facilityCode', 'Facility (KMHFL) code'],
  ['registrationNumber', 'Registration number'],
  ['facilityLevel', 'Level', 'e.g. Level 3A'],
  ['facilityType', 'Facility type'],
  ['county', 'County'],
  ['subCounty', 'Sub-county'],
  ['ward', 'Ward'],
  ['physicalAddress', 'Physical address'],
  ['phone', 'Phone'],
  ['email', 'Email'],
];
const SERVICES = ['opd', 'inpatient', 'maternity', 'laboratory', 'radiology', 'pharmacy', 'dental', 'mortuary', 'billing'];

function BranchForm({ branch, onDone }: { branch?: Branch; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(branch ?? {}), services: branch?.services ?? { opd: true, pharmacy: true, billing: true } }));
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const [k] of FIELDS) if (form[k] !== undefined && form[k] !== '') body[k] = form[k];
      body.bedCapacity = Number(form.bedCapacity ?? 0);
      body.services = form.services;
      return branch ? api(`/branches/${branch._id}`, { method: 'PATCH', body }) : api('/branches', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      onDone();
    },
  });
  const services = (form.services ?? {}) as Record<string, boolean>;
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      {FIELDS.map(([k, label, ph]) => (
        <Field key={k} label={label}><Input value={String(form[k] ?? '')} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
      ))}
      <Field label="Bed capacity"><Input type="number" min={0} value={String(form.bedCapacity ?? 0)} onChange={(e) => setForm({ ...form, bedCapacity: e.target.value })} /></Field>
      <div className="col-span-full">
        <p className="label">Branch services</p>
        <div className="flex flex-wrap gap-3">
          {SERVICES.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm capitalize">
              <input type="checkbox" checked={!!services[s]} onChange={(e) => setForm({ ...form, services: { ...services, [s]: e.target.checked } })} /> {s}
            </label>
          ))}
        </div>
      </div>
      <div className="col-span-full space-y-2">
        <ErrorText error={m.error} />
        <Button type="submit" loading={m.isPending}>{branch ? 'Save branch' : 'Create branch'}</Button>
      </div>
    </form>
  );
}

export default function BranchesPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  const q = useQuery({ queryKey: ['branches'], queryFn: async () => (await api<Branch[]>('/branches')).data });
  const toggle = useMutation({
    mutationFn: (b: Branch) => api(`/branches/${b._id}/${b.status === 'active' ? 'suspend' : 'activate'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
  const tenantWide = me?.user.branchAccess === 'all';
  return (
    <>
      <PageHeader title="Branches" crumbs={['Admin', 'Organization', 'Branches']} actions={tenantWide && <Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> ADD BRANCH</Button>} />
      {q.isLoading && <Loading />}
      <ErrorText error={q.error || toggle.error} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((b) => (
          <Card key={b._id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-brand-600" /> {b.branchName} {b.isMain && <Badge tone="blue">Main</Badge>}</p>
                <p className="muted mt-1 text-sm">{[b.county, b.facilityLevel, `${b.bedCapacity ?? 0} Beds`, `${b.staffCount ?? 0} staff`].filter(Boolean).join(' | ')}</p>
                <p className="muted font-mono text-xs">{b.branchCode} {b.facilityCode && `· ${b.facilityCode}`}</p>
              </div>
              <StatusDot tone={b.status === 'active' ? 'green' : 'red'} label={b.status === 'active' ? 'Active' : 'Suspended'} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1">{Object.entries(b.services ?? {}).filter(([, v]) => v).map(([k]) => <Badge key={k} className="capitalize">{k}</Badge>)}</div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit(b)}>Configure</Button>
              {tenantWide && !b.isMain && <Button size="sm" variant={b.status === 'active' ? 'danger' : 'primary'} onClick={() => toggle.mutate(b)}>{b.status === 'active' ? 'Suspend' : 'Activate'}</Button>}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add branch' : 'Configure branch'} wide>
        {edit && <BranchForm branch={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}
