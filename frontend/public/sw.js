/*
 * AfeySync service worker.
 *
 * Patient data is never cached: API calls (/api/*) and pages always go to the network, so nothing
 * clinical is left on a shared device. Only static build assets (content-hashed, immutable), icons
 * and the offline page are cached. When the network is down, navigation shows the offline page.
 */
// Bumping the version deletes every older cache when this worker activates.
const VERSION = 'afeysync-v2';
const STATIC = `${VERSION}-static`;
const IMMUTABLE = /^\/_next\/static\/(?:chunks|css|media)\/(?:.*\/)?[^/]*[-.][0-9a-f]{8,}[^/]*\.(?:js|css|woff2?|ttf|png|jpg|svg|webp)$/;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  // Take over straight away: pages are always live, so there is nothing to keep an old worker for,
  // and an old worker could keep serving outdated scripts.
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept the API or auth flows: always live, never stored.
  if (url.pathname.startsWith('/api/')) return;

  // Only files whose names change with their content (production build hashes) and icons are cached.
  // Development builds reuse file names, so caching them would keep running old code.
  if (IMMUTABLE.test(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: network only, with an offline page when there is no connection.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('/offline.html')) ?? Response.error()));
  }
});
