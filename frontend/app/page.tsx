import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { HomePage } from '@/features/site/HomePage';
import { SiteShell } from '@/features/site/SiteShell';
import { BRAND_KEYWORDS, isWebsiteHost, platformDomain, requestHost, siteUrl } from '@/features/site/site';

const TITLE = 'AfeySync (Afey HMIS) | Hospital Management System for Kenyan Hospitals & Clinics';
const DESCRIPTION = 'AfeySync (Afey HMIS) is a secure cloud hospital management system for Kenyan hospitals, clinics and maternity homes: patient registration, OPD, laboratory, pharmacy, wards, billing, M-Pesa and SHA claims in one place.';

export async function generateMetadata(): Promise<Metadata> {
  if (!(await isWebsiteHost())) return {};
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: `${siteUrl()}/` },
    openGraph: { title: TITLE, description: DESCRIPTION, url: `${siteUrl()}/`, siteName: 'AfeySync', type: 'website', locale: 'en_KE' },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
    keywords: BRAND_KEYWORDS,
    // Search Console / Bing Webmaster ownership (set in frontend/.env.production).
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.BING_SITE_VERIFICATION ? { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } : undefined,
    },
  };
}

/** One deployment serves every address; the hostname decides what "/" is. */
export default async function Root() {
  // afey.co.ke (and www): the public website.
  if (await isWebsiteHost()) return <SiteShell><HomePage /></SiteShell>;
  const host = await requestHost();
  const ownerHosts = (process.env.OWNER_HOSTS ?? 'owner.localhost').split(',').map((s) => s.trim());
  if (ownerHosts.includes(host)) redirect('/owner');
  // The central sign-in address has no dashboard of its own.
  if (host === `accounts.${platformDomain()}` || host === 'accounts.localhost') redirect('/login');
  redirect('/home');
}
