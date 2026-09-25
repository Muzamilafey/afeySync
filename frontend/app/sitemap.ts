import type { MetadataRoute } from 'next';
import { siteUrl } from '@/features/site/site';
import { fetchPosts } from '@/features/blog/server';
import { GUIDE_SLUGS } from '@/features/site/guide';

// Built per request so new articles appear straight away.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: [string, number, MetadataRoute.Sitemap[number]['changeFrequency']][] = [
    ['/', 1, 'weekly'],
    ['/features', 0.9, 'monthly'],
    ['/pricing', 0.9, 'monthly'],
    ['/user-guide', 0.8, 'monthly'],
    ['/security', 0.7, 'monthly'],
    ['/about', 0.6, 'yearly'],
    ['/blog', 0.8, 'daily'],
    ['/contact', 0.8, 'yearly'],
    ['/privacy', 0.3, 'yearly'],
  ];
  const fixed = pages.map(([path, priority, changeFrequency]) => ({ url: `${base}${path}`, lastModified: new Date(), changeFrequency, priority }));
  const guides = GUIDE_SLUGS.map((slug) => ({ url: `${base}/user-guide/${slug}`, changeFrequency: 'monthly' as const, priority: 0.7 }));
  // Every published article (up to 1000, newest first).
  const articles: MetadataRoute.Sitemap = [];
  for (let page = 1; page <= 42; page++) {
    const { posts, total, limit } = await fetchPosts({ page, limit: 24 });
    articles.push(...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined, changeFrequency: 'monthly' as const, priority: 0.6 })));
    if (page * limit >= total || !posts.length) break;
  }
  return [...fixed, ...guides, ...articles];
}
