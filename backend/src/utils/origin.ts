import type { Request } from 'express';
import { env } from '../config/env';

/**
 * The browser-facing origin of this request (scheme, host and port), for links in emails. Uses the
 * Origin header when it matches the resolved host, otherwise the forwarded host with FRONTEND_URL's
 * scheme and port. The raw Host header is not used: behind the frontend proxy it is the API's own address.
 */
export function requestOrigin(req: Request) {
  const host = (req.hostname || '').toLowerCase();
  const origin = req.get('origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.hostname.toLowerCase() === host) return u.origin;
    } catch {
      /* fall through */
    }
  }
  const f = new URL(env.FRONTEND_URL);
  return `${f.protocol}//${host}${f.port ? `:${f.port}` : ''}`;
}
