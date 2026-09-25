'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ArrowRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/features/theme/ThemeToggle';

type NavItem = { href: string; label: string };

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={cn('grid h-9 w-9 place-items-center rounded-xl', light ? 'bg-white/10 ring-1 ring-white/20' : 'bg-brand-600 shadow-md shadow-brand-600/30')}>
        <Activity className={cn('h-5 w-5', light ? 'text-emerald-300' : 'text-white')} aria-hidden />
      </span>
      <span className={cn('text-lg font-semibold tracking-tight', light ? 'text-white' : 'text-slate-900 dark:text-white')}>
        Afey<span className={light ? 'text-emerald-300' : 'text-brand-600'}>Sync</span>
      </span>
    </span>
  );
}

export function SiteHeader({ nav, signIn, getStarted }: { nav: readonly NavItem[]; signIn: string; getStarted: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('sticky top-0 z-40 border-b transition-colors', scrolled || open ? 'border-slate-200/80 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/85' : 'border-transparent bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="AfeySync home"><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-2 text-sm font-medium transition', pathname === n.href ? 'text-brand-700 dark:text-emerald-300' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white')}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle className="text-slate-600 dark:text-slate-300" />
          <a href={signIn} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Sign in</a>
          <a href={getStarted} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700">
            Get started <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
        <ThemeToggle className="text-slate-700 dark:text-slate-200" />
        <button type="button" className="grid h-10 w-10 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden dark:text-slate-200 dark:hover:bg-slate-800" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        </div>
      </div>
      {open && (
        <div id="site-menu" className="border-t border-slate-200 px-4 pt-2 pb-5 lg:hidden dark:border-slate-800">
          <nav aria-label="Mobile" className="flex flex-col">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-3 text-base font-medium', pathname === n.href ? 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200')}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={signIn} className="rounded-xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Sign in</a>
            <a href={getStarted} className="rounded-xl bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white">Get started</a>
          </div>
        </div>
      )}
    </header>
  );
}
