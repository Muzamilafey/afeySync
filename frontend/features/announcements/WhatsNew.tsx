'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Megaphone, Pin, Search, X } from 'lucide-react';
import { api } from '@/services/api';
import { Markdown } from '@/features/site/Markdown';
import { cn } from '@/lib/utils';
import { CATEGORY_META, type Announcement, type AnnouncementCategory } from './shared';

const PAGE = 10;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** The megaphone in the facility header and its "What's new on AfeySync" panel. */
export function WhatsNew() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<AnnouncementCategory | ''>('');
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const count = useQuery({
    queryKey: ['announcements-unread'],
    queryFn: async () => (await api<{ unread: number }>('/announcements/unread-count')).data.unread,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const list = useInfiniteQuery({
    queryKey: ['announcements', category],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await api<Announcement[]>('/announcements', { query: { page: pageParam, limit: PAGE, category: category || undefined } });
      return { items: r.data, page: pageParam, total: Number(r.meta?.total ?? 0) };
    },
    getNextPageParam: (last) => (last.page * PAGE < last.total ? last.page + 1 : undefined),
  });

  // Opening the panel marks everything as seen (the "New" labels stay until it is closed).
  useEffect(() => {
    if (!open) return;
    api('/announcements/seen', { method: 'POST' }).then(() => qc.setQueryData(['announcements-unread'], 0)).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, qc]);
  useEffect(() => {
    if (!open) qc.removeQueries({ queryKey: ['announcements'] });
  }, [open, qc]);

  // Load more as the user scrolls to the end.
  useEffect(() => {
    const el = endRef.current;
    if (!el || !open) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [open, list]);

  const items = useMemo(() => {
    const all = list.data?.pages.flatMap((p) => p.items) ?? [];
    const term = q.trim().toLowerCase();
    return term ? all.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(term)) : all;
  }, [list.data, q]);
  const unread = count.data ?? 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative rounded-md p-2 hover:bg-[var(--surface-2)]" aria-label={`What's new${unread ? ` (${unread} new)` : ''}`} title="What's new on AfeySync">
        <Megaphone className="h-5 w-5" />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label="What's new on AfeySync">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-[var(--surface)] shadow-2xl sm:max-w-lg">
            <header className="flex items-center gap-3 bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-4 text-white">
              <Megaphone className="h-5 w-5" />
              <h2 className="flex-1 text-lg font-semibold">What’s new on AfeySync</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-white/15" aria-label="Close"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-3 border-b border-[var(--border)] px-4 py-3">
              <label className="relative block">
                <span className="sr-only">Search updates</span>
                <Search className="muted pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search updates" className="field pl-9" />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setCategory('')} className={cn('rounded-full px-3 py-1 text-xs font-medium', !category ? 'bg-brand-600 text-white' : 'bg-[var(--surface-2)]')}>All</button>
                {(Object.keys(CATEGORY_META) as AnnouncementCategory[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCategory(c)} className={cn('rounded-full px-3 py-1 text-xs font-medium', category === c ? 'bg-brand-600 text-white' : 'bg-[var(--surface-2)]')}>{CATEGORY_META[c].label}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {list.isLoading && <p className="muted flex items-center gap-2 py-10 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading updates…</p>}
              {!list.isLoading && items.length === 0 && (
                <div className="py-16 text-center">
                  <Megaphone className="mx-auto h-10 w-10 text-brand-600/50" />
                  <p className="mt-3 font-semibold">{q || category ? 'No matching updates' : 'No updates yet'}</p>
                  <p className="muted text-sm">News from the AfeySync team will appear here.</p>
                </div>
              )}
              <ol className="space-y-8">
                {items.map((a) => (
                  <li key={a.id} className="border-b border-[var(--border)] pb-8 last:border-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={cn('rounded-full px-2.5 py-0.5 font-semibold', CATEGORY_META[a.category].className)}>{CATEGORY_META[a.category].label}</span>
                      {a.pinned && <span className="flex items-center gap-1 font-medium text-amber-600"><Pin className="h-3 w-3" /> Pinned</span>}
                      {a.unread && <span className="rounded-full bg-red-600 px-2 py-0.5 font-bold text-white">New</span>}
                      <span className="muted">{fmt(a.publishedAt)}</span>
                    </div>
                    <h3 className="mt-2 text-lg font-bold">{a.title}</h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.coverImageUrl && <img src={a.coverImageUrl} alt="" loading="lazy" className="mt-3 w-full rounded-xl border border-[var(--border)]" />}
                    {a.body.trim() && <Markdown source={a.body} className="prose-article prose-compact mt-3" />}
                    <p className="muted mt-3 text-xs">Posted by {a.authorName}</p>
                  </li>
                ))}
              </ol>
              <div ref={endRef} className="h-8" />
              {list.isFetchingNextPage && <p className="muted flex items-center justify-center gap-2 pb-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading more…</p>}
              {!list.hasNextPage && items.length > 0 && <p className="muted pb-6 text-center text-xs">You’re all caught up.</p>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
