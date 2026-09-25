import { headers } from 'next/headers';

/** Public contact details shown across the website. */
export const CONTACT = {
  phoneDisplay: '0722 651 888',
  phoneTel: '+254722651888',
  whatsapp: 'https://wa.me/254722651888',
  email: 'info@afey.co.ke',
  location: 'Kenya',
} as const;

export const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/user-guide', label: 'User guide' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

/** The platform's own domain (afey.co.ke in production, localhost in development). */
export const platformDomain = () => (process.env.PLATFORM_DOMAIN ?? 'localhost').toLowerCase();

/** The public website address, used for canonical links, the sitemap and social previews. */
export const siteUrl = () => {
  const d = platformDomain();
  return d === 'localhost' ? 'http://localhost:3000' : `https://${d}`;
};

/** The hostname of the current request (without port). */
export async function requestHost() {
  const h = await headers();
  return (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim().split(':')[0].toLowerCase();
}

/** True on afey.co.ke and www.afey.co.ke, the only addresses that serve the website. */
export async function isWebsiteHost() {
  const host = await requestHost();
  const apex = platformDomain();
  return host === apex || host === `www.${apex}`;
}

/** Links into the central accounts address (sign-in and registration), keeping the scheme and port of this request. */
export async function accountsLinks() {
  const h = await headers();
  const hostHeader = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
  const port = hostHeader.includes(':') ? `:${hostHeader.split(':').pop()}` : '';
  const apex = platformDomain();
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() || (apex === 'localhost' ? 'http' : 'https');
  const base = `${proto}://accounts.${apex}${port}`;
  return { signIn: `${base}/login`, getStarted: `${base}/get-started` };
}

/** Page metadata for a website page: title, description, canonical address and social preview. */
export function pageMetadata(title: string, description: string, path: string) {
  const url = `${siteUrl()}${path}`;
  const full = `${title} | AfeySync`;
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: url },
    openGraph: { title: full, description, url, siteName: 'AfeySync', type: 'website' as const, locale: 'en_KE' },
    twitter: { card: 'summary_large_image' as const, title: full, description },
  };
}
