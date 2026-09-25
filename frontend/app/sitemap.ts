import type { MetadataRoute } from 'next';
import { siteUrl } from '@/features/site/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages: [string, number, MetadataRoute.Sitemap[number]['changeFrequency']][] = [
    ['/', 1, 'weekly'],
    ['/features', 0.9, 'monthly'],
    ['/pricing', 0.9, 'monthly'],
    ['/user-guide', 0.8, 'monthly'],
    ['/security', 0.7, 'monthly'],
    ['/about', 0.6, 'yearly'],
    ['/contact', 0.8, 'yearly'],
    ['/privacy', 0.3, 'yearly'],
  ];
  return pages.map(([path, priority, changeFrequency]) => ({ url: `${base}${path}`, lastModified: new Date(), changeFrequency, priority }));
}
