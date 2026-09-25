'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select, Table, Td, statusTone } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { MfaSettings } from '@/features/auth/MfaSettings';
import { GoogleLinkCard } from '@/features/auth/GoogleLinkCard';

interface MyLeave { staff: { fullName: string; employeeNumber: string } | null; items: Array<{ _id: string; type: string; startDate: string; endDate: string; days: number; status: string }> }

/** Self-service leave: request and track your own leave (approval is by HR, never by yourself). */
function MyLeaveCard() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: 'annual', startDate: today, endDate: today, reason: '' });
  const q = useQuery({ queryKey: ['my-leave'], queryFn: async () => (await api<MyLeave>('/hr/leave/mine')).data });
  const m = useMutation({ mutationFn: () => api('/hr/leave', { method: 'POST', body: { ...f, reason: f.reason || undefined } }), onSuccess: () => { setF({ ...f, reason: '' }); qc.invalidateQueries({ queryKey: ['my-leave'] }); } });
  if (!q.data?.staff) return null;
  return (
    <Card title={`My leave — ${q.data.staff.fullName} (${q.data.staff.employeeNumber})`} className="mt-5 max-w-3xl">
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="From"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="space-y-2 sm:col-span-4"><ErrorText error={m.error} /><Button size="sm" onClick={() => m.mutate()} loading={m.isPending}>Request leave</Button></div>
      </div>
      <Table head={['Type', 'From', 'To', 'Days', 'Status']} empty={q.data.items.length === 0}>
        {q.data.items.map((l) => <tr key={l._id}><Td className="capitalize">{l.type}</Td><Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td><Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td></tr>)}
      </Table>
    </Card>
  );
}

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const qc = useQueryClient();
  const first = !!params.get('first');
  const m = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => router.push('/dashboard'), 800);
    },
  });
  return (
    <>
      <PageHeader title={first ? 'Welcome! Choose your password' : 'Account security'} />
      <Card title={first ? 'Set your own password' : 'Change password'} className="max-w-lg">
        {first && <div className="mb-3"><Alert tone="blue">For your security, choose a new password before you continue. Enter the temporary password you were given as your current password.</Alert></div>}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (next === confirm) m.mutate(); }}>
          <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 10 characters with upper and lower case letters and a digit."><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password" error={confirm && confirm !== next ? 'Passwords do not match' : undefined}><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
          <ErrorText error={m.error} />
          {m.isSuccess && <Alert tone="green">Password changed.</Alert>}
          <Button type="submit" loading={m.isPending}>Update password</Button>
        </form>
      </Card>
      {!params.get('first') && <div className="mt-5 max-w-3xl space-y-5"><MfaSettings realm="tenant" /><GoogleLinkCard realm="tenant" justLinked={params.get('google') === 'linked'} /></div>}
      {!params.get('first') && <MyLeaveCard />}
    </>
  );
}

export default function AccountPage() {
  return <Suspense><Inner /></Suspense>;
}
