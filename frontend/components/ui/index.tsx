'use client';

import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-200 dark:text-slate-900',
  outline: 'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]',
  ghost: 'hover:bg-[var(--surface-2)]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn('field', className)} {...props} />);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn('field', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn('field min-h-24', className)} {...props} />);
Textarea.displayName = 'Textarea';

export function Field({ label, error, children, hint, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="muted mt-1 block text-xs">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn('surface rounded-xl shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

const tones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300',
};
export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

export function StatusDot({ tone = 'gray', label }: { tone?: Tone; label: ReactNode }) {
  const dot = { green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500', gray: 'bg-slate-400', purple: 'bg-violet-500' }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      {label}
    </span>
  );
}

export const statusTone = (s?: string): Tone => {
  if (!s) return 'gray';
  if (/^(active|eligible|connected|approved|healthy|success|processed|paid|completed|ready)$/.test(s)) return 'green';
  if (/^(suspended|not_eligible|failed|rejected|failure|dead|error|provisioning_failed)$/.test(s)) return 'red';
  if (/^(pending|intervention_required|degraded|queued|trialing|unmatched|submitted|provisioning|past_due)$/.test(s)) return 'amber';
  if (/^(draft|unknown|disabled)$/.test(s)) return 'gray';
  return 'blue';
};

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="muted flex items-center gap-2 p-6 text-sm">
      <Spinner /> {label}
    </div>
  );
}

export function Alert({ tone = 'blue', title, children }: { tone?: 'blue' | 'red' | 'amber' | 'green'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'red' ? AlertTriangle : tone === 'amber' ? AlertTriangle : tone === 'green' ? CheckCircle2 : Info;
  const cls = {
    blue: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
    red: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  }[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3 text-sm', cls)} role={tone === 'red' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      {children && <div className="muted text-sm">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: string[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {crumbs && <p className="muted mb-1 text-xs">{crumbs.join(' › ')}</p>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, tone = 'gray', hint, icon }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode; icon?: ReactNode }) {
  const accent = { green: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', blue: 'text-sky-600', gray: '', purple: 'text-violet-600' }[tone];
  return (
    <div className="surface rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="muted text-xs font-medium tracking-wide uppercase">{label}</p>
        {icon}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', accent)}>{value}</p>
      {hint && <p className="muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ key: T; label: string }>; value: T; onChange: (k: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)]" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition', value === t.key ? 'border-brand-600 text-brand-700 dark:text-brand-200' : 'muted border-transparent hover:text-[var(--text)]')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16" onClick={onClose}>
      <div className={cn('surface w-full rounded-xl shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="muted rounded p-1 hover:bg-[var(--surface-2)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            {head.map((h, i) => (
              <th key={i} className="muted px-3 py-2 text-xs font-semibold tracking-wide whitespace-nowrap uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
      </table>
      {empty && <EmptyState title="No records" />}
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;

export function KV({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1.5 sm:block sm:border-0 sm:py-0">
          <dt className="muted text-xs uppercase">{k}</dt>
          <dd className="font-medium break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Friendly headings for common error codes; codes listed in GENTLE are guidance rather than failures. */
const ERROR_TITLES: Record<string, string> = {
  TENANT_NOT_RESOLVED: 'Facility not found at this address',
  NOT_PLATFORM_HOST: 'Use your facility address',
  INVALID_CREDENTIALS: 'Email or password is incorrect',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  HANDOFF_INVALID: 'Sign-in link expired',
  VALIDATION_ERROR: 'Some details need fixing',
  RATE_LIMITED: 'Too many attempts',
  MODULE_NOT_IN_PLAN: 'Not included in your plan',
};
const GENTLE = new Set(['TENANT_NOT_RESOLVED', 'NOT_PLATFORM_HOST', 'HANDOFF_INVALID', 'MODULE_NOT_IN_PLAN']);

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; code?: string };
  const code = e.code && e.code !== 'ERROR' ? e.code : '';
  const title = ERROR_TITLES[code] ?? (code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ') : 'Something went wrong');
  return (
    <Alert tone={GENTLE.has(code) ? 'blue' : 'red'} title={title}>
      {e.message ?? 'Please try again.'}
    </Alert>
  );
}
