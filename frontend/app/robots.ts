import type { MetadataRoute } from 'next';
import { isWebsiteHost, siteUrl } from '@/features/site/site';

/** Only the public website is indexed; facility, accounts and owner addresses ask search engines to stay out. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isWebsiteHost())) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/login', '/get-started'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
