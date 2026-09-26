'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useMe } from '@/hooks/useMe';

const partOfDay = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

/** "Good afternoon, FATUMA" with the date and a live clock. */
export function Greeting() {
  const { data: me } = useMe();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const first = (me?.user.name ?? '').trim().split(/\s+/)[0]?.toUpperCase();
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-6 md:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-brand-700 md:text-3xl dark:text-brand-200">{partOfDay(now.getHours())}{first ? `, ${first}` : ''}</h1>
      <p className="muted mt-2">{format(now, 'EEEE, d MMMM yyyy')} <span className="text-brand-600">|</span> {format(now, 'HH:mm')}</p>
      {me?.activeBranch && <p className="muted mt-1 text-sm">{me.tenant.name} · {me.activeBranch.name}</p>}
    </section>
  );
}
