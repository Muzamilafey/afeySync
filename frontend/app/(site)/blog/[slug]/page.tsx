import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock } from 'lucide-react';
import { CtaBand } from '@/features/site/SiteShell';
import { Markdown, outline } from '@/features/site/Markdown';
import { siteUrl } from '@/features/site/site';
import { fetchPost } from '@/features/blog/server';
import { formatDate } from '@/features/blog/shared';
import { PostCard } from '@/features/blog/PostCard';
import { ShareButtons } from '@/features/blog/ShareButtons';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await fetchPost((await params).slug);
  if (!post) return { title: { absolute: 'Article not found | AfeySync' } };
  const url = `${siteUrl()}/blog/${post.slug}`;
  const title = post.seoTitle || `${post.title} | AfeySync Blog`;
  const description = post.seoDescription || post.excerpt || undefined;
  const images = post.coverImageUrl ? [{ url: `${siteUrl()}${post.coverImageUrl}`, alt: post.coverAlt || post.title }] : undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title, description, url, siteName: 'AfeySync', locale: 'en_KE', publishedTime: post.publishedAt ?? undefined, modifiedTime: post.updatedAt ?? undefined, authors: [post.authorName], tags: post.tags, ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(images ? { images: images.map((i) => i.url) } : {}) },
  };
}

export default async function ArticlePage({ params }: { params: Params }) {
  const post = await fetchPost((await params).slug);
  if (!post) notFound();
  const url = `${siteUrl()}/blog/${post.slug}`;
  const toc = outline(post.content).filter((h) => h.level <= 2);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || undefined,
    image: post.coverImageUrl ? [`${siteUrl()}${post.coverImageUrl}`] : undefined,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: { '@type': 'Person', name: post.authorName },
    publisher: { '@type': 'Organization', name: 'AfeySync', logo: { '@type': 'ImageObject', url: `${siteUrl()}/icons/icon-512.png` } },
    mainEntityOfPage: url,
    keywords: post.tags.join(', ') || undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <article>
        <header className="border-b border-slate-100 bg-gradient-to-b from-brand-50/70 to-white dark:border-slate-900 dark:from-slate-900 dark:to-slate-950">
          <div className="mx-auto max-w-3xl px-4 pt-10 pb-10 sm:px-6 sm:pt-14">
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300"><ArrowLeft className="h-4 w-4" aria-hidden /> All articles</Link>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
              {post.category && <Link href={`/blog?category=${encodeURIComponent(post.category)}`} className="rounded-full bg-brand-100 px-3 py-1 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300">{post.category}</Link>}
              <time dateTime={post.publishedAt ?? undefined} className="text-slate-500">{formatDate(post.publishedAt)}</time>
              <span className="flex items-center gap-1 text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden /> {post.readingMinutes} min read</span>
            </div>
            <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">{post.title}</h1>
            {post.excerpt && <p className="mt-5 text-lg leading-relaxed text-slate-600 sm:text-xl dark:text-slate-400">{post.excerpt}</p>}
            <p className="mt-6 text-sm text-slate-500">By <span className="font-semibold text-slate-700 dark:text-slate-300">{post.authorName}</span></p>
          </div>
        </header>
        {post.coverImageUrl && (
          <div className="mx-auto -mb-2 max-w-5xl px-4 pt-10 sm:px-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.coverImageUrl} alt={post.coverAlt || post.title} className="aspect-[16/8] w-full rounded-3xl object-cover shadow-xl shadow-slate-900/10" />
          </div>
        )}
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_minmax(0,720px)_1fr]">
          <div className="hidden lg:block" />
          <div>
            <Markdown source={post.content} />
            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2">
                {post.tags.map((t) => <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">#{t}</Link>)}
              </div>
            )}
            <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800"><ShareButtons url={url} title={post.title} /></div>
          </div>
          {toc.length >= 3 && (
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">In this article</p>
                <nav className="mt-3 space-y-1.5 border-l border-slate-200 dark:border-slate-800">
                  {toc.map((h) => <a key={h.id} href={`#${h.id}`} className="-ml-px block border-l-2 border-transparent pl-3 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700 dark:text-slate-400 dark:hover:text-emerald-300">{h.text}</a>)}
                </nav>
              </div>
            </aside>
          )}
        </div>
      </article>
      {post.related && post.related.length > 0 && (
        <section className="bg-slate-50 py-16 dark:bg-slate-900/40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Keep reading</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">{post.related.map((p) => <PostCard key={p.id} post={p} />)}</div>
          </div>
        </section>
      )}
      <CtaBand />
    </>
  );
}
