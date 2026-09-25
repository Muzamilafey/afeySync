'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Activity } from 'lucide-react';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useQueryClient } from '@tanstack/react-query';
import { MfaChallenge } from '@/features/auth/MfaChallenge';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { InstallButton } from '@/features/pwa/InstallButton';
import type { LoginResult, MfaChallengeData } from '@/features/auth/types';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Password is required') });

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setToken = useSessionStore((s) => s.setToken);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const finish = (r: LoginResult) => {
    setToken('tenant', r.accessToken!);
    qc.clear();
    const next = params.get('next');
    router.replace(r.mfaEnrollmentRequired ? '/setup-2fa' : r.mustChangePassword ? '/account?first=1' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<LoginResult & Partial<MfaChallengeData>>('/auth/login', { method: 'POST', body: values, auth: false });
      if (res.data.mfaRequired) setChallenge(res.data as MfaChallengeData);
      else finish(res.data);
    } catch (e) {
      setError(e);
    }
  });

  if (challenge) return <MfaChallenge realm="tenant" challenge={challenge} onSuccess={finish} onCancel={() => setChallenge(null)} />;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ErrorText error={error} />
      <Field label="Email" error={formState.errors.email?.message}>
        <Input type="email" autoComplete="username" autoFocus {...register('email')} />
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm"><a className="text-brand-600" href="/forgot-password">Forgot password?</a></p>
      <GoogleButton realm="tenant" next={params.get('next')} />
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-7 w-7 text-brand-600" />
          <div>
            <p className="text-lg font-semibold">AfeySync</p>
            <p className="muted text-xs">Hospital Management Information System</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-center text-sm">
          New to AfeySync? <a href="/get-started" className="font-semibold text-brand-600 hover:underline">Register your facility →</a>
        </div>
        <div className="mt-3"><InstallButton variant="card" /></div>
        <p className="muted mt-4 text-center text-xs">Access is logged and audited. Authorized personnel only.</p>
      </div>
    </div>
  );
}
