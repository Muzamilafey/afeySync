'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

import { THEME_KEY } from './theme';

type Theme = 'light' | 'dark';

const current = (): Theme => {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Light / dark switch. The choice is remembered on this device; until then the device setting is used. */
export function ThemeToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(current());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(current());
    mq.addEventListener('change', onChange);
    // Keep every open tab in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark') document.documentElement.setAttribute('data-theme', e.newValue);
      else document.documentElement.removeAttribute('data-theme');
      setTheme(current());
    };
    window.addEventListener('storage', onStorage);
    return () => { mq.removeEventListener('change', onChange); window.removeEventListener('storage', onStorage); };
  }, []);

  const toggle = () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still switches for this page */ }
    setTheme(next);
  };

  const dark = theme === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={cn('inline-flex items-center gap-2 rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10', className)}>
      {/* Both icons render on the server; the right one shows once the theme is known. */}
      {theme === null ? <Sun className="h-5 w-5 opacity-0" aria-hidden /> : dark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
      {withLabel && <span className="text-sm font-medium">{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
