import Link from 'next/link';
import { Search } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { pageMetadata, siteUrl } from '@/features/site/site';
import { fetchPosts } from '@/features/blog/server';
import { PostCard } from '@/features/blog/PostCard';
import { cn } from '@/lib/utils';

export const metadata = pageMetadata('Blog: News, Guides & Updates', 'Articles from AfeySync on running Kenyan health facilities: SHA claims, billing, M-Pesa, patient flow, product updates and practical guides.', '/blog');

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.slice(0, 80) : undefined);

export default async function BlogPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const q = one(sp.q);
  const category = one(sp.category);
  const tag = one(sp.tag);
  const { posts, total, categories, limit } = await fetchPosts({ page, q, category, tag, limit: 12 });
  const pages = Math.max(1, Math.ceil(total / limit));
  const filtered = !!(q || category || tag);
  const href = (p: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, category, tag, ...p })) if (v !== undefined && v !== '' && !(k === 'page' && Number(v) === 1)) s.set(k, String(v));
    return `/blog${s.size ? `?${s}` : ''}`;
  };
  const [first, ...rest] = posts;
  const listLd = { '@context': 'https://schema.org', '@type': 'Blog', name: 'AfeySync Blog', url: `${siteUrl()}/blog`, blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${siteUrl()}/blog/${p.slug}`, datePublished: p.publishedAt })) };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd).replace(/</g, '\\u003c') }} />
      <PageHero eyebrow="Blog" title="News, guides and ideas for Kenyan health facilities" intro="Practical articles on SHA and insurance claims, billing, patient flow and getting the most out of AfeySync.">
        <form action="/blog" className="mt-8 flex max-w-xl gap-2" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <label className="relative flex-1">
            <span className="sr-only">Search articles</span>
            <Search className="pointer-events-none absolute top-3.5 left-4 h-4 w-4 text-slate-400" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search articles" className="w-full rounded-xl border border-slate-300 bg-white py-3 pr-4 pl-11 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>
          <button className="rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">Search</button>
        </form>
      </PageHero>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        {categories.length > 0 && (
          <nav aria-label="Categories" className="mb-10 flex flex-wrap gap-2">
            <Link href="/blog" className={cn('rounded-full px-4 py-1.5 text-sm font-medium ring-1', !category ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-700 ring-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-900')}>All</Link>
            {categories.map((c) => (
              <Link key={c} href={`/blog?category=${encodeURIComponent(c)}`} className={cn('rounded-full px-4 py-1.5 text-sm font-medium ring-1', category === c ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-700 ring-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-900')}>{c}</Link>
            ))}
          </nav>
        )}
        {filtered && <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{total} article{total === 1 ? '' : 's'}{q ? <> matching “{q}”</> : null}{tag ? <> tagged “{tag}”</> : null}. <Link href="/blog" className="font-semibold text-brand-700 hover:underline dark:text-emerald-300">Clear</Link></p>}
        {posts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 p-16 text-center dark:border-slate-700">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{filtered ? 'No articles found' : 'Articles are coming soon'}</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-400">{filtered ? 'Try another search or category.' : 'Check back soon for news and guides from the AfeySync team.'}</p>
          </div>
        ) : (
          <div className="grid gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
            {first && <PostCard post={first} featured={page === 1 && !filtered} />}
            {rest.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-12 flex items-center justify-center gap-2">
            {page > 1 && <Link href={href({ page: page - 1 })} className="rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-900">Newer</Link>}
            <span className="px-3 text-sm text-slate-500">Page {page} of {pages}</span>
            {page < pages && <Link href={href({ page: page + 1 })} className="rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-900">Older</Link>}
          </nav>
        )}
      </section>
      <CtaBand />
    </>
  );
}
