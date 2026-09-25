'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Pin, Plus } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Badge, EmptyState, ErrorText, Loading, PageHeader, Tabs } from '@/components/ui';
import { CATEGORY_META, type Announcement } from '@/features/announcements/shared';
import { cn } from '@/lib/utils';

interface Row extends Announcement { status: 'draft' | 'published'; audience: 'all' | 'facilities'; facilities: number; updatedAt: string; updatedByName: string | null }
type Filter = 'all' | 'published' | 'draft';

export default function OwnerAnnouncementsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useQuery({ queryKey: ['owner-announcements', filter], queryFn: async () => (await ownerApi<Row[]>('/announcements', { query: { status: filter === 'all' ? undefined : filter, limit: 100 } })).data });
  return (
    <div>
      <PageHeader
        title="What’s new (facility announcements)"
        subtitle="Posts appear in every facility’s “What’s new” panel (the megaphone at the top of AfeySync) with a red count until staff read them."
        actions={<Link href="/owner/announcements/new" className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plus className="h-4 w-4" /> New announcement</Link>}
      />
      <div className="mb-4"><Tabs<Filter> tabs={[{ key: 'all', label: 'All' }, { key: 'published', label: 'Published' }, { key: 'draft', label: 'Drafts' }]} value={filter} onChange={setFilter} /></div>
      {rows.isLoading ? <Loading /> : rows.error ? <ErrorText error={rows.error} /> : !rows.data?.length ? (
        <EmptyState title="No announcements yet" icon={<Megaphone className="h-8 w-8" />}>Tell facilities about new features, maintenance windows and important notices. <Link className="text-brand-600 hover:underline" href="/owner/announcements/new">Post the first one</Link>.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {rows.data.map((a) => (
            <Link key={a.id} href={`/owner/announcements/${a.id}`} className="surface block rounded-xl p-4 hover:border-brand-400">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={a.status === 'published' ? 'green' : 'gray'}>{a.status === 'published' ? 'Published' : 'Draft'}</Badge>
                <span className={cn('rounded-full px-2 py-0.5 font-semibold', CATEGORY_META[a.category].className)}>{CATEGORY_META[a.category].label}</span>
                {a.pinned && <span className="flex items-center gap-1 text-amber-600"><Pin className="h-3 w-3" /> Pinned</span>}
                <span className="muted">{a.audience === 'all' ? 'All facilities' : `${a.facilities} facilit${a.facilities === 1 ? 'y' : 'ies'}`}</span>
              </div>
              <p className="mt-1.5 font-semibold">{a.title}</p>
              <p className="muted mt-1 text-xs">{a.status === 'published' && a.publishedAt ? `Published ${new Date(a.publishedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} · ` : ''}Edited {new Date(a.updatedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}{a.updatedByName ? ` by ${a.updatedByName}` : ''}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
