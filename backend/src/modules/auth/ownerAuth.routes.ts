import { Router, type Request, type Response } from 'express';
import { MFA_SELECT, beginLoginChallenge, buildMfaRouter, enabledMethods, policySchema, type MfaAdapter, type MfaDoc, type MfaMethod, type MfaPolicy } from './mfa/mfaService';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { forbidden, unauthorized } from '../../utils/errors';
import { meta } from '../../models/meta';
import { createSession, revokeFamily, rotateSession, signAccessToken } from './tokens';
import { hashPassword, LOCK_MINUTES, MAX_FAILED_LOGINS, passwordPolicy, verifyPassword } from './password';
import { assertCsrfHeader, clearRefreshCookie, OWNER_RT_COOKIE, setRefreshCookie } from './cookies';
import { authenticatePlatform } from '../../middleware/auth';
import { platformAudit } from '../audit/auditService';
import { notifyEmail } from '../notifications/notify';
import { buildGoogleRouter, googleEnabled, type GoogleAdapter } from './google/google.routes';

const COOKIE_PATH = '/api/v1/owner/auth';
const router = Router();

router.post(
  '/login',
  h(async (req, res) => {
    if (req.hostTenantId) throw forbidden('The owner portal is not available on facility domains', 'WRONG_PORTAL');
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const { PlatformUser } = meta();
    const user = await PlatformUser.findOne({ email: body.email.toLowerCase() }).select(MFA_SELECT);
    const fail = async (reason: string) => {
      await platformAudit(req, { action: 'owner.login', resource: 'platform_user', resourceId: user ? String(user._id) : null, newValue: { email: body.email, reason }, result: 'failure' });
      throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    };
    if (!user) return fail('unknown_user');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized('Account temporarily locked', 'ACCOUNT_LOCKED');
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      user.failedLogins = (user.failedLogins ?? 0) + 1;
      if (user.failedLogins >= MAX_FAILED_LOGINS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        user.failedLogins = 0;
      }
      await user.save();
      return fail('bad_password');
    }
    if (user.status !== 'active') return fail('inactive');
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    res.json({ success: true, data: await afterOwnerPrimaryAuth(req, res, user, 'password') });
  }),
);


type PlatformUserDoc = NonNullable<Awaited<ReturnType<ReturnType<typeof meta>['PlatformUser']['findOne']>>>;
const OWNER_METHODS: MfaMethod[] = ['totp', 'email', 'passkey'];

export async function platformMfaPolicy(): Promise<MfaPolicy> {
  const s = await meta().PlatformSettings.findOne({ key: 'security.mfa' }).lean();
  const parsed = policySchema.safeParse(s?.value);
  return parsed.success ? { ...parsed.data, methods: parsed.data.methods.filter((m) => OWNER_METHODS.includes(m)) } : { mode: 'optional', methods: OWNER_METHODS };
}
const ownerMfaRequired = (user: { role?: string | null }, policy: MfaPolicy) => policy.mode === 'all' || (policy.mode === 'admins' && ['super_owner', 'platform_admin'].includes(user.role ?? ''));

async function issueOwnerSession(req: Request, res: Response, user: PlatformUserDoc, opts: { restricted?: string; amr: string[] }) {
  user.lastLoginAt = new Date();
  await user.save();
  const { refreshToken, session } = await createSession({ subjectType: 'platform', subjectId: String(user._id), ip: req.ip, userAgent: req.get('user-agent'), restricted: opts.restricted, amr: opts.amr });
  const accessToken = signAccessToken({ sub: String(user._id), scope: 'platform', sid: String(session._id), ...(opts.restricted ? { rst: opts.restricted } : {}) });
  setRefreshCookie(res, OWNER_RT_COOKIE, refreshToken, COOKIE_PATH, session.expiresAt);
  req.platformUser = { id: String(user._id), email: user.email, name: user.name, role: user.role, permissions: new Set(), sessionId: String(session._id) };
  await platformAudit(req, { action: 'owner.login', resource: 'platform_user', resourceId: String(user._id), newValue: { amr: opts.amr, restricted: opts.restricted } });
  return { accessToken, ...(opts.restricted === 'mfa_enroll' ? { mfaEnrollmentRequired: true } : {}) };
}

export async function afterOwnerPrimaryAuth(req: Request, res: Response, user: PlatformUserDoc, via: string) {
  const policy = await platformMfaPolicy();
  if (enabledMethods(user as unknown as MfaDoc).some((m) => OWNER_METHODS.includes(m))) return beginLoginChallenge(req, ownerMfa, user as unknown as MfaDoc, null, policy, via);
  if (ownerMfaRequired(user, policy)) return issueOwnerSession(req, res, user, { restricted: 'mfa_enroll', amr: [via] });
  return issueOwnerSession(req, res, user, { amr: [via] });
}

const ownerMfa: MfaAdapter = {
  kind: 'platform',
  supported: OWNER_METHODS,
  authenticate: authenticatePlatform,
  brand: () => 'AfeySync Platform',
  tenantId: () => null,
  userId: (req) => req.platformUser!.id,
  loadUser: async (_req, id) => (await meta().PlatformUser.findById(id).select(MFA_SELECT)) as unknown as MfaDoc | null,
  loadChallengeUser: async (req, ch) => {
    if (req.hostTenantId || ch.subjectType !== 'platform') return null;
    const u = await meta().PlatformUser.findById(ch.subjectId).select(MFA_SELECT);
    return u && u.status === 'active' ? (u as unknown as MfaDoc) : null;
  },
  policy: () => platformMfaPolicy(),
  isRequired: async (_req, doc, policy) => ownerMfaRequired(doc as unknown as { role?: string }, policy),
  completeLogin: async (req, res, doc, amr) => issueOwnerSession(req, res, doc as unknown as PlatformUserDoc, { amr }),
  liftRestriction: async (req) => {
    const s = await meta().Session.findById(req.platformUser!.sessionId);
    if (!s?.restricted) return undefined;
    await meta().Session.updateMany({ familyId: s.familyId }, { $unset: { restricted: 1 } });
    return signAccessToken({ sub: req.platformUser!.id, scope: 'platform', sid: String(s._id) });
  },
  audit: async (req, action, resourceId, extra, failed) => platformAudit(req, { action: action.replace(/^auth\./, 'owner.'), resource: 'platform_user', resourceId, newValue: extra, result: failed ? 'failure' : 'success' }),
};

router.use(buildMfaRouter(ownerMfa));

const ownerGoogle: GoogleAdapter = {
  portal: 'platform',
  authenticate: authenticatePlatform,
  allowed: () => googleEnabled(),
  tenantId: () => null,
  userId: (req) => req.platformUser!.id,
  findBySub: async (_req, sub) => (await meta().PlatformUser.findOne({ 'google.sub': sub }).select(MFA_SELECT)) as never,
  findById: async (_req, id) => (await meta().PlatformUser.findById(id).select(MFA_SELECT)) as never,
  afterPrimary: async (req, res, user) => afterOwnerPrimaryAuth(req, res, user as unknown as PlatformUserDoc, 'google'),
  audit: async (req, action, userId, extra, failed) => platformAudit(req, { action: action.replace(/^auth\./, 'owner.'), resource: 'platform_user', resourceId: userId, newValue: extra, result: failed ? 'failure' : 'success' }),
  notify: async (_req, user, subject, text) => notifyEmail(null, `google:${String(user._id)}:${Date.now()}`, user.email, `AfeySync Platform: ${subject}`, text),
};

router.use(buildGoogleRouter(ownerGoogle));

router.post(
  '/refresh',
  h(async (req, res) => {
    assertCsrfHeader(req);
    const raw = req.cookies?.[OWNER_RT_COOKIE];
    if (!raw) throw unauthorized('No session', 'SESSION_INVALID');
    const rotated = await rotateSession(raw, 'platform', { ip: req.ip, userAgent: req.get('user-agent') });
    const user = await meta().PlatformUser.findById(rotated.session.subjectId).lean();
    if (!user || user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'platform', sid: String(rotated.session._id), ...(rotated.session.restricted ? { rst: rotated.session.restricted } : {}) });
    setRefreshCookie(res, OWNER_RT_COOKIE, rotated.refreshToken, COOKIE_PATH, rotated.session.expiresAt);
    res.json({ success: true, data: { accessToken } });
  }),
);

router.post(
  '/logout',
  authenticatePlatform,
  h(async (req, res) => {
    await revokeFamily(req.platformUser!.sessionId);
    clearRefreshCookie(res, OWNER_RT_COOKIE, COOKIE_PATH);
    await platformAudit(req, { action: 'owner.logout' });
    res.json({ success: true });
  }),
);

router.get(
  '/me',
  authenticatePlatform,
  h(async (req, res) => {
    const u = req.platformUser!;
    res.json({ success: true, data: { user: { id: u.id, name: u.name, email: u.email, role: u.role }, permissions: [...u.permissions] } });
  }),
);

router.post(
  '/change-password',
  authenticatePlatform,
  h(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordPolicy }), req.body);
    const user = await meta().PlatformUser.findById(req.platformUser!.id).select('+passwordHash');
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    user.passwordHash = await hashPassword(body.newPassword);
    await user.save();
    await platformAudit(req, { action: 'owner.password_changed', resource: 'platform_user', resourceId: String(user._id) });
    res.json({ success: true });
  }),
);

export default router;
