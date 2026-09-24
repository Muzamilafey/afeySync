import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { badRequest, unauthorized } from '../../utils/errors';
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
    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
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
    user.lastLoginAt = new Date();
    await user.save();

    const { refreshToken, session } = await createSession({ subjectType: 'tenant', subjectId: String(user._id), tenantId: tenant.id, ip: req.ip, userAgent: req.get('user-agent') });
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'tenant', sid: String(session._id), tid: tenant.id });
    setRefreshCookie(res, TENANT_RT_COOKIE, refreshToken, COOKIE_PATH, session.expiresAt);
    req.user = { kind: 'tenant', id: String(user._id), name: user.name, email: user.email, permissions: new Set(), roleKeys: [], branchAccess: 'all', branchIds: [], sessionId: String(session._id) };
    await audit(req, { action: 'auth.login', resource: 'user', resourceId: String(user._id) });
    await meta().Tenant.updateOne({ _id: tenant.id }, { 'stats.lastActivityAt': new Date() });
    res.json({ success: true, data: { accessToken, expiresIn: Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 900, mustChangePassword: user.mustChangePassword } });
  }),
);

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
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'tenant', sid: String(rotated.session._id), tid });
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
