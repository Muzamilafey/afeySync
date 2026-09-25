'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui';
import { api } from '@/services/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = (await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false })) as unknown as { message?: string };
      setSent(res.message ?? 'If the account exists, a reset link has been sent to its email address.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-7 w-7 text-brand-600" />
          <p className="text-lg font-semibold">Reset your password</p>
        </div>
        {sent ? (
          <Alert tone="green">{sent} The link expires in 30 minutes.</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="muted text-sm">Enter the email address on your AfeySync account at this facility.</p>
            <ErrorText error={error} />
            <Field label="Email"><Input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm"><Link className="text-brand-600" href="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
