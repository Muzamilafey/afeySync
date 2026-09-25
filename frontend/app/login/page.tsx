'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui';
import { BrandMark, PoweredBy, useHostContext, type HostContext } from '@/features/branding/branding';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useQueryClient } from '@tanstack/react-query';
import { MfaChallenge } from '@/features/auth/MfaChallenge';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { InstallButton } from '@/features/pwa/InstallButton';
import type { LoginResult, MfaChallengeData } from '@/features/auth/types';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Password is required') });

interface FacilityMatch { name: string; slug: string; url: string }

function LoginForm({ ctx }: { ctx: HostContext | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const setToken = useSessionStore((s) => s.setToken);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const [choices, setChoices] = useState<FacilityMatch[] | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const platform = ctx?.kind === 'platform';

  // Arriving from the main-domain sign-in: exchange the one-time handoff (kept in the URL fragment, never sent to servers).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const m = /handoff=([A-Za-z0-9_-]{20,100})/.exec(window.location.hash);
    if (!m) return;
    started.current = true;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setHandingOff(true);
    api<LoginResult & Partial<MfaChallengeData>>('/auth/handoff', { method: 'POST', body: { token: m[1] }, auth: false })
      .then((res) => (res.data.mfaRequired ? setChallenge(res.data as MfaChallengeData) : finish(res.data)))
      .catch((e) => setError(e))
      .finally(() => setHandingOff(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (r: LoginResult) => {
    setToken('tenant', r.accessToken!);
    qc.clear();
    const next = params.get('next');
    router.replace(r.mfaEnrollmentRequired ? '/setup-2fa' : r.mustChangePassword ? '/account?first=1' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      if (platform) {
        // Main domain: find the user's facility and continue on its own address.
        const r = await api<{ facilities: FacilityMatch[] }>('/auth/find-facility', { method: 'POST', body: values, auth: false });
        const next = params.get('next');
        const withNext = (u: string) => (next && next.startsWith('/') && !next.startsWith('//') ? u.replace('/login#', `/login?next=${encodeURIComponent(next)}#`) : u);
        if (r.data.facilities.length === 1) window.location.assign(withNext(r.data.facilities[0].url));
        else setChoices(r.data.facilities.map((f) => ({ ...f, url: withNext(f.url) })));
        return;
      }
      const res = await api<LoginResult & Partial<MfaChallengeData>>('/auth/login', { method: 'POST', body: values, auth: false });
      if (res.data.mfaRequired) setChallenge(res.data as MfaChallengeData);
      else finish(res.data);
    } catch (e) {
      setError(e);
    }
  });

  if (challenge) return <MfaChallenge realm="tenant" challenge={challenge} onSuccess={finish} onCancel={() => setChallenge(null)} />;
  if (handingOff) return <p className="flex items-center justify-center gap-2 py-10 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Signing you in…</p>;
  if (choices)
    return (
      <div className="space-y-3">
        <div><p className="font-semibold">Choose a facility</p><p className="muted text-sm">Your account is active at more than one facility.</p></div>
        {choices.map((f) => (
          <a key={f.slug} href={f.url} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition hover:border-brand-500 hover:bg-[var(--surface-2)]">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40"><Building2 className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span><span className="muted block truncate text-xs">{new URL(f.url).host}</span></span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </a>
        ))}
        <p className="muted text-xs">These links work once and expire in 2 minutes.</p>
        <button type="button" className="muted w-full text-center text-xs underline" onClick={() => setChoices(null)}>Back to sign in</button>
      </div>
    );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {ctx?.kind === 'unknown' && !error && ctx.message && (
        <Alert tone="blue" title="Facility not found at this address">
          {ctx.message}
          <a href={`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.') || window.location.host}/login`} className="mt-2 block font-medium underline">Go to the main sign-in page</a>
        </Alert>
      )}
      <ErrorText error={error} />
      <Field label="Email" error={formState.errors.email?.message}>
        <Input type="email" autoComplete="username" autoFocus {...register('email')} />
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting} disabled={!ctx}>
        Sign in
      </Button>
      {!platform && <p className="text-center text-sm"><a className="text-brand-600" href="/forgot-password">Forgot password?</a></p>}
      {platform && <p className="muted text-center text-xs">We&apos;ll take you to your facility&apos;s own AfeySync address. Forgot your password? Reset it from your facility&apos;s sign-in page.</p>}
      {!platform && <GoogleButton realm="tenant" next={params.get('next')} />}
    </form>
  );
}

export default function LoginPage() {
  const { data: ctx, isError } = useHostContext();
  const context: HostContext | null = ctx ?? (isError ? { kind: 'unknown' } : null);
  const branding = context?.kind === 'facility' ? context.branding ?? null : null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <BrandMark branding={branding} className="mb-4" />
        {branding?.welcomeMessage && <p className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900 dark:bg-brand-900/30 dark:text-brand-100">{branding.welcomeMessage}</p>}
        <Suspense>
          <LoginForm ctx={context} />
        </Suspense>
        {!branding && (
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-center text-sm">
            New to AfeySync? <a href="/get-started" className="font-semibold text-brand-600 hover:underline">Register your facility →</a>
          </div>
        )}
        <div className="mt-3"><InstallButton variant="card" /></div>
        <p className="muted mt-4 text-center text-xs">Access is logged and audited. Authorized personnel only.</p>
        <PoweredBy branding={branding} />
      </div>
    </div>
  );
}
