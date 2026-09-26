'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { APP_GROUPS } from '@/features/apps/catalog';
import { AppCard } from '@/features/apps/AppCard';
import { QuickAccess } from '@/features/apps/QuickAccess';
import { useApps } from '@/features/apps/useApps';

/** Every app the user can open, grouped like the departments of a facility. */
export default function AppsPage() {
  const apps = useApps();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const match = (a: (typeof apps)[number]) => !term || `${a.name} ${a.summary} ${a.items.map((i) => i.label).join(' ')}`.toLowerCase().includes(term);
  const shown = apps.filter(match);
  return (
    <div className="mx-auto max-w-6xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:px-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-brand-700 dark:text-brand-200">Apps</h1>
          <p className="muted mt-2">Select an app to start your session.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="muted pointer-events-none absolute top-3 left-3.5 h-4 w-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Apps" aria-label="Search apps" className="field h-11 pl-10" />
        </div>
      </div>
      {!term && <div className="mt-8"><QuickAccess showAllLink={false} /></div>}
      {APP_GROUPS.map((g) => {
        const list = shown.filter((a) => a.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">{g}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((a) => <AppCard key={a.key} app={a} />)}</div>
          </section>
        );
      })}
      {term && !shown.length && <p className="muted mt-10 text-center">No app matches “{q}”.</p>}
    </div>
  );
}
