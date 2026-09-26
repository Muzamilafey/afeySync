'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import type { AppDef } from './catalog';

/** A launcher card: opens the app's first page; the ⋮ menu jumps straight to any page in it. */
export function AppCard({ app, onRemove }: { app: AppDef; onRemove?: () => void }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  const Icon = app.icon;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(app.items[0].href)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(app.items[0].href); }}
      className="group relative flex min-h-32 cursor-pointer flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 text-left transition hover:border-brand-600 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-6 w-6 shrink-0 text-slate-700 group-hover:text-brand-700 dark:text-slate-200 dark:group-hover:text-brand-200" strokeWidth={1.6} />
        <h3 className="flex-1 text-lg font-semibold tracking-tight">{app.name}</h3>
        <div ref={ref} className="relative -mt-1 -mr-2" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label={`${app.name} options`} onClick={() => setMenu(!menu)} className="muted rounded p-1 hover:bg-[var(--surface-2)]">
            <MoreVertical className="h-4 w-4" />
          </button>
          {menu && (
            <div className="surface absolute right-0 z-30 mt-1 w-56 rounded-lg p-1 shadow-lg">
              {app.items.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--surface-2)]">
                  <i.icon className="h-4 w-4" /> {i.label}
                </Link>
              ))}
              {onRemove && (
                <button type="button" onClick={() => { onRemove(); setMenu(false); }} className="muted w-full rounded border-t border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]">
                  Remove from Quick Access
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="muted mt-2 pl-9 text-[15px] leading-relaxed">{app.summary}</p>
    </div>
  );
}
