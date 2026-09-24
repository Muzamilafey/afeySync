'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, PageHeader } from '@/components/ui';

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({ mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } }), onSuccess: () => setTimeout(() => router.push('/dashboard'), 800) });
  return (
    <>
      <PageHeader title="Account security" />
      <Card title="Change password" className="max-w-lg">
        {params.get('first') && <div className="mb-3"><Alert tone="amber">Please set a new password before continuing.</Alert></div>}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (next === confirm) m.mutate(); }}>
          <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 10 characters with upper and lower case letters and a digit."><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password" error={confirm && confirm !== next ? 'Passwords do not match' : undefined}><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
          <ErrorText error={m.error} />
          {m.isSuccess && <Alert tone="green">Password changed.</Alert>}
          <Button type="submit" loading={m.isPending}>Update password</Button>
        </form>
      </Card>
    </>
  );
}

export default function AccountPage() {
  return <Suspense><Inner /></Suspense>;
}
