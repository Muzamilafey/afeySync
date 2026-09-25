'use client';

import Link from 'next/link';
import { InstallButton } from '@/features/pwa/InstallButton';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Baby, Banknote, BedDouble, Bell, Cross, HeartHandshake, Smile, Boxes, Pill, ShoppingCart, FlaskConical, ScanLine, CalendarDays, ListOrdered, Stethoscope, Receipt, Building2, ChevronDown, ClipboardList, FileSearch, HeartPulse, LayoutDashboard, LogOut, Menu, Network, Search, Settings, ShieldCheck, UserPlus, Users, X, Wallet, BarChart3, IdCard, Umbrella, CreditCard, Palette } from 'lucide-react';
import { useMe } from '@/hooks/useMe';
import { useBranding } from '@/features/branding/branding';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { cn, fullName } from '@/lib/utils';
import { Badge, Loading, statusTone } from '@/components/ui';
import type { Patient } from '@/types/api';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  any?: string[];
}

/** Only modules that are implemented appear here; each item is filtered by the user's permissions. */
const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: 'Clinical', items: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/frontdesk', label: 'Front Desk', icon: UserPlus, any: ['patients.create', 'frontdesk.view'] },
    { href: '/appointments', label: 'Appointments', icon: CalendarDays, any: ['appointments.view'] },
    { href: '/patients', label: 'Patients', icon: Users, any: ['patients.search', 'patients.view'] },
    { href: '/queue/triage', label: 'Triage Queue', icon: ListOrdered, any: ['opd.create'] },
    { href: '/queue/consultation', label: 'OPD Consultation', icon: Stethoscope, any: ['consultation.create'] },
    { href: '/laboratory', label: 'Laboratory', icon: FlaskConical, any: ['lab.view'] },
    { href: '/radiology', label: 'Radiology', icon: ScanLine, any: ['radiology.view'] },
    { href: '/pharmacy', label: 'Pharmacy', icon: Pill, any: ['pharmacy.view'] },
    { href: '/inpatient', label: 'Inpatient', icon: BedDouble, any: ['inpatient.view', 'nursing.view'] },
    { href: '/maternity', label: 'Maternity', icon: Baby, any: ['maternity.view'] },
    { href: '/mch', label: 'MCH / FP', icon: HeartHandshake, any: ['mch.view', 'fp.view'] },
    { href: '/dental', label: 'Dental', icon: Smile, any: ['dental.view'] },
    { href: '/mortuary', label: 'Mortuary', icon: Cross, any: ['mortuary.view'] },
  ] },
  { section: 'SHA / DHA', items: [
    { href: '/sha', label: 'SHA', icon: ShieldCheck, any: ['sha.view', 'sha.eligibility'] },
    { href: '/sha/visits', label: 'SHA Visits', icon: Stethoscope, any: ['sha.view', 'sha.authorization'] },
    { href: '/sha/claims', label: 'SHA Claims', icon: ClipboardList, any: ['sha.view'] },
    { href: '/interop', label: 'Interoperability', icon: Network, any: ['dha.view', 'sha.view', 'dha.fhir', 'dha.terminology'] },
  ] },
  { section: 'Insurance', items: [
    { href: '/insurance', label: 'Insurance', icon: Umbrella, any: ['insurance.view'] },
    { href: '/insurance/claims', label: 'Insurance Claims', icon: ClipboardList, any: ['insurance.view'] },
    { href: '/insurance/remittances', label: 'Remittances', icon: Wallet, any: ['insurance.view'] },
    { href: '/insurance/payers', label: 'Payers', icon: Building2, any: ['insurance.view'] },
  ] },
  { section: 'Finance', items: [
    { href: '/billing', label: 'Billing & Cashier', icon: Banknote, any: ['billing.view'] },
    { href: '/billing/services', label: 'Services & Prices', icon: Receipt, any: ['billing.prices'] },
    { href: '/inventory', label: 'Inventory', icon: Boxes, any: ['inventory.view', 'pharmacy.stock', 'pharmacy.view'] },
    { href: '/procurement', label: 'Procurement', icon: ShoppingCart, any: ['procurement.view'] },
    { href: '/finance', label: 'Finance', icon: Wallet, any: ['finance.view'] },
    { href: '/reports', label: 'Reports', icon: BarChart3, any: ['reports.view'] },
  ] },
  { section: 'Administration', items: [
    { href: '/hr', label: 'HR & Roster', icon: IdCard, any: ['hr.view'] },
    { href: '/admin/branches', label: 'Branches', icon: Building2, any: ['admin.branches'] },
    { href: '/admin/users', label: 'Users & Roles', icon: Users, any: ['admin.users', 'admin.roles'] },
    { href: '/admin/integrations', label: 'Integrations', icon: HeartPulse, any: ['admin.integrations'] },
    { href: '/admin/audit', label: 'Audit Trail', icon: FileSearch, any: ['admin.audit'] },
    { href: '/admin/security', label: 'Security', icon: Settings, any: ['admin.support_access', 'admin.settings'] },
    { href: '/admin/branding', label: 'Branding', icon: Palette, any: ['admin.settings'] },
    { href: '/admin/subscription', label: 'Subscription', icon: CreditCard, any: ['subscription.view'] },
  ] },
];

/** Sidebar links that belong to optional (plan) modules. */
const MODULE_OF: Record<string, string> = {
  '/laboratory': 'laboratory', '/radiology': 'radiology', '/pharmacy': 'pharmacy', '/inventory': 'pharmacy', '/procurement': 'procurement',
  '/inpatient': 'inpatient', '/maternity': 'maternity', '/mch': 'maternity', '/dental': 'dental', '/mortuary': 'mortuary',
  '/finance': 'finance', '/hr': 'hr', '/reports': 'reports', '/sha': 'sha', '/sha/visits': 'sha', '/sha/claims': 'sha', '/interop': 'interop',
  '/insurance': 'insurance', '/insurance/claims': 'insurance', '/insurance/remittances': 'insurance', '/insurance/payers': 'insurance',
};

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const { data, isFetching } = useQuery({
    queryKey: ['patient-search', debounced],
    queryFn: async () => (await api<Patient[]>('/patients/search', { query: { q: debounced, limit: 8 } })).data,
    enabled: debounced.length >= 2,
  });
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="muted pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim().length >= 2) {
            router.push(`/patients?q=${encodeURIComponent(q.trim())}`);
            setOpen(false);
          }
        }}
        placeholder="Search patient: name, phone, ID, CR ID, AFS no, SHA…"
        className="field pl-9"
        aria-label="Search patient"
      />
      {open && debounced.length >= 2 && (
        <div className="surface absolute z-40 mt-1 w-full overflow-hidden rounded-lg shadow-lg">
          {isFetching && !data && <Loading label="Searching…" />}
          {data?.length === 0 && <p className="muted p-3 text-sm">No patients match “{debounced}”.</p>}
          {data?.map((p) => (
            <button
              key={p._id}
              className="flex w-full items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--surface-2)]"
              onClick={() => {
                router.push(`/patients/${p._id}`);
                setOpen(false);
                setQ('');
              }}
            >
              <span>
                <span className="font-medium">{fullName(p)}</span>
                <span className="muted block text-xs">
                  {p.patientNumber} · {p.gender} {p.clientRegistryId ? `· ${p.clientRegistryId}` : ''} {p.phone ? `· ${p.phone}` : ''}
                </span>
              </span>
              {p.sha?.status && p.sha.status !== 'unknown' && <Badge tone={statusTone(p.sha.status)}>SHA {p.sha.status.replace('_', ' ')}</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BranchSwitcher() {
  const { data: me } = useMe();
  const setBranch = useSessionStore((s) => s.setBranch);
  const qc = useQueryClient();
  if (!me) return null;
  return (
    <div className="relative flex items-center gap-1">
      <Building2 className="muted h-4 w-4" />
      <select
        aria-label="Active branch"
        className="bg-transparent pr-1 text-sm font-medium outline-none"
        value={me.activeBranch?.id ?? ''}
        onChange={(e) => {
          setBranch(e.target.value);
          qc.invalidateQueries();
        }}
      >
        {me.branches.map((b) => (
          <option key={b._id} value={b._id}>
            {b.branchName}
          </option>
        ))}
      </select>
    </div>
  );
}

function Notifications() {
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<Array<{ _id: string; title: string; body: string; createdAt: string; readAt?: string; link?: string }>>('/notifications'), refetchInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const unread = Number(data?.meta?.unread ?? 0);
  const qc = useQueryClient();
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-md p-2 hover:bg-[var(--surface-2)]" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute top-1 right-1 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="surface absolute right-0 z-40 mt-1 w-80 rounded-lg shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-sm font-semibold">
            Notifications
            <button
              className="text-xs text-brand-600"
              onClick={async () => {
                await api('/notifications/read-all', { method: 'POST' });
                qc.invalidateQueries({ queryKey: ['notifications'] });
              }}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(data?.data ?? []).length === 0 && <p className="muted p-3 text-sm">No notifications.</p>}
            {data?.data.map((n) => (
              <Link key={n._id} href={n.link ?? '#'} onClick={() => setOpen(false)} className={cn('block border-b border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]', !n.readAt && 'bg-brand-50/50 dark:bg-brand-900/20')}>
                <p className="font-medium">{n.title}</p>
                <p className="muted text-xs">{n.body}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const branding = useBranding();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const clear = useSessionStore((s) => s.clear);
  const qc = useQueryClient();

  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  const mustChange = !!me?.user.mustChangePassword;
  useEffect(() => {
    if (mustChange && pathname !== '/account') router.replace('/account?first=1');
  }, [mustChange, pathname, router]);

  if (isLoading || !me) return <div className="flex min-h-screen items-center justify-center"><Loading label="Loading AfeySync…" /></div>;

  // Until a new or reset account chooses its own password, only the password screen is available (the API enforces this too).
  if (mustChange)
    return (
      <div className="flex min-h-screen flex-col">
        <header className="surface flex h-14 items-center justify-between border-x-0 border-t-0 px-4">
          <span className="flex items-center gap-2 font-semibold">
            {branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
            ) : (
              <Activity className="h-5 w-5 text-brand-600" />
            )}
            {branding?.name ?? me.tenant.name}
          </span>
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              clear('tenant');
              qc.clear();
              router.replace('/login');
            }}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-red-600 hover:bg-[var(--surface-2)]"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 p-4 md:p-8">{pathname === '/account' ? children : <Loading label="Opening password setup…" />}</main>
      </div>
    );

  const perms = new Set(me.permissions);
  // Items outside the facility's plan are hidden (the API refuses them too).
  const sub = me?.subscription;
  const inPlan = (href: string) => {
    const mod = MODULE_OF[href];
    return !mod || !sub || sub.unrestricted || sub.modules.includes(mod);
  };
  const nav = NAV.map((s) => ({ ...s, items: s.items.filter((i) => (!i.any || i.any.some((p) => perms.has(p))) && inPlan(i.href)) })).filter((s) => s.items.length);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clear('tenant');
    router.replace('/login');
  };

  const sidebar = (
    <nav className="flex flex-col gap-4 p-3">
      {nav.map((s) => (
        <div key={s.section}>
          <p className="muted px-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">{s.section}</p>
          {s.items.map((i) => {
            const active = pathname === i.href || (!['/dashboard', '/sha', '/billing', '/insurance'].includes(i.href) && pathname.startsWith(i.href)) || (['/sha', '/billing', '/insurance'].includes(i.href) && (pathname === i.href || (i.href === '/billing' && pathname.startsWith('/billing/invoices'))));
            return (
              <Link key={i.href} href={i.href} onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition', active ? 'bg-brand-600 text-white' : 'hover:bg-[var(--surface-2)]')}>
                <i.icon className="h-4 w-4" />
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="surface sticky top-0 z-30 flex h-14 items-center gap-3 border-x-0 border-t-0 px-3 md:px-4">
        <button className="rounded p-1.5 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold whitespace-nowrap">
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
          ) : (
            <Activity className="h-5 w-5 text-brand-600" />
          )}
          <span className="hidden max-w-[16rem] truncate sm:inline">{branding?.name ?? me.tenant.name}</span>
        </Link>
        <div className="hidden md:block">
          <BranchSwitcher />
        </div>
        <div className="flex flex-1 justify-center">{perms.has('patients.search') && <GlobalSearch />}</div>
        <InstallButton />
        <Notifications />
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-2)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{me.user.name.slice(0, 1)}</span>
            <span className="hidden max-w-32 truncate lg:inline">{me.user.name}</span>
            <ChevronDown className="h-4 w-4" />
          </button>
          {menu && (
            <div className="surface absolute right-0 z-40 mt-1 w-56 rounded-lg p-1 shadow-lg">
              <p className="px-3 py-2 text-xs">
                <span className="block font-semibold">{me.user.email}</span>
                <span className="muted">{me.user.roles.join(', ')}</span>
              </p>
              <div className="md:hidden px-3 py-2"><BranchSwitcher /></div>
              <Link href="/account" className="block rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]" onClick={() => setMenu(false)}>
                Change password
              </Link>
              <button onClick={logout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-[var(--surface-2)]">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      {me.user.kind === 'support' && <div className="bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-black">AfeySync support session — time-limited, audited access</div>}
      <div className="flex flex-1">
        <aside className="surface sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 self-start overflow-y-auto overscroll-contain border-y-0 border-l-0 md:block">{sidebar}</aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setMobileOpen(false)}>
            <aside className="surface h-full w-64 overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end p-2">
                <button onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              {sidebar}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
