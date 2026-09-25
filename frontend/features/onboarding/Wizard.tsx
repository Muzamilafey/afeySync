'use client';

import { cloneElement, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Clock, Globe2, Loader2, Lock, Mail, Plus, ShieldCheck, Sparkles, Trash2, UserRound, X, Layers, ClipboardCheck, MailCheck, Server } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { cn } from '@/lib/utils';
import { COUNTIES, FACILITY_LEVELS, FACILITY_TYPES, HEARD_FROM, INTEREST_COPY, OWNERSHIP } from './constants';

/* ------------------------------------------------------------------ Types & persistence */
interface Branch { branchName: string; branchCode: string; county: string; physicalAddress: string }
interface Form {
  plan: string;
  facility: { name: string; legalName: string; facilityType: string; facilityLevel: string; ownership: string; facilityCode: string; registrationNumber: string; county: string; subCounty: string; physicalAddress: string; phone: string; email: string; bedCapacity: string };
  slug: string;
  slugTouched: boolean;
  branches: Branch[];
  admin: { name: string; jobTitle: string; email: string; phone: string; password: string; confirm: string };
  interests: string[];
  expectedUsers: string;
  heardFrom: string;
  notes: string;
  acceptTerms: boolean;
}
interface PublicPlan { key: string; name: string; description?: string; prices: { monthly: number; quarterly: number; annual: number }; setupFee: number; maxBranches: number; maxUsers: number; trialDays: number; features: string[]; highlight?: boolean }
interface Config { platformDomain: string; approvalMode: 'manual' | 'automatic'; plans: PublicPlan[]; interests: string[] }
interface AppRef { token: string; reference: string; sentTo: string }
interface AppView { reference: string; status: 'email_pending' | 'submitted' | 'approved' | 'rejected'; facilityName: string; address: string; plan: string; email: string; rejectionReason?: string; loginUrl?: string }
interface SlugCheck { slug: string; address: string | null; available: boolean; reason: string | null; suggestion: string | null }

const EMPTY: Form = {
  plan: 'trial',
  facility: { name: '', legalName: '', facilityType: '', facilityLevel: '', ownership: 'Private', facilityCode: '', registrationNumber: '', county: '', subCounty: '', physicalAddress: '', phone: '', email: '', bedCapacity: '' },
  slug: '',
  slugTouched: false,
  branches: [{ branchName: 'Main Branch', branchCode: 'MAIN', county: '', physicalAddress: '' }],
  admin: { name: '', jobTitle: '', email: '', phone: '', password: '', confirm: '' },
  interests: ['sha', 'mpesa'],
  expectedUsers: '',
  heardFrom: '',
  notes: '',
  acceptTerms: false,
};
const DRAFT_KEY = 'afs-onboarding-draft';
const APP_KEY = 'afs-onboarding-app';
const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
const phoneOk = (p: string) => p.replace(/[^\d]/g, '').length >= 9;
const pwChecks = (p: string) => [
  { ok: p.length >= 10, label: 'At least 10 characters' },
  { ok: /[A-Z]/.test(p), label: 'An upper-case letter' },
  { ok: /[a-z]/.test(p), label: 'A lower-case letter' },
  { ok: /\d/.test(p), label: 'A number' },
];

const STEPS = [
  { key: 'plan', label: 'Choose a plan', hint: 'Start free, change any time', icon: Sparkles },
  { key: 'facility', label: 'Your facility', hint: 'Name, type and location', icon: Building2 },
  { key: 'address', label: 'Web address & branches', hint: 'Where your team signs in', icon: Globe2 },
  { key: 'admin', label: 'Administrator', hint: 'The first account', icon: UserRound },
  { key: 'modules', label: 'Modules', hint: 'What you want to use', icon: Layers },
  { key: 'review', label: 'Review', hint: 'Confirm and submit', icon: ClipboardCheck },
  { key: 'verify', label: 'Verify email', hint: 'One-time code', icon: MailCheck },
] as const;
type StepKey = (typeof STEPS)[number]['key'] | 'done';

/* ------------------------------------------------------------------ Small UI pieces */
/** Field wrapper: the label names the control; hints and errors are linked with aria-describedby. */
function L({ label, hint, error, children, className, optional }: { label: string; hint?: string; error?: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string }>; className?: string; optional?: boolean }) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">{label}{optional && <span className="text-xs font-normal text-slate-400" aria-hidden>Optional</span>}</label>
      {cloneElement(children, { id, 'aria-describedby': note ? noteId : undefined })}
      {note && <span id={noteId} className={cn('mt-1 block text-xs', error ? 'text-red-600' : 'text-slate-500')}>{note}</span>}
    </div>
  );
}
const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const TI = (p: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) => {
  const { invalid, className, ...rest } = p;
  return <input {...rest} aria-invalid={invalid || undefined} className={cn(inputCls, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/15', className)} />;
};
const SI = ({ invalid, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) => (
  <select {...rest} aria-invalid={invalid || undefined} className={cn(inputCls, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%272%27%3E%3Cpath d=%27m4 6 4 4 4-4%27/%3E%3C/svg%3E")] bg-[right_0.75rem_center] bg-no-repeat pr-9', invalid && 'border-red-400', className)}>{children}</select>
);
function Btn({ children, variant = 'primary', loading, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand-600 text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700 focus-visible:ring-brand-500/30',
        variant === 'outline' && 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError & { details?: Array<{ path: string; message: string }> };
  const details = Array.isArray(e.details) ? e.details : [];
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
      <p className="font-medium">{e.message ?? 'Something went wrong. Please try again.'}</p>
      {details.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{details.slice(0, 6).map((d, i) => <li key={i}>{d.message}</li>)}</ul>}
    </div>
  );
}
function StepTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-7">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] dark:text-white">{title}</h1>
      <p className="mt-2 text-[15px] text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Code input */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, 6));
  };
  return (
    <div className="flex gap-2 sm:gap-3" onPaste={(e) => { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(5, t.length)]?.focus(); } }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          aria-label={`Digit ${i + 1}`}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(-1); set(i, v); if (v) refs.current[i + 1]?.focus(); }}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !d) refs.current[i - 1]?.focus(); }}
          className="h-14 w-11 rounded-xl border border-slate-200 bg-white text-center font-mono text-2xl font-semibold text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 sm:w-13 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ The wizard */
export function OnboardingWizard() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [step, setStep] = useState<StepKey>('plan');
  const [touched, setTouched] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [slug, setSlug] = useState<SlugCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [app, setApp] = useState<AppRef | null>(null);
  const [view, setView] = useState<AppView | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cooldown, setCooldown] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  /* Restore a draft or an application in progress. */
  useEffect(() => {
    const draft = store.get<Partial<Form>>(DRAFT_KEY);
    if (draft) setForm((f) => ({ ...f, ...draft, admin: { ...f.admin, ...(draft.admin ?? {}), password: '', confirm: '' } }));
    // A plan chosen on the website's pricing page (?plan=key); the server still checks it is available.
    const planParam = new URLSearchParams(window.location.search).get('plan');
    if (planParam && /^[a-z0-9_-]{1,40}$/i.test(planParam)) setForm((f) => ({ ...f, plan: planParam }));
    const saved = store.get<AppRef>(APP_KEY);
    if (saved?.token) {
      setApp(saved);
      api<AppView>('/onboarding/applications/status', { method: 'POST', body: { applicationToken: saved.token }, auth: false })
        .then((r) => { setView(r.data); setStep(r.data.status === 'email_pending' ? 'verify' : 'done'); })
        .catch(() => { store.del(APP_KEY); setApp(null); });
    }
    api<Config>('/onboarding/config', { auth: false }).then((r) => setConfig(r.data)).catch(() => setConfig(null));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const { admin, ...rest } = form;
    store.set(DRAFT_KEY, { ...rest, admin: { ...admin, password: '', confirm: '' } });
  }, [form, hydrated]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  /* Derive the web address from the name until the user edits it. */
  const f = form.facility;
  useEffect(() => {
    if (!form.slugTouched && f.name) setForm((x) => ({ ...x, slug: slugify(f.name) }));
  }, [f.name, form.slugTouched]);
  useEffect(() => {
    if (!form.slug) { setSlug(null); return; }
    setChecking(true);
    const t = setTimeout(() => {
      api<SlugCheck>('/onboarding/slug', { query: { slug: form.slug, name: f.name || undefined }, auth: false })
        .then((r) => setSlug(r.data))
        .catch(() => setSlug(null))
        .finally(() => setChecking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [form.slug, f.name]);

  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setForm((x) => ({ ...x, [k]: v }));
  const updF = (k: keyof Form['facility'], v: string) => setForm((x) => ({ ...x, facility: { ...x.facility, [k]: v } }));
  const updA = (k: keyof Form['admin'], v: string) => setForm((x) => ({ ...x, admin: { ...x.admin, [k]: v } }));
  const updB = (i: number, k: keyof Branch, v: string) => setForm((x) => ({ ...x, branches: x.branches.map((b, j) => (j === i ? { ...b, [k]: k === 'branchCode' ? v.toUpperCase().replace(/[^A-Z0-9-]/g, '') : v } : b)) }));

  /* Per-step validation (mirrors the server). */
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3) e.name = 'Enter the facility name';
    if (!f.facilityType) e.facilityType = 'Choose the facility type';
    if (!f.county) e.county = 'Choose the county';
    if (!phoneOk(f.phone)) e.phone = 'Enter a valid phone number';
    if (f.email && !emailOk(f.email)) e.femail = 'Enter a valid email';
    if (!slug?.available || slug.slug !== form.slug) e.slug = slug?.reason ?? 'Choose an available web address';
    const codes = form.branches.map((b) => b.branchCode);
    form.branches.forEach((b, i) => {
      if (b.branchName.trim().length < 2) e[`b${i}n`] = 'Enter the branch name';
      if (!/^[A-Z0-9-]{2,20}$/.test(b.branchCode)) e[`b${i}c`] = '2–20 letters or digits';
      else if (codes.indexOf(b.branchCode) !== i) e[`b${i}c`] = 'Codes must be unique';
    });
    const a = form.admin;
    if (a.name.trim().length < 3) e.aname = 'Enter your full name';
    if (!emailOk(a.email)) e.aemail = 'Enter a valid email — we will send a code to it';
    if (!phoneOk(a.phone)) e.aphone = 'Enter a valid phone number';
    if (!pwChecks(a.password).every((c) => c.ok)) e.password = 'Choose a stronger password';
    if (a.confirm !== a.password) e.confirm = 'Passwords do not match';
    if (!form.acceptTerms) e.terms = 'Please accept to continue';
    return e;
  }, [f, form, slug]);
  const stepFields: Record<string, string[]> = {
    plan: [],
    facility: ['name', 'facilityType', 'county', 'phone', 'femail'],
    address: ['slug', ...form.branches.flatMap((_, i) => [`b${i}n`, `b${i}c`])],
    admin: ['aname', 'aemail', 'aphone', 'password', 'confirm'],
    modules: [],
    review: ['terms'],
  };
  const err = (k: string) => (touched ? errors[k] : undefined);
  const idx = STEPS.findIndex((s) => s.key === step);
  const go = (k: StepKey) => {
    setError(null);
    setTouched(false);
    setStep(k);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const firstInvalidStep = () => (['facility', 'address', 'admin'] as const).find((s) => stepFields[s].some((k) => errors[k]));

  const submit = async () => {
    setError(null);
    const bad = firstInvalidStep();
    if (bad) { go(bad); setTimeout(() => setTouched(true), 0); return; }
    setBusy(true);
    try {
      const a = form.admin;
      const r = await api<{ applicationToken: string; reference: string; sentTo: string }>('/onboarding/applications', {
        method: 'POST',
        auth: false,
        body: {
          plan: form.plan,
          facility: { ...f, bedCapacity: f.bedCapacity ? Number(f.bedCapacity) : undefined },
          slug: form.slug,
          branches: form.branches.map((b) => ({ ...b, county: b.county || f.county })),
          admin: { name: a.name, jobTitle: a.jobTitle, email: a.email, phone: a.phone, password: a.password },
          interests: form.interests,
          expectedUsers: form.expectedUsers ? Number(form.expectedUsers) : undefined,
          heardFrom: form.heardFrom,
          notes: form.notes,
          acceptTerms: form.acceptTerms,
        },
      });
      const ref = { token: r.data.applicationToken, reference: r.data.reference, sentTo: r.data.sentTo };
      store.set(APP_KEY, ref);
      setApp(ref);
      setCooldown(30);
      go('verify');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const verify = useCallback(async (value: string) => {
    if (!app || value.length !== 6) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<AppView>('/onboarding/applications/verify', { method: 'POST', auth: false, body: { applicationToken: app.token, code: value } });
      setView(r.data);
      store.del(DRAFT_KEY);
      setForm((x) => ({ ...x, admin: { ...x.admin, password: '', confirm: '' } }));
      go('done');
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  }, [app]);
  const resend = async () => {
    if (!app) return;
    setError(null);
    try {
      const r = await api<{ sentTo: string }>('/onboarding/applications/resend', { method: 'POST', auth: false, body: { applicationToken: app.token } });
      setApp({ ...app, sentTo: r.data.sentTo });
      setCooldown(30);
    } catch (e) {
      setError(e);
    }
  };
  const refreshStatus = async () => {
    if (!app) return;
    setBusy(true);
    try {
      setView((await api<AppView>('/onboarding/applications/status', { method: 'POST', auth: false, body: { applicationToken: app.token } })).data);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const startOver = () => {
    store.del(APP_KEY);
    store.del(DRAFT_KEY);
    setApp(null);
    setView(null);
    setForm(EMPTY);
    setCode('');
    go('plan');
  };
  const next = () => {
    const fields = stepFields[step] ?? [];
    if (fields.some((k) => errors[k])) { setTouched(true); return; }
    const order: StepKey[] = ['plan', 'facility', 'address', 'admin', 'modules', 'review'];
    if (step === 'review') { void submit(); return; }
    go(order[order.indexOf(step) + 1]);
  };
  const back = () => {
    const order: StepKey[] = ['plan', 'facility', 'address', 'admin', 'modules', 'review'];
    const i = order.indexOf(step);
    if (i > 0) go(order[i - 1]);
  };
  // Auto-submit once per complete code (never twice for the same digits).
  const lastTried = useRef('');
  useEffect(() => {
    if (step !== 'verify' || code.length !== 6) { if (code.length < 6) lastTried.current = ''; return; }
    if (busy || lastTried.current === code) return;
    lastTried.current = code;
    void verify(code);
  }, [code, step, busy, verify]);

  const plans = config?.plans;
  const selectedPlan = plans?.find((p) => p.key === form.plan);
  const domain = config?.platformDomain ?? 'afeysync.com';
  const locked = step === 'verify' || step === 'done';
  const progress = step === 'done' ? 100 : Math.round(((idx + 1) / STEPS.length) * 100);

  return (
    <div className="min-h-screen bg-[#f6f8fb] lg:grid lg:grid-cols-[minmax(340px,420px)_1fr] dark:bg-[#0b1220]">
      {/* Brand rail */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-b from-[#062f29] via-[#083f36] to-[#0b1220] px-10 py-10 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 -left-20 h-64 w-64 rounded-full bg-emerald-300/10 blur-3xl" />
        <Link href="/login" className="relative flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20"><Activity className="h-5 w-5 text-emerald-300" /></span>
          <span><span className="block text-lg font-semibold tracking-tight">AfeySync</span><span className="block text-xs text-emerald-100/70">Hospital Management Information System</span></span>
        </Link>
        <div className="relative mt-12">
          <h2 className="text-[26px] leading-tight font-semibold tracking-tight">Bring your whole facility onto one secure platform.</h2>
          <p className="mt-3 text-sm leading-relaxed text-emerald-50/70">Registration takes about five minutes. Your facility gets its own private database and web address.</p>
        </div>
        <ol className="relative mt-10 space-y-1">
          {STEPS.map((s, i) => {
            const done = step === 'done' || i < idx;
            const current = s.key === step;
            const Icon = s.icon;
            const clickable = !locked && i < idx;
            return (
              <li key={s.key}>
                <button type="button" disabled={!clickable} onClick={() => clickable && go(s.key)} className={cn('group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', current && 'bg-white/10 ring-1 ring-white/15', clickable && 'hover:bg-white/5')}>
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 transition', done ? 'bg-emerald-400 text-[#063029] ring-emerald-300' : current ? 'bg-white text-[#083f36] ring-white' : 'bg-white/5 text-white/60 ring-white/15')}>
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-sm font-medium', !done && !current && 'text-white/60')}>{s.label}</span>
                    <span className="block text-xs text-white/45">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="relative mt-auto space-y-3 pt-10 text-xs text-emerald-50/70">
          <p className="flex items-center gap-2"><Server className="h-4 w-4 text-emerald-300" /> A separate database for every facility</p>
          <p className="flex items-center gap-2"><Lock className="h-4 w-4 text-emerald-300" /> Encrypted credentials, audit trail, two-step sign-in</p>
          <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /> SHA, DHA HIE and M-Pesa workflows built in</p>
        </div>
      </aside>

      {/* Main panel */}
      <main className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3 sm:px-8">
            <Link href="/login" className="flex items-center gap-2 lg:hidden"><Activity className="h-5 w-5 text-brand-600" /><span className="font-semibold">AfeySync</span></Link>
            <p className="hidden text-sm text-slate-500 lg:block">{step === 'done' ? 'Registration complete' : `Step ${idx + 1} of ${STEPS.length} · ${STEPS[idx]?.label}`}</p>
            <p className="text-sm text-slate-500">Already registered? <Link href="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
          </div>
          <div className="h-1 bg-slate-100 dark:bg-slate-800"><div className="h-1 bg-gradient-to-r from-brand-500 to-emerald-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
        </header>

        <div ref={topRef} className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
          <p className="mb-5 text-xs font-medium text-slate-500 lg:hidden">{step === 'done' ? 'Registration complete' : `Step ${idx + 1} of ${STEPS.length} · ${STEPS[idx]?.label}`}</p>
          <div key={step} className="animate-[fadeUp_.35s_ease-out]">
            {step === 'plan' && (
              <>
                <StepTitle eyebrow="Welcome" title="Let's set up your facility on AfeySync" subtitle="Pick the plan that fits today. You can change plans at any time from inside AfeySync." />
                {!plans && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {(plans ?? []).map((p) => {
                    const k = p.key;
                    const sel = form.plan === k;
                    return (
                      <button type="button" key={k} onClick={() => upd('plan', k)} aria-pressed={sel} className={cn('relative rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900', sel ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-slate-200 dark:border-slate-800')}>
                        {p.highlight && <span className="absolute -top-2.5 right-4 rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">Most popular</span>}
                        <div className="flex items-center justify-between">
                          <p className="text-base font-semibold text-slate-900 dark:text-white">{p.name}</p>
                          <span className={cn('grid h-5 w-5 place-items-center rounded-full border', sel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300')}>{sel && <Check className="h-3 w-3" />}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{p.description}</p>
                        <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{p.prices.monthly > 0 ? <>KES {p.prices.monthly.toLocaleString()}<span className="text-sm font-normal text-slate-500"> / month</span></> : p.trialDays > 0 && p.key === 'trial' ? 'Free' : <span className="text-sm font-medium text-slate-500">Pricing on request</span>}</p>
                        {p.trialDays > 0 && <p className="text-xs font-medium text-brand-600">{p.trialDays}-day free trial</p>}
                        <ul className="mt-4 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">{p.features.map((x) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{x}</li>)}</ul>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 'facility' && (
              <>
                <StepTitle eyebrow="Your facility" title="Tell us about your facility" subtitle="This appears on receipts, reports and referral letters. You can refine it later in settings." />
                <div className="grid gap-5 sm:grid-cols-2">
                  <L label="Facility name" error={err('name')} className="sm:col-span-2"><TI value={f.name} onChange={(e) => updF('name', e.target.value)} placeholder="e.g. Baraka Medical Centre" invalid={!!err('name')} autoFocus /></L>
                  <L label="Registered (legal) name" optional className="sm:col-span-2"><TI value={f.legalName} onChange={(e) => updF('legalName', e.target.value)} placeholder="As on your KMPDC licence" /></L>
                  <L label="Facility type" error={err('facilityType')}><SI value={f.facilityType} onChange={(e) => updF('facilityType', e.target.value)} invalid={!!err('facilityType')}><option value="">Select…</option>{FACILITY_TYPES.map((x) => <option key={x}>{x}</option>)}</SI></L>
                  <L label="KEPH level" optional><SI value={f.facilityLevel} onChange={(e) => updF('facilityLevel', e.target.value)}><option value="">Select…</option>{FACILITY_LEVELS.map((x) => <option key={x}>{x}</option>)}</SI></L>
                  <L label="Ownership"><SI value={f.ownership} onChange={(e) => updF('ownership', e.target.value)}>{OWNERSHIP.map((x) => <option key={x}>{x}</option>)}</SI></L>
                  <L label="Bed capacity" optional><TI type="number" min={0} value={f.bedCapacity} onChange={(e) => updF('bedCapacity', e.target.value)} placeholder="0" /></L>
                  <L label="KMHFL facility code" optional hint="From the Kenya Master Health Facility List"><TI value={f.facilityCode} onChange={(e) => updF('facilityCode', e.target.value)} /></L>
                  <L label="Licence / registration number" optional><TI value={f.registrationNumber} onChange={(e) => updF('registrationNumber', e.target.value)} /></L>
                  <L label="County" error={err('county')}><SI value={f.county} onChange={(e) => updF('county', e.target.value)} invalid={!!err('county')}><option value="">Select…</option>{COUNTIES.map((x) => <option key={x}>{x}</option>)}</SI></L>
                  <L label="Sub-county" optional><TI value={f.subCounty} onChange={(e) => updF('subCounty', e.target.value)} /></L>
                  <L label="Physical address" optional className="sm:col-span-2"><TI value={f.physicalAddress} onChange={(e) => updF('physicalAddress', e.target.value)} placeholder="Building, street, town" /></L>
                  <L label="Facility phone" error={err('phone')}><TI type="tel" value={f.phone} onChange={(e) => updF('phone', e.target.value)} placeholder="0712 345 678" invalid={!!err('phone')} /></L>
                  <L label="Facility email" optional error={err('femail')}><TI type="email" value={f.email} onChange={(e) => updF('email', e.target.value)} placeholder="info@yourfacility.co.ke" invalid={!!err('femail')} /></L>
                </div>
              </>
            )}

            {step === 'address' && (
              <>
                <StepTitle eyebrow="Web address & branches" title="Where your team will sign in" subtitle="Your facility gets its own secure address. You can add your own domain later." />
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">Web address</p>
                  <div className={cn('flex items-stretch overflow-hidden rounded-xl border bg-white shadow-sm focus-within:ring-4 dark:bg-slate-900', err('slug') ? 'border-red-400 focus-within:ring-red-500/15' : 'border-slate-200 focus-within:border-brand-500 focus-within:ring-brand-500/15 dark:border-slate-700')}>
                    <span className="hidden items-center bg-slate-50 px-3 text-sm text-slate-500 sm:flex dark:bg-slate-800">https://</span>
                    <input aria-label="Web address" aria-invalid={!!err('slug') || undefined} aria-describedby="slug-status" value={form.slug} onChange={(e) => setForm((x) => ({ ...x, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''), slugTouched: true }))} className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-[15px] outline-none" placeholder="your-facility" />
                    <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500 dark:bg-slate-800">.{domain}</span>
                  </div>
                </div>
                <div id="slug-status" className="mt-2 min-h-6 text-sm" aria-live="polite">
                  {checking ? <span className="flex items-center gap-1.5 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…</span>
                    : slug?.available && slug.slug === form.slug ? <span className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {slug.address} is available</span>
                    : slug && form.slug ? <span className="flex flex-wrap items-center gap-1.5 text-amber-700"><X className="h-4 w-4" /> {slug.reason}{slug.suggestion && <> Try <button type="button" className="font-semibold text-brand-600 underline" onClick={() => setForm((x) => ({ ...x, slug: slug.suggestion!, slugTouched: true }))}>{slug.suggestion}</button></>}</span> : err('slug') ? <span className="text-red-600">{err('slug')}</span> : null}
                </div>

                <div className="mt-8 flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Branches</p>
                    <p className="text-sm text-slate-500">Start with your main site. Add more branches now or later.</p>
                  </div>
                  {form.branches.length < 10 && <Btn variant="outline" type="button" onClick={() => upd('branches', [...form.branches, { branchName: '', branchCode: '', county: '', physicalAddress: '' }])}><Plus className="h-4 w-4" /> Add branch</Btn>}
                </div>
                <div className="mt-4 space-y-3">
                  {form.branches.map((b, i) => (
                    <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{i === 0 ? 'Main branch' : `Branch ${i + 1}`}</span>
                        {i > 0 && <button type="button" aria-label={`Remove branch ${i + 1}`} className="text-slate-400 hover:text-red-600" onClick={() => upd('branches', form.branches.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                        <L label="Branch name" error={err(`b${i}n`)}><TI value={b.branchName} onChange={(e) => updB(i, 'branchName', e.target.value)} placeholder="e.g. Westlands" invalid={!!err(`b${i}n`)} /></L>
                        <L label="Short code" error={err(`b${i}c`)}><TI value={b.branchCode} onChange={(e) => updB(i, 'branchCode', e.target.value)} placeholder="WST" maxLength={20} invalid={!!err(`b${i}c`)} className="font-mono uppercase" /></L>
                        <L label="County" optional><SI value={b.county} onChange={(e) => updB(i, 'county', e.target.value)}><option value="">Same as facility</option>{COUNTIES.map((x) => <option key={x}>{x}</option>)}</SI></L>
                        <L label="Location" optional><TI value={b.physicalAddress} onChange={(e) => updB(i, 'physicalAddress', e.target.value)} placeholder="Town" /></L>
                      </div>
                    </div>
                  ))}
                </div>
                {selectedPlan && form.branches.length > selectedPlan.maxBranches && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">The {selectedPlan.name} plan includes {selectedPlan.maxBranches} branch{selectedPlan.maxBranches > 1 ? 'es' : ''}. We will set up all {form.branches.length} for your trial and confirm the right plan with you.</p>}
              </>
            )}

            {step === 'admin' && (
              <>
                <StepTitle eyebrow="Administrator" title="Create the administrator account" subtitle="This person manages users, roles, prices and settings. We'll send a verification code to this email." />
                <div className="grid gap-5 sm:grid-cols-2">
                  <L label="Full name" error={err('aname')}><TI value={form.admin.name} onChange={(e) => updA('name', e.target.value)} autoComplete="name" invalid={!!err('aname')} autoFocus /></L>
                  <L label="Job title" optional><TI value={form.admin.jobTitle} onChange={(e) => updA('jobTitle', e.target.value)} placeholder="e.g. Hospital Administrator" /></L>
                  <L label="Work email" error={err('aemail')}><TI type="email" value={form.admin.email} onChange={(e) => updA('email', e.target.value)} autoComplete="email" invalid={!!err('aemail')} /></L>
                  <L label="Mobile number" error={err('aphone')}><TI type="tel" value={form.admin.phone} onChange={(e) => updA('phone', e.target.value)} autoComplete="tel" placeholder="0712 345 678" invalid={!!err('aphone')} /></L>
                  <L label="Password" error={err('password')}><TI type="password" value={form.admin.password} onChange={(e) => updA('password', e.target.value)} autoComplete="new-password" invalid={!!err('password')} /></L>
                  <L label="Confirm password" error={err('confirm')}><TI type="password" value={form.admin.confirm} onChange={(e) => updA('confirm', e.target.value)} autoComplete="new-password" invalid={!!err('confirm')} /></L>
                </div>
                {(() => {
                  const checks = pwChecks(form.admin.password);
                  const score = checks.filter((c) => c.ok).length + (form.admin.password.length >= 14 ? 1 : 0);
                  return (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex gap-1.5">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full transition', i < score ? (score >= 5 ? 'bg-emerald-500' : score >= 4 ? 'bg-brand-500' : 'bg-amber-400') : 'bg-slate-200 dark:bg-slate-700')} />)}</div>
                      <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">{checks.map((c) => <li key={c.label} className={cn('flex items-center gap-2', c.ok ? 'text-emerald-600' : 'text-slate-500')}>{c.ok ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}{c.label}</li>)}</ul>
                    </div>
                  );
                })()}
                <p className="mt-4 flex items-start gap-2 text-sm text-slate-500"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> Your password is sent over an encrypted connection and stored only as a secure hash. You can add a passkey or authenticator app after signing in.</p>
              </>
            )}

            {step === 'modules' && (
              <>
                <StepTitle eyebrow="Modules" title="What would you like to use?" subtitle="Everything is available on every plan. This helps us prepare your setup — you can switch modules on or off at any time." />
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(INTEREST_COPY).map(([k, v]) => {
                    const on = form.interests.includes(k);
                    return (
                      <button type="button" key={k} aria-pressed={on} onClick={() => upd('interests', on ? form.interests.filter((x) => x !== k) : [...form.interests, k])} className={cn('flex items-start gap-3 rounded-2xl border bg-white p-4 text-left transition hover:shadow-sm dark:bg-slate-900', on ? 'border-brand-500 ring-4 ring-brand-500/10' : 'border-slate-200 dark:border-slate-800')}>
                        <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                        <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">{v.label}</span><span className="block text-xs text-slate-500">{v.desc}</span></span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-slate-500">Government and payment integrations (SHA, DHA HIE, M-Pesa, Slade360) are activated after setup with your facility&apos;s own credentials and, where required, after testing and approval by the relevant authority.</p>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <L label="How many staff will use AfeySync?" optional><TI type="number" min={1} value={form.expectedUsers} onChange={(e) => upd('expectedUsers', e.target.value)} placeholder="e.g. 25" /></L>
                  <L label="How did you hear about us?" optional><SI value={form.heardFrom} onChange={(e) => upd('heardFrom', e.target.value)}><option value="">Select…</option>{HEARD_FROM.map((x) => <option key={x}>{x}</option>)}</SI></L>
                  <L label="Anything we should know?" optional className="sm:col-span-2"><textarea value={form.notes} onChange={(e) => upd('notes', e.target.value)} rows={3} maxLength={1000} className={inputCls} placeholder="e.g. migrating from another system, go-live date, special departments" /></L>
                </div>
              </>
            )}

            {step === 'review' && (
              <>
                <StepTitle eyebrow="Review" title="Check your details" subtitle="Make sure everything is correct. You can edit any section before submitting." />
                <div className="space-y-4">
                  {[
                    { k: 'plan' as const, title: 'Plan', rows: [['Plan', selectedPlan?.name ?? form.plan]] },
                    { k: 'facility' as const, title: 'Facility', rows: [['Name', f.name], ['Type', [f.facilityType, f.facilityLevel].filter(Boolean).join(' · ')], ['Ownership', f.ownership], ['Location', [f.subCounty, f.county].filter(Boolean).join(', ')], ['Phone', f.phone], ['KMHFL code', f.facilityCode || '—']] },
                    { k: 'address' as const, title: 'Web address & branches', rows: [['Address', `${form.slug}.${domain}`], ['Branches', form.branches.map((b) => `${b.branchName} (${b.branchCode})`).join(', ')]] },
                    { k: 'admin' as const, title: 'Administrator', rows: [['Name', [form.admin.name, form.admin.jobTitle].filter(Boolean).join(' · ')], ['Email', form.admin.email], ['Mobile', form.admin.phone]] },
                    { k: 'modules' as const, title: 'Modules', rows: [['Selected', form.interests.map((i) => INTEREST_COPY[i]?.label ?? i).join(', ') || 'None yet']] },
                  ].map((sec) => (
                    <section key={sec.k} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">{sec.title}</h3><button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => go(sec.k)}>Edit</button></div>
                      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[150px_1fr]">{sec.rows.map(([a, b]) => <div key={a} className="contents"><dt className="text-slate-500">{a}</dt><dd className="text-slate-900 dark:text-slate-100">{b || '—'}</dd></div>)}</dl>
                    </section>
                  ))}
                </div>
                <label className={cn('mt-6 flex items-start gap-3 rounded-2xl border bg-white p-4 text-sm dark:bg-slate-900', err('terms') ? 'border-red-300' : 'border-slate-200 dark:border-slate-800')}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={form.acceptTerms} onChange={(e) => upd('acceptTerms', e.target.checked)} />
                  <span className="text-slate-600 dark:text-slate-300">I am authorised to register this facility, I agree to the AfeySync terms of service and data processing agreement, and I confirm the facility will handle patient data in line with the Kenya Data Protection Act, 2019.</span>
                </label>
                {err('terms') && <p className="mt-1 text-xs text-red-600">{err('terms')}</p>}
                {config?.approvalMode === 'manual' && <p className="mt-4 flex items-start gap-2 text-sm text-slate-500"><Clock className="mt-0.5 h-4 w-4 shrink-0" /> After you confirm your email, our team reviews the registration — usually within one working day — and emails you when your facility is ready.</p>}
              </>
            )}

            {step === 'verify' && app && (
              <>
                <StepTitle eyebrow="Verify email" title="Check your inbox" subtitle={`We sent a 6-digit code to ${app.sentTo}. Enter it below to confirm your registration.`} />
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-6 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40"><Mail className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">Reference {app.reference}</p><p className="text-xs text-slate-500">The code expires in 15 minutes.</p></div></div>
                  <CodeInput value={code} onChange={setCode} disabled={busy} />
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Btn onClick={() => verify(code)} loading={busy} disabled={code.length !== 6}>Verify and submit</Btn>
                    <Btn variant="ghost" onClick={resend} disabled={cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</Btn>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-500">Wrong email? <button type="button" className="font-medium text-brand-600 hover:underline" onClick={startOver}>Start again</button></p>
              </>
            )}

            {step === 'done' && view && (
              view.status === 'approved' ? (
                <div className="text-center">
                  <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-emerald-400 text-white shadow-xl shadow-brand-600/30"><Check className="h-10 w-10" strokeWidth={2.5} /></div>
                  <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{view.facilityName} is ready</h1>
                  <p className="mx-auto mt-3 max-w-md text-slate-500">Your private workspace has been created at <strong className="text-slate-800 dark:text-slate-200">{view.address}</strong>. Sign in with your email and the password you chose.</p>
                  <a href={view.loginUrl} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700">Go to your sign-in page <ArrowRight className="h-4 w-4" /></a>
                  <div className="mx-auto mt-10 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
                    {[['Add your team', 'Users & Roles'], ['Set your prices', 'Services & Prices'], ['Secure your account', 'Passkey or authenticator']].map(([a, b]) => <div key={a} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm font-semibold text-slate-900 dark:text-white">{a}</p><p className="text-xs text-slate-500">{b}</p></div>)}
                  </div>
                  <button type="button" className="mt-8 text-sm text-slate-500 hover:underline" onClick={startOver}>Register another facility</button>
                </div>
              ) : view.status === 'rejected' ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
                  <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">We couldn&apos;t approve this registration</h1>
                  <p className="mt-2 text-slate-500">Reference {view.reference}</p>
                  {view.rejectionReason && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{view.rejectionReason}</p>}
                  <Btn className="mt-6" onClick={startOver}>Start a new registration</Btn>
                </div>
              ) : (
                <div>
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40"><ClipboardCheck className="h-8 w-8" /></div>
                  <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Registration received</h1>
                  <p className="mt-3 max-w-xl text-slate-500">Thank you. {view.facilityName} is in our review queue. We&apos;ll email <strong className="text-slate-700 dark:text-slate-200">{view.email}</strong> as soon as your facility is ready at <strong className="text-slate-700 dark:text-slate-200">{view.address}</strong>.</p>
                  <ol className="mt-8 space-y-4">
                    {[
                      { t: 'Email confirmed', d: `Reference ${view.reference}`, s: 'done' },
                      { t: 'Review by the AfeySync team', d: 'Usually within one working day', s: 'current' },
                      { t: 'Your facility is set up', d: 'Private database, web address, roles and your admin account', s: 'todo' },
                      { t: 'Sign in and invite your team', d: 'We email you the sign-in link', s: 'todo' },
                    ].map((x) => (
                      <li key={x.t} className="flex gap-4">
                        <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1', x.s === 'done' ? 'bg-emerald-500 text-white ring-emerald-400' : x.s === 'current' ? 'bg-white text-brand-600 ring-brand-300 dark:bg-slate-900' : 'bg-slate-100 text-slate-400 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700')}>{x.s === 'done' ? <Check className="h-4 w-4" /> : x.s === 'current' ? <Clock className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}</span>
                        <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">{x.t}</span><span className="block text-sm text-slate-500">{x.d}</span></span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-8 flex flex-wrap gap-3"><Btn variant="outline" onClick={refreshStatus} loading={busy}>Check status</Btn><Link href="/login" className="inline-flex items-center rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Back to sign in</Link></div>
                </div>
              )
            )}

            <div className="mt-6"><ErrorBox error={error} /></div>

            {!locked && (
              <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
                {step !== 'plan' ? <Btn variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Btn> : <span />}
                <Btn onClick={next} loading={busy}>{step === 'review' ? 'Submit registration' : step === 'plan' ? 'Get started' : 'Continue'} <ArrowRight className="h-4 w-4" /></Btn>
              </div>
            )}
          </div>
        </div>
        <footer className="px-5 pb-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} AfeySync · Secure, multi-tenant HMIS for Kenyan facilities</footer>
      </main>
    </div>
  );
}
