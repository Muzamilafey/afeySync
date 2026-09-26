'use client';

import { AuthBackground } from '@/features/auth/AuthBackground';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui';
import { BrandMark, PoweredBy, useHostContext, type HostContext } from '@/features/branding/branding';
import { api, ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useQueryClient } from '@tanstack/react-query';
import { MfaChallenge } from '@/features/auth/MfaChallenge';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { InstallButton } from '@/features/pwa/InstallButton';
import type { LoginResult, MfaChallengeData } from '@/features/auth/types';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Password is required') });

interface FacilityMatch { name: string; slug: string; url: string }
interface FacilityChoice { name: string; slug: string; ticket: string }
/** What the accounts sign-in answers: go to the facility, verify here first, or choose a facility. */
type AccountsStep = { facilities?: FacilityMatch[]; choices?: FacilityChoice[]; facility?: { name: string; slug: string }; handoffUrl?: string } & Partial<MfaChallengeData>;
const HANDOFF_URL = /^https?:\/\/[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9.-]+(:\d{1,5})?\/login#handoff=[A-Za-z0-9_-]{20,100}$/;

function LoginForm({ ctx }: { ctx: HostContext | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const setToken = useSessionStore((s) => s.setToken);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState, setValue } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const [choices, setChoices] = useState<FacilityMatch[] | null>(null);
  const [tickets, setTickets] = useState<FacilityChoice[] | null>(null);
  const [verifyingFor, setVerifyingFor] = useState<{ name: string; slug: string } | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const central = !!ctx?.centralLogin;
  const accounts = ctx?.kind === 'accounts';
  // Where the password form looks up the user's facilities: the accounts address (central sign-in) or the main page.
  const platform = central ? accounts : ctx?.kind === 'platform';
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null;

  /** Sends the browser to the accounts sign-in, keeping the facility, the page to return to and (in the fragment, never sent to servers) the email. */
  const toAccounts = (accountsUrl: string, extra: Record<string, string> = {}, email?: string) => {
    const q = new URLSearchParams(extra);
    if (ctx?.kind === 'facility' && ctx.facility?.slug) q.set('facility', ctx.facility.slug);
    if (safeNext) q.set('next', safeNext);
    setLeaving(true);
    window.location.replace(`${accountsUrl}/login${q.toString() ? `?${q}` : ''}${email ? `#email=${encodeURIComponent(email)}` : ''}`);
  };

  // An expired or refused hand-over goes straight back to the accounts sign-in (once its address is known).
  useEffect(() => {
    if (handoffFailed && ctx?.accountsUrl) toAccounts(ctx.accountsUrl, { expired: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffFailed, ctx]);

  // On the accounts page: pre-fill the email handed over in the fragment, and explain why the user is here again.
  useEffect(() => {
    if (!accounts) return;
    const m = /email=([^&]+)/.exec(window.location.hash);
    if (m) {
      setValue('email', decodeURIComponent(m[1]));
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (params.get('expired')) setNotice('That sign-in link had expired or was opened in another browser. Please sign in again.');
  }, [accounts, params, setValue]);

  // Central sign-in: every other address sends the user to accounts, unless a handoff arrived here
  // (remembered from the first render: the fragment is removed from the address straight away).
  const arrived = useRef<boolean | null>(null);
  if (arrived.current === null && typeof window !== 'undefined') arrived.current = /handoff=/.test(window.location.hash);
  useEffect(() => {
    if (!ctx || !central || accounts || !ctx.accountsUrl || arrived.current) return;
    toAccounts(ctx.accountsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, central, accounts, safeNext]);

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
      .catch((e) => {
        // An expired or refused hand-over goes straight back to the accounts sign-in.
        if (e instanceof ApiError && e.code === 'HANDOFF_INVALID') setHandoffFailed(true);
        else setError(e);
      })
      .finally(() => setHandingOff(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (r: LoginResult) => {
    setToken('tenant', r.accessToken!);
    qc.clear();
    router.replace(r.mfaEnrollmentRequired ? '/setup-2fa' : r.mustChangePassword ? '/account?first=1' : safeNext ?? '/home');
  };

  const withNext = (u: string) => (safeNext ? u.replace('/login#', `/login?next=${encodeURIComponent(safeNext)}#`) : u);
  /** Leaves for the facility, but only for a link of the exact expected shape (facility sign-in page + one-time handoff). */
  const goToFacility = (url: string) => {
    if (!HANDOFF_URL.test(url)) return setError(new Error('Unexpected sign-in link. Please sign in again.'));
    setLeaving(true);
    window.location.assign(withNext(url));
  };
  const onAccountsStep = (d: AccountsStep) => {
    if (d.handoffUrl) return goToFacility(d.handoffUrl);
    if (d.mfaRequired) {
      setTickets(null);
      setVerifyingFor(d.facility ?? null);
      return setChallenge(d as MfaChallengeData);
    }
    if (d.choices) return setTickets(d.choices);
    const safe = (d.facilities ?? []).filter((f) => HANDOFF_URL.test(f.url));
    const wanted = safe.find((f) => f.slug === params.get('facility'));
    if (wanted || safe.length === 1) goToFacility((wanted ?? safe[0]).url);
    else setChoices(safe.map((f) => ({ ...f, url: withNext(f.url) })));
  };
  const choose = async (c: FacilityChoice) => {
    setError(null);
    setSelecting(c.slug);
    try {
      onAccountsStep((await api<AccountsStep>('/auth/find-facility/select', { method: 'POST', body: { ticket: c.ticket }, auth: false })).data);
    } catch (e) {
      setTickets(null);
      setError(e);
    } finally {
      setSelecting(null);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      if (platform) {
        // Main domain: find the user's facility and continue on its own address.
        const facility = params.get('facility');
        const r = await api<AccountsStep>('/auth/find-facility', { method: 'POST', body: { ...values, facility: facility && /^[a-z0-9-]{1,63}$/.test(facility) ? facility : undefined }, auth: false });
        onAccountsStep(r.data);
        return;
      }
      const res = await api<LoginResult & Partial<MfaChallengeData>>('/auth/login', { method: 'POST', body: values, auth: false });
      if (res.data.mfaRequired) setChallenge(res.data as MfaChallengeData);
      else finish(res.data);
    } catch (e) {
      // This address does not take passwords: continue on the accounts sign-in, email already filled in.
      const url = e instanceof ApiError && e.code === 'USE_ACCOUNTS_LOGIN' ? (e.details as { accountsUrl?: string } | undefined)?.accountsUrl ?? ctx?.accountsUrl : undefined;
      if (url && /^https?:\/\/accounts\.[a-z0-9.-]+(:\d{1,5})?$/.test(url)) return toAccounts(url, {}, values.email);
      setError(e);
    }
  });

  if (challenge)
    return (
      <div className="space-y-3">
        {accounts && verifyingFor && verifyingFor.slug !== ctx?.facility?.slug && <p className="muted text-sm">Signing in to <strong>{verifyingFor.name}</strong></p>}
        {/* On the accounts address a verified sign-in comes back as a one-time link to the facility. */}
        <MfaChallenge realm="tenant" challenge={challenge} onSuccess={(r) => (accounts ? onAccountsStep(r as AccountsStep) : finish(r))} onCancel={() => { setChallenge(null); setVerifyingFor(null); }} />
      </div>
    );
  if (tickets)
    return (
      <div className="space-y-3">
        <div><p className="font-semibold">Choose a facility</p><p className="muted text-sm">Your account is active at more than one facility.</p></div>
        <ErrorText error={error} />
        {tickets.map((f) => (
          <button key={f.slug} type="button" disabled={!!selecting} onClick={() => choose(f)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left transition hover:border-brand-500 hover:bg-[var(--surface-2)] disabled:opacity-60">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40"><Building2 className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
            {selecting === f.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          </button>
        ))}
        <button type="button" className="muted w-full text-center text-xs underline" onClick={() => setTickets(null)}>Back to sign in</button>
      </div>
    );
  if (leaving) return <p className="flex items-center justify-center gap-2 py-10 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> {accounts ? 'Taking you to your facility…' : 'Opening secure sign-in…'}</p>;
  if (handingOff || handoffFailed) return <p className="flex items-center justify-center gap-2 py-10 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Signing you in…</p>;
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
        <p className="muted text-xs">These links work once, only in this browser, and expire in 60 seconds.</p>
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
      {notice && !error && <Alert tone="blue">{notice}</Alert>}
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
      {(!platform || accounts) && <p className="text-center text-sm"><a className="text-brand-600" href="/forgot-password">Forgot password?</a></p>}
      {platform && <p className="muted text-center text-xs">After signing in we take you securely to your facility&apos;s own AfeySync address.</p>}
      {!platform && !central && <GoogleButton realm="tenant" next={params.get('next')} />}
    </form>
  );
}

export default function LoginPage() {
  const { data: ctx, isError } = useHostContext();
  const context: HostContext | null = ctx ?? (isError ? { kind: 'unknown' } : null);
  const branding = context?.kind === 'facility' ? context.branding ?? null : null;
  const continuing = context?.kind === 'accounts' ? context.facility : null;
  return (
    <AuthBackground>
      <div className="surface auth-card w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <BrandMark branding={branding} className="mb-4" />
        {context?.kind === 'accounts' && (
          <div className="mb-4">
            <p className="text-lg font-semibold">Sign in to AfeySync</p>
            <p className="muted text-sm">{continuing ? <>to continue to <strong>{continuing.name}</strong></> : 'One account for your facility.'}</p>
          </div>
        )}
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
    </AuthBackground>
  );
}
