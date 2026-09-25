'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Mail, Phone, ShieldCheck, Stethoscope } from 'lucide-react';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, PageHeader } from '@/components/ui';
import { ago, fmtDate } from '@/lib/utils';
import { MyLeaveCard } from '@/features/account/MyLeaveCard';
import type { MyProfile } from '@/features/account/types';

export default function ProfilePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-profile'], queryFn: async () => (await api<MyProfile>('/auth/profile')).data });
  const [f, setF] = useState({ name: '', phone: '' });
  useEffect(() => { if (q.data) setF({ name: q.data.name, phone: q.data.phone ?? '' }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/auth/profile', { method: 'PATCH', body: f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-profile'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const p = q.data;
  const dirty = f.name.trim() !== p.name || f.phone.trim() !== (p.phone ?? '');
  return (
    <>
      <PageHeader title="My profile" crumbs={['My account', 'Profile']} actions={<Link href="/account/security"><Button variant="outline"><ShieldCheck className="h-4 w-4" /> Security</Button></Link>} />
      <div className="max-w-5xl space-y-5">
        <div className="surface flex flex-wrap items-center gap-4 rounded-2xl p-5">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-600 text-2xl font-bold text-white">{p.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{p.name}</p>
            <p className="muted flex items-center gap-1.5 text-sm"><Mail className="h-3.5 w-3.5" /> {p.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">{p.roles.map((r) => <Badge key={r.key} tone="blue">{r.name}</Badge>)}</div>
          </div>
          <div className="text-right text-xs">
            <p className="muted">Member since {fmtDate(p.memberSince)}</p>
            <p className="muted">Last sign-in {ago(p.lastLoginAt)}</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Personal details">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Field label="Full name"><Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Phone" hint="Used for SMS sign-in codes if you turn them on."><Input type="tel" value={f.phone} maxLength={30} placeholder="e.g. 0712345678" onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="Email (sign-in)" hint="Ask an administrator to change your sign-in email."><Input value={p.email} disabled /></Field>
              <ErrorText error={save.error} />
              {save.isSuccess && !dirty && <Alert tone="green">Saved.</Alert>}
              <Button type="submit" loading={save.isPending} disabled={!dirty || f.name.trim().length < 2}>Save changes</Button>
            </form>
          </Card>

          <Card title="Work details">
            <KV
              items={[
                ['Facility', <span key="f" className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> {p.facility}</span>],
                ['Branches', p.branchAccess === 'all' ? 'All branches' : p.branches.map((b) => b.name).join(', ') || '—'],
                ['Default branch', p.defaultBranch ?? '—'],
                ['Roles', p.roles.map((r) => r.name).join(', ')],
                ['Cadre', p.practitioner.cadre ? <span key="c" className="flex items-center gap-1.5"><Stethoscope className="h-3.5 w-3.5" /> {p.practitioner.cadre}</span> : '—'],
                ['Licence number', p.practitioner.licenseNumber ? <span key="l" className="flex items-center gap-1.5">{p.practitioner.licenseNumber}{p.practitioner.registryVerified && <Badge tone="green"><BadgeCheck className="mr-0.5 inline h-3 w-3" />verified</Badge>}</span> : '—'],
                ['Phone', p.phone ? <span key="p" className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {p.phone}</span> : '—'],
              ]}
            />
            <p className="muted mt-3 text-xs">Roles, branches and licence details are managed by your facility administrator.</p>
          </Card>
        </div>

        <MyLeaveCard />
      </div>
    </>
  );
}
