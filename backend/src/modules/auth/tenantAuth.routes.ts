import { Router, type Request, type Response } from 'express';
import { authConfig, accountsHost, env } from '../../config/env';
import { explainUnknownHost, isLoopbackHost, platformSubdomain } from '../../middleware/tenantResolver';
import { tenantsForEmail } from './directory';
import { requestOrigin } from '../../utils/origin';
import { editorBranding, logoFile, publicBranding } from '../branding/brandingService';
import { tenantEntitlements } from '../plans/planService';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError, badRequest, forbidden, unauthorized } from '../../utils/errors';
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

/* ------------------------------------------------------------------ Main-domain sign-in (facility discovery) */
const HANDOFF_TTL_MS = 60_000;
/**
 * The main sign-in address: PLATFORM_DOMAIN (or www.), the host of FRONTEND_URL, and this computer's own
 * addresses (localhost, 127.0.0.1) in any mode — so the main page works locally even with NODE_ENV=production or a
 * production PLATFORM_DOMAIN.
 * Returns the base domain facility addresses are built on, or null when this is not the main address.
 */
function platformBase(req: Request): string | null {
  if (req.isOwnerHost || req.hostTenantId) return null;
  const host = (req.hostname || '').toLowerCase();
  if (req.isAccountsHost) return host.replace(/^accounts\./, '');
  const apex = env.PLATFORM_DOMAIN.toLowerCase();
  if (host === apex || host === `www.${apex}`) return apex;
  if (isLoopbackHost(host)) return 'localhost';
  let frontHost = '';
  try {
    frontHost = new URL(env.FRONTEND_URL).hostname.toLowerCase();
  } catch {
    /* invalid FRONTEND_URL */
  }
  if (frontHost && host === frontHost) return host.replace(/^www\./, '');
  return null;
}
const platformHost = (req: Request) => platformBase(req) !== null;

/** Where passwords are entered: only the accounts address when central sign-in is on. */
const signInHost = (req: Request) => (authConfig.centralLogin ? !!req.isAccountsHost : platformHost(req));

/**
 * The accounts address, on the scheme and port the user is browsing: accounts.localhost locally,
 * ACCOUNTS_HOST (accounts.<PLATFORM_DOMAIN>) otherwise.
 */
export function accountsOrigin(req: Request) {
  const front = new URL(env.FRONTEND_URL);
  const host = (req.hostname || '').toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || isLoopbackHost(host);
  return `${front.protocol}//${local ? 'accounts.localhost' : accountsHost}${front.port ? `:${front.port}` : ''}`;
}

/** Same browser that entered the password: exact client IP and User-Agent. */
const uaHash = (req: Request) => sha256(`ua:${req.get('user-agent') ?? ''}`);

const useAccounts = (req: Request) => new AppError(403, 'USE_ACCOUNTS_LOGIN', `Sign in at ${accountsOrigin(req).replace(/^https?:\/\//, '')}. You will be brought back to your facility.`, { accountsUrl: accountsOrigin(req) });
/** Builds a facility address on the same scheme, base domain and port the user is browsing (works on localhost too). */
function facilityOrigin(req: Request, slug: string) {
  let proto = new URL(env.FRONTEND_URL).protocol;
  let port = new URL(env.FRONTEND_URL).port;
  const origin = req.get('origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.hostname.toLowerCase() === (req.hostname || '').toLowerCase()) ({ protocol: proto, port } = u);
    } catch {
      /* use FRONTEND_URL */
    }
  }
  const base = platformBase(req);
  const host = base && base !== env.PLATFORM_DOMAIN.toLowerCase() ? `${slug}.${base}` : platformSubdomain(slug);
  return `${proto}//${host}${port ? `:${port}` : ''}`;
}

/** What kind of address the browser is on, so the sign-in page can adapt. Public, reveals only the facility name. */
router.get(
  '/context',
  h(async (req, res) => {
    if (req.isOwnerHost) return res.json({ success: true, data: { kind: 'owner' } });
    const central = authConfig.centralLogin;
    const sso = { centralLogin: central, accountsUrl: accountsOrigin(req) };
    if (req.isAccountsHost) {
      // ?facility=<slug> (set when a facility page sent the user here) shows that facility's name and logo.
      const slug = typeof req.query.facility === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(req.query.facility) ? req.query.facility : null;
      const t = slug ? await meta().Tenant.findOne({ slug, status: 'active' }).select('name slug branding').lean() : null;
      return res.json({ success: true, data: { kind: 'accounts', ...sso, facility: t ? { name: t.name, slug: t.slug } : null, branding: null, facilityBranding: t ? { ...publicBranding(t), logoUrl: null } : null } });
    }
    if (req.hostTenantId) {
      const t = await meta().Tenant.findById(req.hostTenantId).select('name slug status branding').lean();
      return res.json({ success: true, data: { kind: 'facility', ...sso, facility: t ? { name: t.name, slug: t.slug } : null, branding: t ? publicBranding(t) : null } });
    }
    if (platformHost(req)) return res.json({ success: true, data: { kind: 'platform', ...sso } });
    res.json({ success: true, data: { kind: 'unknown', ...sso, message: await explainUnknownHost(req.hostname) } });
  }),
);

/** The facility's logo for its own address. Public (it is on the sign-in page); versioned URLs are cached. */
router.get(
  '/branding/logo',
  h(async (req, res) => {
    const logo = req.hostTenantId ? await logoFile(req.hostTenantId) : null;
    if (!logo) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No logo' } });
    res.setHeader('Content-Type', logo.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    res.setHeader('ETag', `"${logo.sha256.slice(0, 32)}"`);
    res.send(logo.data);
  }),
);

/**
 * Sign-in on the main domain: finds the facilities where this email and password are valid and returns
 * a single-use handoff link to each facility's own address. The same lockout rules as facility sign-in
 * apply; an unknown email and a wrong password get the same answer.
 */
router.post(
  '/find-facility',
  h(async (req, res) => {
    assertCsrfHeader(req);
    const body = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    if (!signInHost(req)) {
      if (authConfig.centralLogin) throw useAccounts(req);
      throw badRequest('Sign in at your facility address', undefined, 'NOT_PLATFORM_HOST');
    }
    const email = body.email.toLowerCase();
    const matches: Array<{ name: string; slug: string; url: string }> = [];
    let locked = false;
    for (const tenantId of await tenantsForEmail(email)) {
      let tenant: Tenant;
      try {
        tenant = await loadTenant(tenantId);
      } catch {
        continue; // suspended or unavailable facilities are skipped
      }
      const user = await tenant.models.User.findOne({ email }).select('+passwordHash name status failedLogins lockedUntil');
      if (!user) continue;
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        locked = true;
        continue;
      }
      if (!(await verifyPassword(body.password, user.passwordHash))) {
        user.failedLogins = (user.failedLogins ?? 0) + 1;
        if (user.failedLogins >= MAX_FAILED_LOGINS) {
          user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
          user.failedLogins = 0;
        }
        await user.save();
        await tenant.models.AuditLog.create({ actorType: 'user', action: 'auth.login', resource: 'user', resourceId: String(user._id), newValue: { email, reason: 'bad_password', via: 'main_domain' }, result: 'failure', ip: req.ip }).catch(() => undefined);
        continue;
      }
      if (user.status !== 'active') continue;
      const token = randomToken(32);
      // Only the hash is stored; the link works once, for 60 seconds, from this browser (IP + User-Agent), on this facility only.
      await meta().LoginHandoff.create({ tokenHash: sha256(`handoff:${token}`), tenantId, userId: user._id, ip: req.ip, uaHash: uaHash(req), facilitySlug: tenant.slug, expiresAt: new Date(Date.now() + HANDOFF_TTL_MS) });
      await tenant.models.AuditLog.create({ actorType: 'user', userId: user._id, userName: user.name, action: 'auth.handoff_issued', resource: 'user', resourceId: String(user._id), newValue: { via: 'accounts' }, ip: req.ip }).catch(() => undefined);
      matches.push({ name: tenant.name, slug: tenant.slug, url: `${facilityOrigin(req, tenant.slug)}/login#handoff=${token}` });
    }
    if (!matches.length) {
      if (locked) throw unauthorized('Account temporarily locked after failed attempts. Try again later.', 'ACCOUNT_LOCKED');
      throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    res.json({ success: true, data: { facilities: matches } });
  }),
);

/** Completes a main-domain sign-in on the facility's own address (then MFA, if enabled, as usual). */
router.post(
  '/handoff',
  h(async (req, res) => {
    assertCsrfHeader(req);
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.body);
    if (!req.hostTenantId) throw badRequest(await explainUnknownHost(req.hostname), undefined, 'TENANT_NOT_RESOLVED');
    const invalid = () => unauthorized('This sign-in link has expired. Sign in again.', 'HANDOFF_INVALID');
    // Consume atomically: a handoff works once, only on the facility it was issued for. Any attempt,
    // even a rejected one below, uses it up, so a leaked link cannot be retried.
    const handoff = await meta().LoginHandoff.findOneAndUpdate({ tokenHash: sha256(`handoff:${token}`), usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() }, { returnDocument: 'before' });
    if (!handoff || String(handoff.tenantId) !== req.hostTenantId) throw invalid();
    const tenant = await loadTenant(req.hostTenantId);
    req.tenant = tenant;
    if (handoff.ip !== req.ip || (handoff.uaHash && handoff.uaHash !== uaHash(req))) {
      await audit(req, { action: 'auth.handoff_rejected', resource: 'user', resourceId: String(handoff.userId), newValue: { reason: handoff.ip !== req.ip ? 'different_ip' : 'different_browser' }, result: 'denied' });
      throw invalid();
    }
    const user = await tenant.models.User.findById(handoff.userId).select(MFA_SELECT);
    if (!user || user.status !== 'active' || (user.lockedUntil && user.lockedUntil > new Date())) throw invalid();
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    res.json({ success: true, data: await afterPrimaryAuth(req, res, tenant, user, 'password') });
  }),
);

router.post(
  '/login',
  h(async (req, res) => {
    const body = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    // Central sign-in: passwords are only ever typed on the accounts address.
    if (authConfig.centralLogin) throw useAccounts(req);
    if (!req.hostTenantId) throw badRequest(await explainUnknownHost(req.hostname), undefined, 'TENANT_NOT_RESOLVED');
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
    if (!req.hostTenantId) throw badRequest(await explainUnknownHost(req.hostname), undefined, 'TENANT_NOT_RESOLVED');
    req.tenant = await loadTenant(req.hostTenantId);
  }
  return req.tenant;
}

const tenantGoogle: GoogleAdapter = {
  portal: 'tenant',
  authenticate: authenticateTenant,
  allowed: async (req) => {
    if (authConfig.centralLogin || !(await googleEnabled())) return false;
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

/**
 * The letterhead printed at the top of receipts, invoices, reports and summaries: the facility's
 * logo (inline, so it prints whichever address the user signed in on) and the branch's contact details.
 */
router.get(
  '/letterhead',
  authenticateTenant,
  h(async (req, res) => {
    const { Branch } = req.tenant!.models;
    const b = await editorBranding(req.tenant!.id);
    const branch = await Branch.findOne(req.branch ? { _id: req.branch.id } : { isMain: true, status: 'active' })
      .select('branchName physicalAddress phone email facilityCode county subCounty')
      .lean();
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({
      success: true,
      data: {
        name: b.name,
        legalName: b.legalName,
        tagline: b.tagline,
        primaryColor: b.primaryColor,
        logoDataUrl: b.logoDataUrl,
        branch: branch
          ? { name: branch.branchName, address: branch.physicalAddress ?? null, phone: branch.phone ?? null, email: branch.email ?? null, facilityCode: branch.facilityCode ?? null, county: branch.county ?? null }
          : null,
      },
    });
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
        user: { id: u.id, name: u.name, email: u.email, kind: u.kind, roles: u.roleKeys, branchAccess: u.branchAccess, mustChangePassword: u.kind === 'tenant' ? !!(await req.tenant!.models.User.findById(u.id).select('mustChangePassword').lean())?.mustChangePassword : false },
        permissions: [...u.permissions].sort(),
        tenant: { id: req.tenant!.id, name: req.tenant!.name, slug: req.tenant!.slug },
        activeBranch: req.branch ?? null,
        branches,
        integrations: await integrationStatusForTenant(req.tenant!.id),
        subscription: await (async () => {
          const e = await tenantEntitlements(req.tenant!.id);
          return { plan: e.plan, planName: e.planName, status: e.status, endsAt: e.endsAt, modules: e.modules, unrestricted: e.unrestricted };
        })(),
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
    const sendReset = async (tenant: Tenant, origin: string) => {
      req.tenant = tenant;
      const user = await tenant.models.User.findOne({ email: email.toLowerCase(), status: 'active' }).lean();
      if (!user) return;
      const token = randomToken(32);
      await tenant.models.PasswordReset.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
      // The reset page is on the facility's own address (the token only works there).
      const link = `${origin}/reset-password?token=${token}`;
      await notifyEmail(tenant.id, `pwreset:${user._id}:${sha256(token).slice(0, 12)}`, user.email, `${tenant.name}: reset your AfeySync password`, `A password reset was requested for your account at ${tenant.name}.\n\nOpen this link within 30 minutes to set a new password:\n${link}\n\nIf you did not request this, ignore this email.`);
      await audit(req, { action: 'auth.password_reset_requested', resource: 'user', resourceId: String(user._id) });
    };
    if (req.hostTenantId) await sendReset(await loadTenant(req.hostTenantId), requestOrigin(req));
    else if (signInHost(req)) {
      // Accounts address: one reset link per facility where this email has an active account.
      for (const tenantId of await tenantsForEmail(email.toLowerCase())) {
        const tenant = await loadTenant(tenantId).catch(() => null);
        if (tenant) await sendReset(tenant, facilityOrigin(req, tenant.slug));
      }
    } else throw badRequest(await explainUnknownHost(req.hostname), undefined, 'TENANT_NOT_RESOLVED');
    // Same answer whether or not the email exists.
    res.json({ success: true, message: 'If the account exists, a reset link has been sent to its email address.' });
  }),
);

router.post(
  '/reset-password',
  h(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(20).max(200), newPassword: passwordPolicy }), req.body);
    if (!req.hostTenantId) throw badRequest(await explainUnknownHost(req.hostname), undefined, 'TENANT_NOT_RESOLVED');
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
