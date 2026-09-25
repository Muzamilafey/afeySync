'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { api } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input } from '@/components/ui';
import { ago } from '@/lib/utils';

/** Change your own password. On first sign-in (`first`) it is the only thing the user can do. */
export function ChangePasswordCard({ first, lastChanged }: { first?: boolean; lastChanged?: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } }),
    onSuccess: async () => {
      setCur(''); setNext(''); setConfirm('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      qc.invalidateQueries({ queryKey: ['my-activity'] });
      if (first) setTimeout(() => router.push('/dashboard'), 800);
    },
  });
  const strong = next.length >= 10 && /[a-z]/.test(next) && /[A-Z]/.test(next) && /\d/.test(next);
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> {first ? 'Set your own password' : 'Password'}</span>} className="max-w-xl">
      {first ? (
        <div className="mb-3"><Alert tone="blue">For your security, choose a new password before you continue. Enter the temporary password you were given as your current password.</Alert></div>
      ) : (
        <p className="muted mb-3 text-sm">{lastChanged ? `Last changed ${ago(lastChanged)}.` : 'Use a password you do not use anywhere else.'} Changing it keeps you signed in here.</p>
      )}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (next === confirm) m.mutate(); }}>
        <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 10 characters with upper and lower case letters and a number."><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" error={confirm && confirm !== next ? 'Passwords do not match' : undefined}><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        <ErrorText error={m.error} />
        {m.isSuccess && <Alert tone="green">Password changed. We emailed you a notice.</Alert>}
        <Button type="submit" loading={m.isPending} disabled={!cur || !strong || next !== confirm}>Update password</Button>
      </form>
    </Card>
  );
}
