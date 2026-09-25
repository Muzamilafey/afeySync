import type { NextConfig } from 'next';

/**
 * All API traffic goes to the same origin (/api/*) and is proxied to the AfeySync API, so the
 * browser never talks to government or payment APIs directly and the API sees the original host
 * (X-Forwarded-Host) for tenant resolution. In production nginx proxies /api directly.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  poweredByHeader: false,
  // Hide the Next.js developer-tools badge (the round "N") in development; it never appears in production.
  devIndicators: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      // The service worker must always be revalidated so updates reach users promptly.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }, { key: 'Content-Type', value: 'application/javascript; charset=utf-8' }] },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
