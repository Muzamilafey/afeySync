'use client';

import { useState } from 'react';
import { InstallButton } from '@/features/pwa/InstallButton';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { MfaChallenge } from '@/features/auth/MfaChallenge';
import { GoogleButton } from '@/features/auth/GoogleButton';
import type { LoginResult, MfaChallengeData } from '@/features/auth/types';

export default function OwnerLogin() {
  const router = useRouter();
  const qc = useQueryClient();
  const setToken = useSessionStore((s) => s.setToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const finish = (r: LoginResult) => {
    setToken('owner', r.accessToken!);
    qc.clear();
    router.replace(r.mfaEnrollmentRequired ? '/owner/setup-2fa' : '/owner');
  };
  if (challenge) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl"><MfaChallenge realm="owner" challenge={challenge} onSuccess={finish} onCancel={() => setChallenge(null)} /></div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <form
        className="surface w-full max-w-sm space-y-4 rounded-2xl p-6 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api<LoginResult & Partial<MfaChallengeData>>('/owner/auth/login', { method: 'POST', body: { email, password }, auth: false, realm: 'owner' });
            if (res.data.mfaRequired) setChallenge(res.data as MfaChallengeData);
            else finish(res.data);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-brand-600" />
          <div>
            <p className="font-semibold">AfeySync Owner Portal</p>
            <p className="muted text-xs">Platform administration — no clinical access</p>
          </div>
        </div>
        <ErrorText error={error} />
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
        <GoogleButton realm="owner" />
        <InstallButton variant="card" />
      </form>
    </div>
  );
}
