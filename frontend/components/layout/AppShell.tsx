'use client';

import Link from 'next/link';
import { Letterhead } from '@/features/branding/Letterhead';
import { InstallButton } from '@/features/pwa/InstallButton';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { WhatsNew } from '@/features/announcements/WhatsNew';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, Bell, BookOpen, Building2, ChevronDown, ChevronRight, CircleHelp, CreditCard, Home, KeyRound, LayoutGrid, LogOut,
  Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen, Palette, Phone, Search, Settings, ShieldCheck, UserRound, X,
} from 'lucide-react';
import { useMe } from '@/hooks/useMe';
import { useBranding } from '@/features/branding/branding';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { cn, fullName } from '@/lib/utils';
import { Badge, Loading, statusTone } from '@/components/ui';
import { appForPath, type AppDef } from '@/features/apps/catalog';
import { recordRecentApp, useApps } from '@/features/apps/useApps';
import { CONTACT } from '@/features/site/contact';
import type { Patient } from '@/types/api';

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


/** Closes a popover when the user clicks anywhere outside it. */
function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, close]);
  return ref;
}

/** The public website (afey.co.ke) as seen from a facility address such as famzahra.afey.co.ke. */
const websiteUrl = () => {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname.split('.').slice(1).join('.') || hostname}${port ? `:${port}` : ''}`;
};

function HeaderDropdown({ label, icon, children, width = 'w-64' }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; width?: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside<HTMLDivElement>(open, close);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={label} title={label} aria-expanded={open} className="flex items-center gap-1 rounded-md p-2">
        {icon}
        <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
      </button>
      {open && <div className={cn('surface absolute right-0 z-40 mt-1 rounded-lg p-1 text-[var(--text)] shadow-lg', width)}>{children(close)}</div>}
    </div>
  );
}

function AppSwitcher({ apps }: { apps: AppDef[] }) {
  return (
    <HeaderDropdown label="Apps" icon={<LayoutGrid className="h-5 w-5" />} width="w-[22rem] max-w-[90vw]">
      {(close) => (
        <div className="p-2">
          <div className="grid max-h-[60vh] grid-cols-3 gap-1 overflow-y-auto">
            {apps.map((a) => (
              <Link key={a.key} href={a.items[0].href} onClick={close} className="flex flex-col items-center gap-1.5 rounded-lg p-3 text-center text-xs font-medium hover:bg-[var(--surface-2)]">
                <a.icon className="h-6 w-6 text-brand-600" strokeWidth={1.6} />
                {a.name}
              </Link>
            ))}
          </div>
          <Link href="/apps" onClick={close} className="mt-1 block border-t border-[var(--border)] px-2 pt-2 text-right text-sm font-semibold text-brand-700 dark:text-brand-200">View all apps →</Link>
        </div>
      )}
    </HeaderDropdown>
  );
}

function HelpMenu() {
  return (
    <HeaderDropdown label="Help" icon={<CircleHelp className="h-5 w-5" />}>
      {(close) => (
        <>
          <Link href="/help" onClick={close} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]"><CircleHelp className="h-4 w-4" /> Help centre</Link>
          <a href={`${websiteUrl()}/user-guide`} target="_blank" rel="noreferrer" onClick={close} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]"><BookOpen className="h-4 w-4" /> User guide</a>
          <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" onClick={close} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]"><MessageSquareText className="h-4 w-4" /> WhatsApp support</a>
          <a href={`tel:${CONTACT.phoneTel}`} onClick={close} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]"><Phone className="h-4 w-4" /> Call {CONTACT.phoneDisplay}</a>
        </>
      )}
    </HeaderDropdown>
  );
}

interface SideLink { href: string; label: string; icon: typeof Home; any?: string[] }
const SETTINGS: SideLink[] = [
  { href: '/account/profile', label: 'Profile settings', icon: UserRound },
  { href: '/account/security', label: 'Security & password', icon: KeyRound },
  { href: '/admin/subscription', label: 'Billing & payments', icon: CreditCard, any: ['subscription.view'] },
  { href: '/admin/sms', label: 'SMS wallet', icon: MessageSquareText, any: ['subscription.view', 'admin.settings'] },
  { href: '/admin/branding', label: 'Facility details', icon: Palette, any: ['admin.settings'] },
  { href: '/admin/branches', label: 'Branches', icon: Building2, any: ['admin.branches'] },
];

function SideItem({ href, label, icon: Icon, active, collapsed, onClick }: { href: string; label: string; icon: typeof Home; active: boolean; collapsed: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex items-center gap-3.5 rounded-lg border-2 px-3 py-2.5 text-[15px] transition',
        collapsed && 'justify-center px-0',
        active ? 'border-brand-700 bg-brand-50/60 font-semibold text-brand-800 dark:border-brand-500 dark:bg-brand-900/30 dark:text-brand-100' : 'border-transparent hover:bg-[var(--surface-2)]',
      )}
    >
      {active && !collapsed && <span className="absolute top-2 bottom-2 left-1 w-0.5 rounded bg-brand-700 dark:bg-brand-400" />}
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.7} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SettingsFlyout({ perms, collapsed, onNavigate }: { perms: Set<string>; collapsed: boolean; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = () => setOpen(false);
  const ref = useOutside<HTMLDivElement>(open, close);
  const btn = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  // The sidebar scrolls, so the menu is placed on the page (fixed) beside the button rather than inside it.
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos(window.innerWidth < 768 ? { top: r.bottom + 4, left: r.left } : { top: r.top, left: r.right + 8 });
    setOpen(!open);
  };
  const items = SETTINGS.filter((i) => !i.any || i.any.some((p) => perms.has(p)));
  const active = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return (
    <div ref={ref} className="relative">
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        title={collapsed ? 'Settings' : undefined}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-3.5 rounded-lg border-2 px-3 py-2.5 text-left text-[15px] transition', collapsed && 'justify-center px-0', open || active ? 'border-transparent bg-[var(--surface-2)]' : 'border-transparent hover:bg-[var(--surface-2)]', active && 'font-semibold text-brand-800 dark:text-brand-100')}
      >
        <Settings className="h-5 w-5 shrink-0" strokeWidth={1.7} />
        {!collapsed && <><span className="flex-1">Settings</span><ChevronRight className="h-4 w-4" /></>}
      </button>
      {open && pos && (
        <div className="surface fixed z-50 w-60 rounded-lg p-1.5 shadow-xl" style={{ top: pos.top, left: pos.left }}>
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={() => { close(); onNavigate(); }} className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[15px] hover:bg-[var(--surface-2)]">
              <i.icon className="muted h-4 w-4" /> {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ apps, perms, collapsed, onToggle, onNavigate, onLogout }: { apps: AppDef[]; perms: Set<string>; collapsed: boolean; onToggle?: () => void; onNavigate: () => void; onLogout: () => void }) {
  const pathname = usePathname();
  const current = appForPath(apps, pathname);
  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const app = current?.app;
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <nav className="flex h-full flex-col p-3">
      <div className={cn('flex items-center gap-2 border-b border-[var(--border)] px-2 pt-2 pb-4', collapsed && 'justify-center px-0')}>
        {!collapsed && (app ? <span className="flex min-w-0 flex-1 items-center gap-2 font-bold"><app.icon className="h-5 w-5 shrink-0 text-brand-600" /> <span className="truncate">{app.name}</span></span> : <span className="flex-1 font-bold">Home</span>)}
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'} className="muted rounded p-1 hover:bg-[var(--surface-2)]">
            <Toggle className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-1.5">
        {app ? (
          <>
            <Link href="/apps" onClick={onNavigate} title={collapsed ? 'All apps' : undefined} className={cn('muted mb-1 flex items-center gap-2 px-3 py-1.5 text-sm hover:text-brand-700', collapsed && 'justify-center px-0')}>
              <ArrowLeft className="h-4 w-4" /> {!collapsed && 'All apps'}
            </Link>
            {app.items.map((i) => <SideItem key={i.href} href={i.href} label={i.label} icon={i.icon} active={current?.item?.href === i.href} collapsed={collapsed} onClick={onNavigate} />)}
            <div className="my-3 border-t border-[var(--border)]" />
            <SideItem href="/home" label="Home" icon={Home} active={false} collapsed={collapsed} onClick={onNavigate} />
          </>
        ) : (
          <>
            <SideItem href="/home" label="Home" icon={Home} active={on('/home')} collapsed={collapsed} onClick={onNavigate} />
            <SideItem href="/apps" label="Apps" icon={LayoutGrid} active={on('/apps')} collapsed={collapsed} onClick={onNavigate} />
          </>
        )}
        <SideItem href="/help" label="Help" icon={CircleHelp} active={on('/help')} collapsed={collapsed} onClick={onNavigate} />
        <SettingsFlyout perms={perms} collapsed={collapsed} onNavigate={onNavigate} />
        <button type="button" onClick={onLogout} title={collapsed ? 'Logout' : undefined} className={cn('flex items-center gap-3.5 rounded-lg border-2 border-transparent px-3 py-2.5 text-left text-[15px] hover:bg-[var(--surface-2)]', collapsed && 'justify-center px-0')}>
          <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.7} /> {!collapsed && 'Logout'}
        </button>
      </div>
    </nav>
  );
}

function Breadcrumbs({ apps }: { apps: AppDef[] }) {
  const pathname = usePathname();
  const cur = appForPath(apps, pathname);
  const fixed: Record<string, string> = { '/apps': 'Apps', '/help': 'Help', '/account/profile': 'Profile settings', '/account/security': 'Security & password', '/account': 'My account' };
  const trail: Array<{ label: string; href?: string }> = [{ label: 'Home', href: '/home' }];
  if (cur) {
    trail.push({ label: cur.app.name, href: cur.app.items[0].href });
    if (cur.item && cur.item.href !== cur.app.items[0].href) trail.push({ label: cur.item.label, href: cur.item.href });
    if (!cur.item || pathname !== cur.item.href) trail.push({ label: 'Details' });
  } else if (fixed[pathname]) trail.push({ label: fixed[pathname] });
  return (
    <div className="surface border-x-0 border-t-0 px-5 py-3.5 text-sm md:px-8 print:hidden">
      <ol className="flex flex-wrap items-center gap-2">
        {trail.map((t, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="muted h-3.5 w-3.5" />}
            {t.href && i < trail.length - 1 ? <Link href={t.href} className="muted hover:text-brand-700">{t.label}</Link> : <span className={i === 0 ? 'muted' : 'muted'}>{t.label}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const COLLAPSE_KEY = 'afs.sidebarCollapsed';

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const branding = useBranding();
  const router = useRouter();
  const pathname = usePathname();
  const apps = useApps();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const clear = useSessionStore((s) => s.clear);
  const qc = useQueryClient();
  const closeMenu = () => setMenu(false);
  const menuRef = useOutside<HTMLDivElement>(menu, closeMenu);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  const mustChange = !!me?.user.mustChangePassword;
  useEffect(() => {
    if (mustChange && pathname !== '/account') router.replace('/account?first=1');
  }, [mustChange, pathname, router]);

  // Remember which apps this user opens, for Quick Access on the Home page.
  const userId = me?.user.id;
  useEffect(() => {
    const cur = appForPath(apps, pathname);
    if (cur && userId) recordRecentApp(userId, cur.app.key);
  }, [apps, pathname, userId]);

  if (isLoading || !me) return <div className="flex min-h-screen items-center justify-center"><Loading label="Loading AfeySync…" /></div>;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clear('tenant');
    qc.clear();
    router.replace('/login');
  };

  const logo = branding?.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={branding.logoUrl} alt="" className="h-9 w-9 max-w-none shrink-0 rounded-md bg-white object-contain p-0.5" />
  ) : (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/15"><Activity className="h-5 w-5" /></span>
  );
  const facilityName = branding?.name ?? me.tenant.name;

  // Until a new or reset account chooses its own password, only the password screen is available (the API enforces this too).
  if (mustChange)
    return (
      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 items-center justify-between bg-brand-700 px-4 text-white dark:bg-slate-900">
          <span className="flex items-center gap-2 font-semibold">{logo}{facilityName}</span>
          <button onClick={logout} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-white/15"><LogOut className="h-4 w-4" /> Sign out</button>
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 p-4 md:p-8">{pathname === '/account' ? children : <Loading label="Opening password setup…" />}</main>
      </div>
    );

  const perms = new Set(me.permissions);
  const initials = me.user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 bg-brand-700 px-3 text-white shadow-sm md:gap-3 md:px-5 dark:bg-slate-900 print:hidden">
        <button className="rounded p-1.5 hover:bg-white/15 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <Link href="/home" className="flex shrink-0 items-center gap-2.5 sm:min-w-0 sm:shrink">
          {logo}
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block max-w-[15rem] truncate text-[17px] font-bold tracking-tight">{facilityName}</span>
            <span className="block text-[11px] text-white/75">AfeySync HMIS</span>
          </span>
        </Link>
        <div className="flex flex-1 justify-center px-2">{perms.has('patients.search') && <div className="hidden w-full max-w-md md:block"><GlobalSearch /></div>}</div>
        <div className="flex items-center gap-0.5 [&>button]:text-white [&>button:hover]:bg-white/15 [&>div>button]:text-white [&>div>button:hover]:bg-white/15 [&>button]:border-white/30">
          {perms.has('patients.search') && <Link href="/patients" aria-label="Search patients" className="rounded-md p-2 hover:bg-white/15 md:hidden"><Search className="h-5 w-5" /></Link>}
          <InstallButton />
          <ThemeToggle />
          <WhatsNew />
          <HelpMenu />
          <AppSwitcher apps={apps} />
          <Notifications />
        </div>
        <div ref={menuRef} className="relative">
          <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/15" aria-label="Account menu" aria-expanded={menu}>
            <span className="hidden max-w-[14rem] truncate text-right text-[13px] leading-tight font-semibold tracking-wide uppercase lg:block">
              {me.activeBranch?.name ?? me.tenant.name}
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white text-xs font-bold">{initials}</span>
            <ChevronDown className="hidden h-4 w-4 sm:block" />
          </button>
          {menu && (
            <div className="surface absolute right-0 z-40 mt-1 w-64 rounded-lg p-1 text-[var(--text)] shadow-lg">
              <p className="px-3 py-2 text-xs">
                <span className="block text-sm font-semibold">{me.user.name}</span>
                <span className="block">{me.user.email}</span>
                <span className="muted">{me.user.roles.join(', ')}</span>
              </p>
              {me.branches.length > 1 && <div className="border-t border-[var(--border)] px-3 py-2"><BranchSwitcher /></div>}
              <Link href="/account/profile" className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]" onClick={closeMenu}><UserRound className="h-4 w-4" /> My profile</Link>
              <Link href="/account/security" className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]" onClick={closeMenu}><ShieldCheck className="h-4 w-4" /> Security &amp; password</Link>
              <button onClick={logout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-[var(--surface-2)]"><LogOut className="h-4 w-4" /> Sign out</button>
            </div>
          )}
        </div>
      </header>
      {me.user.kind === 'support' && <div className="bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-black print:hidden">AfeySync support session — time-limited, audited access</div>}
      <Breadcrumbs apps={apps} />
      <div className="flex flex-1">
        <aside className={cn('surface sticky top-16 z-20 hidden h-[calc(100dvh-4rem)] shrink-0 self-start overflow-y-auto overscroll-contain border-y-0 border-l-0 transition-[width] md:block print:!hidden', collapsed ? 'w-20' : 'w-72')}>
          <Sidebar apps={apps} perms={perms} collapsed={collapsed} onToggle={toggleCollapsed} onNavigate={() => undefined} onLogout={logout} />
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden print:hidden" onClick={() => setMobileOpen(false)}>
            <aside className="surface h-full w-72 overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end p-2"><button onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
              <Sidebar apps={apps} perms={perms} collapsed={false} onNavigate={() => setMobileOpen(false)} onLogout={logout} />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-8 print:p-0">
          <Letterhead className="hidden print:block" />
          {children}
        </main>
      </div>
    </div>
  );
}
