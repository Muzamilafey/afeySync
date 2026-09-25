import { headers } from 'next/headers';

/**
 * Web app manifest, per host: facility sites install as "AfeySync" (opening the dashboard) and the
 * owner portal as "AfeySync Owner". Each host is its own installable app with its own scope.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0].toLowerCase();
  const ownerHosts = (process.env.OWNER_HOSTS ?? 'owner.localhost').split(',').map((s) => s.trim());
  const owner = ownerHosts.includes(host);
  const icons = [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  const manifest = {
    id: owner ? '/owner' : '/',
    name: owner ? 'AfeySync Owner Portal' : 'AfeySync HMIS',
    short_name: owner ? 'AfeySync Owner' : 'AfeySync',
    description: owner ? 'Manage AfeySync facilities, plans and billing' : 'Hospital management for your facility: patients, OPD, lab, pharmacy, billing, SHA and more',
    start_url: owner ? '/owner?source=pwa' : '/dashboard?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    background_color: '#f5f7fa',
    theme_color: owner ? '#0f172a' : '#0b8a72',
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
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
