'use client';

import Link from 'next/link';
import { InstallButton } from '@/features/pwa/InstallButton';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Boxes, Building2, Cable, FileCode2, HeartPulse, LayoutDashboard, LifeBuoy, ListChecks, LogOut, Menu, ScrollText, Settings2, Users, X, DatabaseBackup, ShieldCheck, Inbox, Layers, Receipt, MessageSquareText } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { Loading } from '@/components/ui';

export interface OwnerMe { user: { id: string; name: string; email: string; role: string }; permissions: string[] }
export const useOwnerMe = () => useQuery({ queryKey: ['owner-me'], queryFn: async () => (await ownerApi<OwnerMe>('/auth/me')).data, retry: false, staleTime: 60_000 });

const NAV = [
  { href: '/owner', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/owner/facilities', label: 'Facilities', icon: Building2, perm: 'owner.tenants' },
  { href: '/owner/registrations', label: 'Registrations', icon: Inbox, perm: 'owner.tenants' },
  { href: '/owner/plans', label: 'Plans & Modules', icon: Layers, perm: 'owner.subscriptions' },
  { href: '/owner/billing', label: 'Billing', icon: Receipt, perm: 'owner.subscriptions' },
  { href: '/owner/sms', label: 'SMS', icon: MessageSquareText, perm: 'owner.subscriptions' },
  { href: '/owner/integrations', label: 'Integrations', icon: Cable, perm: 'owner.integrations' },
  { href: '/owner/api-config', label: 'API Config', icon: FileCode2, perm: 'owner.integrations' },
  { href: '/owner/logs', label: 'Integration Logs', icon: ScrollText, perm: 'owner.logs' },
  { href: '/owner/jobs', label: 'Jobs & Queues', icon: ListChecks, perm: 'owner.logs' },
  { href: '/owner/health', label: 'System Health', icon: HeartPulse },
  { href: '/owner/backups', label: 'Backups', icon: DatabaseBackup, perm: 'owner.platform' },
  { href: '/owner/support', label: 'Support Access', icon: LifeBuoy, perm: 'owner.support' },
  { href: '/owner/audit', label: 'Platform Audit', icon: Boxes, perm: 'owner.logs' },
  { href: '/owner/users', label: 'Platform Users', icon: Users, perm: 'owner.platform' },
  { href: '/owner/security', label: 'Security', icon: ShieldCheck },
];

export function OwnerShell({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useOwnerMe();
  const router = useRouter();
  const pathname = usePathname();
  const clear = useSessionStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (error) router.replace('/owner/login');
  }, [error, router]);
  if (isLoading || !me) return <div className="flex min-h-screen items-center justify-center"><Loading /></div>;
  const perms = new Set(me.permissions);
  const items = NAV.filter((n) => !n.perm || perms.has(n.perm));
  const nav = (
    <nav className="space-y-0.5 p-3">
      {items.map((i) => {
        const active = i.href === '/owner' ? pathname === '/owner' : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium', active ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'hover:bg-[var(--surface-2)]')}>
            <i.icon className="h-4 w-4" /> {i.label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-slate-900 px-4 text-white">
        <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <Activity className="h-5 w-5 text-brand-500" />
        <span className="font-semibold">AfeySync Owner</span>
        <span className="ml-auto flex items-center gap-3 text-sm">
          <InstallButton className="border-white/20 hover:bg-white/10" />
          <Settings2 className="h-4 w-4 opacity-60" />
          <span className="hidden sm:inline">{me.user.name}</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{me.user.role.replace('_', ' ')}</span>
          <button
            onClick={async () => {
              await ownerApi('/auth/logout', { method: 'POST' }).catch(() => undefined);
              clear('owner');
              router.replace('/owner/login');
            }}
            className="rounded p-1 hover:bg-white/10"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </span>
      </header>
      <div className="flex flex-1">
        <aside className="surface sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 self-start overflow-y-auto overscroll-contain border-y-0 border-l-0 md:block">{nav}</aside>
        {open && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setOpen(false)}>
            <aside className="surface h-full w-60 overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end p-2"><button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
              {nav}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
