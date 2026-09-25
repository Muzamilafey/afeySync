import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { badRequest, forbidden, unauthorized } from '../../utils/errors';
import { ALL_METHODS, MFA_SELECT, beginLoginChallenge, buildMfaRouter, DEFAULT_POLICY, enabledMethods, policySchema, type MfaAdapter, type MfaDoc, type MfaPolicy } from './mfa/mfaService';
import { loadTenant } from '../tenants/tenantLoader';
import { createSession, revokeFamily, rotateSession, signAccessToken } from './tokens';
import { hashPassword, LOCK_MINUTES, MAX_FAILED_LOGINS, passwordPolicy, verifyPassword } from './password';
import { assertCsrfHeader, clearRefreshCookie, setRefreshCookie, TENANT_RT_COOKIE } from './cookies';
import { authenticateTenant } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { integrationStatusForTenant } from '../integrations/integrationConfigService';
import { randomToken, sha256 } from '../../utils/crypto';
import { notifyEmail } from '../notifications/notify';
import { revokeAllForSubject } from './tokens';
import { buildGoogleRouter, googleEnabled, type GoogleAdapter } from './google/google.routes';

const COOKIE_PATH = '/api/v1/auth';
const router = Router();

router.post(
  '/login',
  h(async (req, res) => {
    const body = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    if (!req.hostTenantId) throw badRequest('Facility could not be determined from this address. Use your facility URL.', undefined, 'TENANT_NOT_RESOLVED');
    const tenant = await loadTenant(req.hostTenantId);
    req.tenant = tenant;
    const { User } = tenant.models;
    const user = await User.findOne({ email: body.email.toLowerCase() }).select(MFA_SELECT);
    const fail = async (reason: string) => {
      await audit(req, { action: 'auth.login', resource: 'user', resourceId: user ? String(user._id) : null, newValue: { email: body.email, reason }, result: 'failure' });
      throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    };
    if (!user) return fail('unknown_user');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized('Account temporarily locked after failed attempts. Try again later.', 'ACCOUNT_LOCKED');
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
    res.json({ success: true, data: await afterPrimaryAuth(req, res, tenant, user, 'password') });
  }),
);


type Tenant = Awaited<ReturnType<typeof loadTenant>>;
type UserDoc = NonNullable<Awaited<ReturnType<Tenant['models']['User']['findOne']>>>;

export async function tenantMfaPolicy(tenant: Tenant): Promise<MfaPolicy> {
  const s = await tenant.models.FacilitySetting.findOne({ key: 'security.mfa' }).lean();
  const parsed = policySchema.safeParse(s?.value);
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

async function mfaRequiredFor(tenant: Tenant, user: { roleIds?: unknown[] }, policy: MfaPolicy) {
  if (policy.mode === 'all') return true;
  if (policy.mode === 'optional') return false;
  const roles = await tenant.models.Role.find({ _id: { $in: user.roleIds ?? [] } }).select('permissions').lean();
  return roles.some((r) => (r.permissions ?? []).some((p: string) => p.startsWith('admin.')));
}

/** Issues the refresh session + access token (optionally restricted to MFA enrollment). */
async function issueTenantSession(req: Request, res: Response, tenant: Tenant, user: UserDoc, opts: { restricted?: string; amr: string[] }) {
  user.lastLoginAt = new Date();
  await user.save();
  const { refreshToken, session } = await createSession({ subjectType: 'tenant', subjectId: String(user._id), tenantId: tenant.id, ip: req.ip, userAgent: req.get('user-agent'), restricted: opts.restricted, amr: opts.amr });
  const accessToken = signAccessToken({ sub: String(user._id), scope: 'tenant', sid: String(session._id), tid: tenant.id, ...(opts.restricted ? { rst: opts.restricted } : {}) });
  setRefreshCookie(res, TENANT_RT_COOKIE, refreshToken, COOKIE_PATH, session.expiresAt);
  req.user = { kind: 'tenant', id: String(user._id), name: user.name, email: user.email, permissions: new Set(), roleKeys: [], branchAccess: 'all', branchIds: [], sessionId: String(session._id) };
  await audit(req, { action: 'auth.login', resource: 'user', resourceId: String(user._id), newValue: { amr: opts.amr, restricted: opts.restricted } });
  await meta().Tenant.updateOne({ _id: tenant.id }, { 'stats.lastActivityAt': new Date() });
  return { accessToken, expiresIn: Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 900, mustChangePassword: user.mustChangePassword, ...(opts.restricted === 'mfa_enroll' ? { mfaEnrollmentRequired: true } : {}) };
}

/** After a successful first factor (password or Google): second factor, forced enrollment, or a full session. */
export async function afterPrimaryAuth(req: Request, res: Response, tenant: Tenant, user: UserDoc, via: string) {
  const policy = await tenantMfaPolicy(tenant);
  if (enabledMethods(user as unknown as MfaDoc).length) return beginLoginChallenge(req, tenantMfa, user as unknown as MfaDoc, tenant.id, policy, via);
  if (await mfaRequiredFor(tenant, user, policy)) return issueTenantSession(req, res, tenant, user, { restricted: 'mfa_enroll', amr: [via] });
  return issueTenantSession(req, res, tenant, user, { amr: [via] });
}

const tenantMfa: MfaAdapter = {
  kind: 'tenant',
  supported: ALL_METHODS,
  authenticate: authenticateTenant,
  brand: (req) => `AfeySync ${req.tenant?.name ?? ''}`.trim(),
  tenantId: (req) => req.tenant?.id ?? null,
  userId: (req) => {
    if (req.user?.kind !== 'tenant') throw forbidden('Support sessions cannot manage two-factor settings');
    return req.user.id;
  },
  loadUser: async (req, id) => (await req.tenant!.models.User.findById(id).select(MFA_SELECT)) as unknown as MfaDoc | null,
  loadChallengeUser: async (req, ch) => {
    if (!ch.tenantId || (req.hostTenantId && req.hostTenantId !== String(ch.tenantId))) return null;
    const tenant = await loadTenant(String(ch.tenantId));
    req.tenant = tenant;
    const u = await tenant.models.User.findById(ch.subjectId).select(MFA_SELECT);
    return u && u.status === 'active' ? (u as unknown as MfaDoc) : null;
  },
  policy: (req) => tenantMfaPolicy(req.tenant!),
  isRequired: (req, doc, policy) => mfaRequiredFor(req.tenant!, doc as unknown as { roleIds?: unknown[] }, policy),
  completeLogin: async (req, res, doc, amr) => issueTenantSession(req, res, req.tenant!, doc as unknown as UserDoc, { amr }),
  liftRestriction: async (req) => {
    const s = await meta().Session.findById(req.user!.sessionId);
    if (!s?.restricted) return undefined;
    s.restricted = undefined;
    await s.save();
    await meta().Session.updateMany({ familyId: s.familyId }, { $unset: { restricted: 1 } });
    return signAccessToken({ sub: req.user!.id, scope: 'tenant', sid: String(s._id), tid: req.tenant!.id });
  },
  audit: async (req, action, resourceId, extra, failed) => audit(req, { action, resource: 'user', resourceId, newValue: extra, result: failed ? 'failure' : 'success' }),
};

router.use(buildMfaRouter(tenantMfa));

async function hostTenant(req: Request) {
  if (!req.tenant) {
    if (!req.hostTenantId) throw badRequest('Facility could not be determined from this address.', undefined, 'TENANT_NOT_RESOLVED');
    req.tenant = await loadTenant(req.hostTenantId);
  }
  return req.tenant;
}

const tenantGoogle: GoogleAdapter = {
  portal: 'tenant',
  authenticate: authenticateTenant,
  allowed: async (req) => {
    if (!(await googleEnabled())) return false;
    const tenant = await hostTenant(req);
    const setting = await tenant.models.FacilitySetting.findOne({ key: 'security.googleLogin' }).lean();
    return setting?.value !== false;
  },
  tenantId: (req) => req.tenant!.id,
  userId: (req) => tenantMfa.userId(req),
  findBySub: async (req, sub) => (await (await hostTenant(req)).models.User.findOne({ 'google.sub': sub }).select(MFA_SELECT)) as never,
  findById: async (req, id) => (await (await hostTenant(req)).models.User.findById(id).select(MFA_SELECT)) as never,
  afterPrimary: async (req, res, user) => afterPrimaryAuth(req, res, await hostTenant(req), user as unknown as UserDoc, 'google'),
  audit: async (req, action, userId, extra, failed) => audit(req, { action, resource: 'user', resourceId: userId, newValue: extra, result: failed ? 'failure' : 'success' }),
  notify: async (req, user, subject, text) => notifyEmail(req.tenant!.id, `google:${String(user._id)}:${Date.now()}`, user.email, `${req.tenant!.name}: ${subject}`, text),
};

router.use(buildGoogleRouter(tenantGoogle));

router.post(
  '/refresh',
  h(async (req, res) => {
    assertCsrfHeader(req);
    const raw = req.cookies?.[TENANT_RT_COOKIE];
    if (!raw) throw unauthorized('No session', 'SESSION_INVALID');
    const rotated = await rotateSession(raw, 'tenant', { ip: req.ip, userAgent: req.get('user-agent') });
    const tid = String(rotated.session.tenantId);
    if (req.hostTenantId && req.hostTenantId !== tid) throw unauthorized('Session does not belong to this facility', 'TENANT_MISMATCH');
    const tenant = await loadTenant(tid);
    const user = await tenant.models.User.findById(rotated.session.subjectId).lean();
    if (!user || user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'tenant', sid: String(rotated.session._id), tid, ...(rotated.session.restricted ? { rst: rotated.session.restricted } : {}) });
    setRefreshCookie(res, TENANT_RT_COOKIE, rotated.refreshToken, COOKIE_PATH, rotated.session.expiresAt);
    res.json({ success: true, data: { accessToken } });
  }),
);

router.post(
  '/logout',
  authenticateTenant,
  h(async (req, res) => {
    await revokeFamily(req.user!.sessionId, 'logout');
    clearRefreshCookie(res, TENANT_RT_COOKIE, COOKIE_PATH);
    await audit(req, { action: 'auth.logout', resource: 'user', resourceId: req.user!.id });
    res.json({ success: true });
  }),
);

router.get(
  '/me',
  authenticateTenant,
  h(async (req, res) => {
    const { Branch } = req.tenant!.models;
    const u = req.user!;
    const branchQuery: Record<string, unknown> = u.branchAccess === 'all' ? { status: 'active' } : { _id: { $in: u.branchIds }, status: 'active' };
    const branches = await Branch.find(branchQuery).select('branchName branchCode isMain county facilityLevel').sort({ isMain: -1, branchName: 1 }).lean();
    res.json({
      success: true,
      data: {
        user: { id: u.id, name: u.name, email: u.email, kind: u.kind, roles: u.roleKeys, branchAccess: u.branchAccess },
        permissions: [...u.permissions].sort(),
        tenant: { id: req.tenant!.id, name: req.tenant!.name, slug: req.tenant!.slug },
        activeBranch: req.branch ?? null,
        branches,
        integrations: await integrationStatusForTenant(req.tenant!.id),
      },
    });
  }),
);

router.post(
  '/change-password',
  authenticateTenant,
  h(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordPolicy }), req.body);
    if (req.user!.kind !== 'tenant') throw unauthorized();
    const { User } = req.tenant!.models;
    const user = await User.findById(req.user!.id).select('+passwordHash');
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    user.passwordHash = await hashPassword(body.newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    await audit(req, { action: 'auth.password_changed', resource: 'user', resourceId: req.user!.id });
    await notifyEmail(req.tenant!.id, `pwchanged:${req.user!.id}:${Date.now()}`, user.email, `${req.tenant!.name}: your password was changed`, 'Your AfeySync password was just changed. If this was not you, contact your administrator immediately.');
    res.json({ success: true });
  }),
);

/**
 * Password reset by email. The response never reveals whether an account exists. Tokens are single-use,
 * stored hashed, expire in 30 minutes, and a successful reset signs the user out everywhere.
 */
router.post(
  '/forgot-password',
  h(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email().max(200) }), req.body);
    if (!req.hostTenantId) throw badRequest('Facility could not be determined from this address. Use your facility URL.', undefined, 'TENANT_NOT_RESOLVED');
    const tenant = await loadTenant(req.hostTenantId);
    req.tenant = tenant;
    const user = await tenant.models.User.findOne({ email: email.toLowerCase(), status: 'active' }).lean();
    if (user) {
      const token = randomToken(32);
      await tenant.models.PasswordReset.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
      const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
      await notifyEmail(tenant.id, `pwreset:${user._id}:${sha256(token).slice(0, 12)}`, user.email, `${tenant.name}: reset your AfeySync password`, `A password reset was requested for your account.\n\nOpen this link within 30 minutes to set a new password:\n${link}\n\nIf you did not request this, ignore this email.`);
      await audit(req, { action: 'auth.password_reset_requested', resource: 'user', resourceId: String(user._id) });
    }
    res.json({ success: true, message: 'If the account exists, a reset link has been sent to its email address.' });
  }),
);

router.post(
  '/reset-password',
  h(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(20).max(200), newPassword: passwordPolicy }), req.body);
    if (!req.hostTenantId) throw badRequest('Facility could not be determined from this address.', undefined, 'TENANT_NOT_RESOLVED');
    const tenant = await loadTenant(req.hostTenantId);
    req.tenant = tenant;
    const reset = await tenant.models.PasswordReset.findOne({ tokenHash: sha256(body.token) });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw unauthorized('This reset link is invalid or has expired', 'RESET_TOKEN_INVALID');
    const user = await tenant.models.User.findById(reset.userId).select('+passwordHash');
    if (!user || user.status !== 'active') throw unauthorized('This reset link is invalid or has expired', 'RESET_TOKEN_INVALID');
    user.passwordHash = await hashPassword(body.newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    reset.usedAt = new Date();
    await reset.save();
    await tenant.models.PasswordReset.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });
    await revokeAllForSubject(String(user._id), 'password_reset');
    await audit(req, { action: 'auth.password_reset_completed', resource: 'user', resourceId: String(user._id) });
    res.json({ success: true });
  }),
);

export default router;
