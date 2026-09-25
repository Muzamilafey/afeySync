'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History, Laptop, ShieldAlert, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, ErrorText, Loading, PageHeader } from '@/components/ui';
import { ago, fmtDateTime } from '@/lib/utils';
import { MfaSettings } from '@/features/auth/MfaSettings';
import { GoogleLinkCard } from '@/features/auth/GoogleLinkCard';
import { ChangePasswordCard } from '@/features/account/ChangePasswordCard';
import type { MyActivity, MyProfile, MySession } from '@/features/account/types';

function Overview({ p }: { p: MyProfile }) {
  const items = [
    { ok: p.security.twoStep.length > 0, title: 'Two-step verification', text: p.security.twoStep.length ? p.security.twoStep.join(', ') : 'Not set up. Add a second step below to protect your account.' },
    { ok: !!p.security.passwordChangedAt, title: 'Password', text: p.security.passwordChangedAt ? `Changed ${ago(p.security.passwordChangedAt)}` : 'Never changed' },
    { ok: true, title: 'Sign in with Google', text: p.security.googleLinked ? 'Linked' : 'Not linked (optional)' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.title} className="surface flex gap-3 rounded-xl p-4">
          {i.ok ? <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />}
          <div className="min-w-0"><p className="text-sm font-semibold">{i.title}</p><p className="muted text-xs">{i.text}</p></div>
        </div>
      ))}
    </div>
  );
}

function Devices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-sessions'], queryFn: async () => (await api<MySession[]>('/auth/sessions')).data });
  const done = () => { qc.invalidateQueries({ queryKey: ['my-sessions'] }); qc.invalidateQueries({ queryKey: ['my-activity'] }); };
  const one = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}/revoke`, { method: 'POST' }), onSuccess: done });
  const others = useMutation({ mutationFn: () => api('/auth/sessions/revoke-others', { method: 'POST' }), onSuccess: done });
  const count = q.data?.filter((s) => !s.current).length ?? 0;
  return (
    <Card title={<span className="flex items-center gap-2"><Laptop className="h-4 w-4" /> Where you&apos;re signed in</span>} actions={count > 0 && <Button size="sm" variant="outline" onClick={() => others.mutate()} loading={others.isPending}>Sign out all other devices</Button>}>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error || one.error || others.error} />
      <ul className="divide-y divide-[var(--border)]">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
            {/Android|iPhone|iPad/.test(s.device) ? <Smartphone className="h-5 w-5 text-slate-400" /> : <Laptop className="h-5 w-5 text-slate-400" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.device} {s.current && <Badge tone="green" className="ml-1">This device</Badge>}</p>
              <p className="muted text-xs">Signed in {fmtDateTime(s.signedInAt)}{s.ip ? ` · ${s.ip}` : ''} · active {ago(s.lastActiveAt)} · {s.method}</p>
            </div>
            {!s.current && <Button size="sm" variant="ghost" onClick={() => one.mutate(s.id)} loading={one.isPending && one.variables === s.id}>Sign out</Button>}
          </li>
        ))}
      </ul>
      <p className="muted mt-2 text-xs">Don&apos;t recognise a device? Sign it out and change your password.</p>
    </Card>
  );
}

function Activity() {
  const q = useQuery({ queryKey: ['my-activity'], queryFn: async () => (await api<MyActivity[]>('/auth/activity')).data });
  return (
    <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4" /> Recent security activity</span>}>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error} />
      {q.data && q.data.length === 0 && <p className="muted text-sm">No activity yet.</p>}
      <ul className="space-y-2">
        {q.data?.map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {a.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
            <div className="min-w-0"><p className={a.ok ? '' : 'font-medium text-red-600 dark:text-red-400'}>{a.event}</p><p className="muted text-xs">{fmtDateTime(a.at)}{a.ip ? ` · ${a.ip}` : ''}{a.device && a.device !== 'Unknown device' ? ` · ${a.device}` : ''}</p></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Inner() {
  const params = useSearchParams();
  const profile = useQuery({ queryKey: ['my-profile'], queryFn: async () => (await api<MyProfile>('/auth/profile')).data });
  return (
    <>
      <PageHeader title="Security" subtitle="Your password, two-step verification and the devices signed in to your account." crumbs={['My account', 'Security']} actions={<Link href="/account/profile"><Button variant="outline"><UserRound className="h-4 w-4" /> My profile</Button></Link>} />
      <div className="max-w-5xl space-y-5">
        {profile.data && <Overview p={profile.data} />}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChangePasswordCard lastChanged={profile.data?.security.passwordChangedAt} />
          <GoogleLinkCard realm="tenant" justLinked={params.get('google') === 'linked'} />
        </div>
        <MfaSettings realm="tenant" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Devices />
          <Activity />
        </div>
      </div>
    </>
  );
}

export default function SecurityPage() {
  return <Suspense><Inner /></Suspense>;
}
