import { headers } from 'next/headers';

/**
 * Web app manifest, per host: facility sites install as "AfeySync" (opening the dashboard) and the
 * owner portal as "AfeySync Owner". Each host is its own installable app with its own scope.
 */
export const dynamic = 'force-dynamic';

interface Branding { name: string; tagline: string | null; primaryColor: string | null; logoUrl: string | null }

/** The facility's branding for this address (name, colour, logo), or null. Never blocks the manifest for long. */
async function facilityBranding(fullHost: string): Promise<Branding | null> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/auth/context`, { headers: { 'X-Forwarded-Host': fullHost, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { data?: { kind?: string; branding?: Branding | null } };
    return body.data?.kind === 'facility' ? body.data.branding ?? null : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const h = await headers();
  const fullHost = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const host = fullHost.split(':')[0].toLowerCase();
  const ownerHosts = (process.env.OWNER_HOSTS ?? 'owner.localhost').split(',').map((s) => s.trim());
  const owner = ownerHosts.includes(host);
  const brand = owner ? null : await facilityBranding(fullHost);
  const icons: Array<Record<string, string>> = [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  // The facility's logo leads so the installed app shows it; AfeySync icons remain as fallbacks.
  if (brand?.logoUrl) icons.unshift({ src: brand.logoUrl, sizes: 'any', purpose: 'any' });
  const manifest = {
    id: owner ? '/owner' : '/',
    name: owner ? 'AfeySync Owner Portal' : brand ? brand.name : 'AfeySync HMIS',
    short_name: owner ? 'AfeySync Owner' : brand ? brand.name.slice(0, 24) : 'AfeySync',
    description: owner ? 'Manage AfeySync facilities, plans and billing' : brand?.tagline ? `${brand.tagline} · powered by AfeySync` : 'Hospital management for your facility: patients, OPD, lab, pharmacy, billing, SHA and more',
    start_url: owner ? '/owner?source=pwa' : '/dashboard?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    background_color: '#f5f7fa',
    theme_color: owner ? '#0f172a' : brand?.primaryColor ?? '#0b8a72',
    categories: ['medical', 'business', 'productivity'],
    lang: 'en-KE',
    icons,
    shortcuts: owner
      ? [
          { name: 'Facilities', url: '/owner/facilities', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Billing', url: '/owner/billing', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ]
      : [
          { name: 'Register patient', url: '/frontdesk', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Patients', url: '/patients', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Billing', url: '/billing', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': brand ? 'public, max-age=300' : 'public, max-age=3600' } });
}
