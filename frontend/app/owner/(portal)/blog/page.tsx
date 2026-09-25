'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Plus, Search } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Badge, EmptyState, ErrorText, Input, Loading, PageHeader, Tabs } from '@/components/ui';
import { websiteUrl, type OwnerPostRow } from '@/features/blog/shared';

type Filter = 'all' | 'published' | 'draft';

export default function OwnerBlogPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const posts = useQuery({
    queryKey: ['owner-blog', filter, q],
    queryFn: async () => (await ownerApi<OwnerPostRow[]>('/blog/posts', { query: { status: filter === 'all' ? undefined : filter, q: q || undefined, limit: 100 } })).data,
  });

  return (
    <div>
      <PageHeader
        title="Website articles"
        subtitle={<>Write articles with pictures for the blog on <a className="text-brand-600 hover:underline" href={websiteUrl('/blog')} target="_blank" rel="noreferrer">{websiteUrl('/blog').replace(/^https?:\/\//, '')}</a>. Drafts stay private until you publish them.</>}
        actions={<Link href="/owner/blog/new" className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plus className="h-4 w-4" /> New article</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs<Filter> tabs={[{ key: 'all', label: 'All' }, { key: 'published', label: 'Published' }, { key: 'draft', label: 'Drafts' }]} value={filter} onChange={setFilter} />
        <div className="relative w-full max-w-xs">
          <Search className="muted pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
          <Input className="pl-9" placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {posts.isLoading ? <Loading /> : posts.error ? <ErrorText error={posts.error} /> : !posts.data?.length ? (
        <EmptyState title="No articles yet" icon={<FileText className="h-8 w-8" />}>
          Share news, guides for facilities and product updates. <Link className="text-brand-600 hover:underline" href="/owner/blog/new">Write the first article</Link>.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {posts.data.map((p) => (
            <div key={p.id} className="surface flex flex-col gap-4 rounded-xl p-3 sm:flex-row sm:items-center">
              <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg bg-[var(--surface-2)] sm:w-40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.coverImageUrl ? <img src={p.coverImageUrl} alt="" className="h-full w-full object-cover" /> : <div className="muted grid h-full place-items-center"><FileText className="h-6 w-6" /></div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.status === 'published' ? 'green' : 'gray'}>{p.status === 'published' ? 'Published' : 'Draft'}</Badge>
                  {p.category && <Badge tone="blue">{p.category}</Badge>}
                </div>
                <Link href={`/owner/blog/${p.id}`} className="mt-1 block truncate font-semibold hover:text-brand-600">{p.title}</Link>
                <p className="muted mt-0.5 line-clamp-1 text-sm">{p.excerpt || 'No summary'}</p>
                <p className="muted mt-1 text-xs">
                  {p.status === 'published' && p.publishedAt ? `Published ${new Date(p.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })} · ` : ''}
                  Edited {new Date(p.updatedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}{p.updatedByName ? ` by ${p.updatedByName}` : ''} · {p.readingMinutes} min read
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/owner/blog/${p.id}`} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">Edit</Link>
                {p.status === 'published' && <a href={websiteUrl(`/blog/${p.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">View <ExternalLink className="h-3.5 w-3.5" /></a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
