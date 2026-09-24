import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { forbidden } from '../../utils/errors';

export const TENANT_RT_COOKIE = 'afs_rt';
export const OWNER_RT_COOKIE = 'afs_ort';

export function setRefreshCookie(res: Response, name: string, token: string, path: string, expires: Date) {
  res.cookie(name, token, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path, expires });
}

export function clearRefreshCookie(res: Response, name: string, path: string) {
  res.clearCookie(name, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path });
}

/**
 * CSRF defence for cookie-authenticated endpoints (refresh/logout): browsers cannot send this custom
 * header cross-origin without a CORS preflight, which our CORS policy rejects for unknown origins.
 */
export function assertCsrfHeader(req: Request) {
  if (req.get('x-requested-with') !== 'AfeySync') throw forbidden('Missing CSRF header', 'CSRF_REJECTED');
}
