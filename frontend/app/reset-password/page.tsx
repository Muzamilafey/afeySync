'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity } from 'lucide-react';
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui';
import { api } from '@/services/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!token) return <Alert tone="red">This reset link is incomplete. Request a new one.</Alert>;
  if (done) return <Alert tone="green" title="Password changed">You have been signed out of all devices. <Link className="font-medium underline" href="/login">Sign in</Link> with your new password.</Alert>;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: pw }, auth: false });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorText error={error} />
      <Field label="New password" hint="At least 10 characters with upper and lower case letters and a number"><Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirm password" error={mismatch ? 'Passwords do not match' : undefined}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <Button type="submit" className="w-full" loading={busy} disabled={!pw || pw !== pw2}>Set new password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-7 w-7 text-brand-600" />
          <p className="text-lg font-semibold">Choose a new password</p>
        </div>
        <Suspense><ResetForm /></Suspense>
      </div>
    </div>
  );
}
