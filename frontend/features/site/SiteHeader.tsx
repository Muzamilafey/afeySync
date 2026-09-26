'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/features/theme/ThemeToggle';

type NavItem = { href: string; label: string };

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn('grid h-8 w-8 place-items-center rounded-md', light ? 'bg-white/10' : 'bg-brand-700')}>
        <Activity className={cn('h-4.5 w-4.5', light ? 'text-emerald-200' : 'text-white')} aria-hidden />
      </span>
      <span className={cn('text-[1.05rem] font-semibold tracking-tight', light ? 'text-white' : 'text-stone-900 dark:text-white')}>AfeySync</span>
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
    <header className={cn('sticky top-0 z-40 border-b bg-white transition-colors dark:bg-stone-950', scrolled || open ? 'border-stone-200 dark:border-stone-800' : 'border-transparent')}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="AfeySync home"><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-2 text-sm font-medium transition', pathname === n.href ? 'text-stone-900 underline decoration-brand-600 decoration-2 underline-offset-[10px] dark:text-white' : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white')}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle className="text-stone-600 dark:text-stone-300" />
          <a href={signIn} className="px-3 py-2 text-sm font-medium text-stone-700 hover:text-stone-950 dark:text-stone-200 dark:hover:text-white">Sign in</a>
          <a href={getStarted} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200">Register your facility</a>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
        <ThemeToggle className="text-stone-700 dark:text-stone-200" />
        <button type="button" className="grid h-10 w-10 place-items-center rounded-lg text-stone-700 hover:bg-stone-100 lg:hidden dark:text-stone-200 dark:hover:bg-stone-800" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        </div>
      </div>
      {open && (
        <div id="site-menu" className="border-t border-stone-200 px-4 pt-2 pb-5 lg:hidden dark:border-stone-800">
          <nav aria-label="Mobile" className="flex flex-col">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-3 text-base font-medium', pathname === n.href ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-white' : 'text-stone-700 dark:text-stone-200')}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={signIn} className="rounded-md border border-stone-300 px-4 py-2.5 text-center text-sm font-semibold text-stone-800 dark:border-stone-700 dark:text-stone-100">Sign in</a>
            <a href={getStarted} className="rounded-md bg-stone-900 px-4 py-2.5 text-center text-sm font-semibold text-white dark:bg-white dark:text-stone-900">Get started</a>
          </div>
        </div>
      )}
    </header>
  );
}
