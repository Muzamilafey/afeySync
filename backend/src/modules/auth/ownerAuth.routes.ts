import { Router } from 'express';
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

const COOKIE_PATH = '/api/v1/owner/auth';
const router = Router();

router.post(
  '/login',
  h(async (req, res) => {
    if (req.hostTenantId) throw forbidden('The owner portal is not available on facility domains', 'WRONG_PORTAL');
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const { PlatformUser } = meta();
    const user = await PlatformUser.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
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
    user.lastLoginAt = new Date();
    await user.save();
    const { refreshToken, session } = await createSession({ subjectType: 'platform', subjectId: String(user._id), ip: req.ip, userAgent: req.get('user-agent') });
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'platform', sid: String(session._id) });
    setRefreshCookie(res, OWNER_RT_COOKIE, refreshToken, COOKIE_PATH, session.expiresAt);
    req.platformUser = { id: String(user._id), email: user.email, name: user.name, role: user.role, permissions: new Set(), sessionId: String(session._id) };
    await platformAudit(req, { action: 'owner.login', resource: 'platform_user', resourceId: String(user._id) });
    res.json({ success: true, data: { accessToken } });
  }),
);

router.post(
  '/refresh',
  h(async (req, res) => {
    assertCsrfHeader(req);
    const raw = req.cookies?.[OWNER_RT_COOKIE];
    if (!raw) throw unauthorized('No session', 'SESSION_INVALID');
    const rotated = await rotateSession(raw, 'platform', { ip: req.ip, userAgent: req.get('user-agent') });
    const user = await meta().PlatformUser.findById(rotated.session.subjectId).lean();
    if (!user || user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
    const accessToken = signAccessToken({ sub: String(user._id), scope: 'platform', sid: String(rotated.session._id) });
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
