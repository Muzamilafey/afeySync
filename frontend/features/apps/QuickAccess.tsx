'use client';

import Link from 'next/link';
import { AppCard } from './AppCard';
import { useRecentApps } from './useApps';

/** Recently viewed apps (or, for a new user, the first apps they have). */
export function QuickAccess({ showAllLink = true }: { showAllLink?: boolean }) {
  const { apps, isDefault, remove } = useRecentApps(6);
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">Quick Access</h2>
      <p className="muted mt-1">{isDefault ? 'Your apps. The ones you open most will appear here.' : 'Recently viewed apps'}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {apps.map((a) => <AppCard key={a.key} app={a} onRemove={isDefault ? undefined : () => remove(a.key)} />)}
      </div>
      {showAllLink && <div className="mt-6 text-right"><Link href="/apps" className="font-semibold text-brand-700 hover:underline dark:text-brand-200">View all apps →</Link></div>}
    </section>
  );
}
