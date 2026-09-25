import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { h } from '../../../utils/asyncHandler';
import { parse } from '../../../utils/validate';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../../../utils/errors';
import { randomToken, sha256 } from '../../../utils/crypto';
import { meta } from '../../../models/meta';
import { logger } from '../../../utils/logger';
import { verifyPassword } from '../password';
import { completeAuthorization, googleEnabled, startAuthorization } from './googleOidc';
import type { EncryptedValue } from '../../integrations/secretService';

const COMPLETE_PATH = { tenant: '/google-complete', platform: '/owner/google-complete' } as const;

/**
 * Public OAuth redirect target (one registered URI for every facility). It never creates a session itself:
 * it verifies Google's response, then sends the browser back to the originating facility/owner host with a
 * single-use completion code that is redeemed there (so the session cookie is set on the right host).
 */
export const googleCallbackRouter = Router();
googleCallbackRouter.get('/oauth/google/callback', h(async (req, res) => {
  const state = String(req.query.state ?? '');
  const st = state ? await meta().OAuthState.findOne({ stateHash: sha256(`oauth:${state}`) }) : null;
  if (!st || st.completedAt || st.expiresAt < new Date()) {
    res.status(400).type('text/plain').send('This sign-in link has expired. Return to AfeySync and try again.');
    return;
  }
  const back = (params: Record<string, string>) => {
    const u = new URL(COMPLETE_PATH[st.portal as 'tenant' | 'platform'], st.returnOrigin);
    u.search = new URLSearchParams(params).toString();
    res.redirect(303, u.toString());
  };
  if (req.query.error || !req.query.code) {
    st.completedAt = new Date();
    st.error = String(req.query.error ?? 'missing_code').slice(0, 60);
    await st.save();
    return back({ error: st.error });
  }
  try {
    const identity = await completeAuthorization(String(req.query.code), { nonce: st.nonce, codeVerifier: st.codeVerifier as unknown as EncryptedValue });
    const code = randomToken(32);
    st.set('result', identity);
    st.completionHash = sha256(`gc:${code}`);
    st.completedAt = new Date();
    st.expiresAt = new Date(Date.now() + 2 * 60_000);
    await st.save();
    back({ code });
  } catch (err) {
    const codeName = err instanceof AppError ? err.code : 'GOOGLE_ERROR';
    logger.warn({ err: (err as Error).message, code: codeName }, 'Google sign-in failed');
    st.completedAt = new Date();
    st.error = codeName;
    await st.save();
    back({ error: codeName });
  }
}));

/** Redeems a completion code once, on the host that started the flow. */
async function redeem(req: Request, code: string, portal: 'tenant' | 'platform') {
  const st = await meta().OAuthState.findOne({ completionHash: sha256(`gc:${code}`) });
  if (!st || st.portal !== portal || st.consumedAt || st.expiresAt < new Date() || !st.result?.sub) throw unauthorized('This Google sign-in has expired. Try again.', 'GOOGLE_STATE_INVALID');
  if (portal === 'tenant' && String(st.tenantId) !== req.hostTenantId) throw unauthorized('This Google sign-in has expired. Try again.', 'GOOGLE_STATE_INVALID');
  if (portal === 'platform' && !req.isOwnerHost) throw unauthorized('This Google sign-in has expired. Try again.', 'GOOGLE_STATE_INVALID');
  st.consumedAt = new Date();
  await st.save();
  return st;
}

type Linkable = { _id: unknown; email: string; status?: string | null; passwordHash?: string; lockedUntil?: Date | null; google?: { sub?: string | null; email?: string | null } | null; set(p: string, v: unknown): unknown; save(): Promise<unknown> };

export interface GoogleAdapter {
  portal: 'tenant' | 'platform';
  authenticate: RequestHandler;
  /** Whether Google sign-in is allowed here (platform config + facility setting). */
  allowed(req: Request): Promise<boolean>;
  tenantId(req: Request): string | null;
  userId(req: Request): string;
  findBySub(req: Request, sub: string): Promise<Linkable | null>;
  findById(req: Request, id: string): Promise<Linkable | null>;
  /** Continues exactly like a password login (second factor, forced enrollment or session). */
  afterPrimary(req: Request, res: Response, user: Linkable): Promise<unknown>;
  audit(req: Request, action: string, userId: string, extra?: Record<string, unknown>, failed?: boolean): Promise<void>;
  notify(req: Request, user: Linkable, subject: string, text: string): Promise<void>;
}

function assertOrigin(req: Request, origin: string) {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw badRequest('Invalid origin');
  }
  // The browser must return to the very host it started from (no open redirect).
  if (u.hostname.toLowerCase() !== (req.hostname || '').toLowerCase() || !['http:', 'https:'].includes(u.protocol)) throw forbidden('Origin does not match this site', 'ORIGIN_MISMATCH');
  return u.origin;
}

export function buildGoogleRouter(a: GoogleAdapter) {
  const r = Router();
  const startBody = z.object({ returnOrigin: z.string().url().max(300), next: z.string().max(300).regex(/^\/(?!\/)/).optional() });

  r.get('/google/status', h(async (req, res) => {
    res.json({ success: true, data: { enabled: await a.allowed(req) } });
  }));

  r.post('/google/start', h(async (req, res) => {
    const body = parse(startBody, req.body);
    if (a.portal === 'tenant' && !req.hostTenantId) throw badRequest('Use your facility address to sign in', undefined, 'TENANT_NOT_RESOLVED');
    if (a.portal === 'platform' && !req.isOwnerHost) throw forbidden('Use the owner portal address', 'WRONG_PORTAL');
    if (!(await a.allowed(req))) throw new AppError(403, 'GOOGLE_DISABLED', 'Sign in with Google is not enabled here');
    const url = await startAuthorization({ portal: a.portal, mode: 'login', tenantId: a.portal === 'tenant' ? req.hostTenantId : null, returnOrigin: assertOrigin(req, body.returnOrigin), next: body.next });
    res.json({ success: true, data: { url } });
  }));

  r.post('/google/link', a.authenticate, h(async (req, res) => {
    const body = parse(startBody, req.body);
    if (!(await a.allowed(req))) throw new AppError(403, 'GOOGLE_DISABLED', 'Sign in with Google is not enabled here');
    const url = await startAuthorization({ portal: a.portal, mode: 'link', tenantId: a.tenantId(req), userId: a.userId(req), returnOrigin: assertOrigin(req, body.returnOrigin), next: body.next });
    res.json({ success: true, data: { url } });
  }));

  r.post('/google/complete', h(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(20).max(200) }), req.body);
    const st = await redeem(req, code, a.portal);
    const g = st.result!;
    if (st.mode === 'link') {
      const user = await a.findById(req, String(st.userId));
      if (!user) throw unauthorized();
      const other = await a.findBySub(req, g.sub!);
      if (other && String(other._id) !== String(user._id)) throw conflict('This Google account is already linked to another user', undefined, 'GOOGLE_ALREADY_LINKED');
      user.set('google', { sub: g.sub, email: g.email, linkedAt: new Date() });
      await user.save();
      await a.audit(req, 'auth.google_linked', String(user._id), { googleEmail: g.email });
      await a.notify(req, user, 'Google account linked', `The Google account ${g.email} can now be used to sign in to your AfeySync account. If this was not you, unlink it and contact your administrator.`);
      return res.json({ success: true, data: { linked: true, googleEmail: g.email, next: st.next } });
    }
    const user = await a.findBySub(req, g.sub!);
    if (!user) {
      await a.audit(req, 'auth.google_login', 'unknown', { googleEmail: g.email, reason: 'not_linked' }, true);
      throw new AppError(403, 'GOOGLE_NOT_LINKED', 'This Google account is not linked to an AfeySync user here. Sign in with your password, then link Google from your account page.');
    }
    if (user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized('Account temporarily locked after failed attempts. Try again later.', 'ACCOUNT_LOCKED');
    const data = (await a.afterPrimary(req, res, user)) as Record<string, unknown>;
    res.json({ success: true, data: { ...data, next: st.next } });
  }));

  r.post('/google/unlink', a.authenticate, h(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const user = await a.findById(req, a.userId(req));
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
    if (!user.google?.sub) throw badRequest('No Google account is linked');
    const was = user.google.email;
    user.set('google', undefined);
    await user.save();
    await a.audit(req, 'auth.google_unlinked', String(user._id), { googleEmail: was });
    await a.notify(req, user, 'Google account unlinked', `The Google account ${was} can no longer be used to sign in to your AfeySync account.`);
    res.json({ success: true });
  }));

  r.get('/google/link', a.authenticate, h(async (req, res) => {
    const user = await a.findById(req, a.userId(req));
    res.json({ success: true, data: { enabled: await a.allowed(req), linked: Boolean(user?.google?.sub), googleEmail: user?.google?.email ?? null } });
  }));

  return r;
}

export { googleEnabled };
