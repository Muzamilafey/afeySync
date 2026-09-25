import type { NextFunction, Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { meta } from '../models/meta';
import { loadTenant } from '../modules/tenants/tenantLoader';
import { isSessionActive, verifyAccessToken } from '../modules/auth/tokens';
import { PLATFORM_ROLE_PERMISSIONS } from '../modules/rbac/catalog';
import { forbidden, unauthorized } from '../utils/errors';

/** A session restricted to MFA enrollment may only reach the enrollment endpoints (enforced server-side). */
function assertNotRestricted(req: Request, restriction: string | undefined, allowed: RegExp) {
  if (restriction === 'mfa_enroll' && !allowed.test(req.originalUrl)) {
    throw forbidden('Set up two-factor authentication to continue', 'MFA_ENROLLMENT_REQUIRED');
  }
}

function bearer(req: Request): string {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();
  return token;
}

/** Resolve permissions + branch scope for a tenant user from the tenant database. */
export async function loadTenantUserAccess(req: Request, userId: string) {
  const { User, Role } = req.tenant!.models;
  const user = await User.findById(userId).lean();
  if (!user || user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
  const roles = await Role.find({ _id: { $in: user.roleIds } }).lean();
  const permissions = new Set(roles.flatMap((r) => r.permissions));
  return { user, roles, permissions };
}

/**
 * Tenant request authentication. Establishes request.user, request.tenant, request.branch and
 * request.permissions entirely on the server.
 */
export async function authenticateTenant(req: Request, _res: Response, next: NextFunction) {
  const claims = verifyAccessToken(bearer(req), ['tenant', 'support']);
  if (req.isOwnerHost) throw forbidden('Facility sessions are not valid on the owner portal', 'WRONG_PORTAL');
  if (!claims.tid) throw unauthorized();
  // When the hostname maps to a tenant, the token must belong to that same tenant.
  if (req.hostTenantId && req.hostTenantId !== claims.tid) throw forbidden('Session does not belong to this facility', 'TENANT_MISMATCH');
  if (!(await isSessionActive(claims.sid))) throw unauthorized('Session has ended', 'SESSION_REVOKED');
  assertNotRestricted(req, claims.rst, /^\/api\/v1\/auth\/(me|logout|mfa)(\/|\?|$)/);

  req.tenant = await loadTenant(claims.tid);
  const { Branch } = req.tenant.models;

  if (claims.scope === 'support') {
    const grant = await meta().SupportAccessGrant.findById(claims.gid).lean();
    if (!grant || grant.status !== 'approved' || String(grant.tenantId) !== claims.tid || !grant.expiresAt || grant.expiresAt < new Date()) {
      throw unauthorized('Support access has expired or was revoked', 'SUPPORT_ACCESS_INVALID');
    }
    const pu = await meta().PlatformUser.findById(claims.sub).lean();
    if (!pu || pu.status !== 'active') throw unauthorized();
    req.user = {
      kind: 'support',
      id: String(pu._id),
      name: `${pu.name} (AfeySync Support)`,
      email: pu.email,
      permissions: new Set(grant.permissions),
      roleKeys: ['platform_support'],
      branchAccess: 'all',
      branchIds: [],
      sessionId: claims.sid,
      supportGrantId: String(grant._id),
    };
  } else {
    const { user, roles, permissions } = await loadTenantUserAccess(req, claims.sub);
    const tenantWideRole = roles.some((r) => r.scope === 'tenant');
    req.user = {
      kind: 'tenant',
      id: String(user._id),
      name: user.name,
      email: user.email,
      permissions,
      roleKeys: roles.map((r) => r.key),
      branchAccess: user.branchAccess === 'all' || tenantWideRole ? 'all' : 'specific',
      branchIds: (user.branchIds ?? []).map(String),
      sessionId: claims.sid,
    };
  }
  req.permissions = req.user.permissions;

  // Active branch: requested via X-Branch-Id, validated against the user's branch scope.
  const requested = req.get('x-branch-id');
  let branchId: string | undefined;
  if (requested) {
    if (!isValidObjectId(requested)) throw forbidden('Invalid branch', 'BRANCH_FORBIDDEN');
    if (req.user.branchAccess !== 'all' && !req.user.branchIds.includes(requested)) {
      throw forbidden('You do not have access to this branch', 'BRANCH_FORBIDDEN');
    }
    branchId = requested;
  } else if (req.user.branchAccess !== 'all') {
    branchId = req.user.branchIds[0];
  }
  const branch = branchId
    ? await Branch.findOne({ _id: branchId, status: 'active' }).lean()
    : await Branch.findOne({ status: 'active' }).sort({ isMain: -1, createdAt: 1 }).lean();
  if (branchId && !branch) throw forbidden('Branch is unavailable', 'BRANCH_FORBIDDEN');
  if (branch) req.branch = { id: String(branch._id), name: branch.branchName, code: branch.branchCode };
  next();
}

export async function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  const claims = verifyAccessToken(bearer(req), ['platform']);
  if (req.hostTenantId) throw forbidden('Owner sessions are not valid on facility domains', 'WRONG_PORTAL');
  if (!(await isSessionActive(claims.sid))) throw unauthorized('Session has ended', 'SESSION_REVOKED');
  assertNotRestricted(req, claims.rst, /^\/api\/v1\/owner\/auth\/(me|logout|mfa)(\/|\?|$)/);
  const user = await meta().PlatformUser.findById(claims.sub).lean();
  if (!user || user.status !== 'active') throw unauthorized('User account is not active', 'USER_INACTIVE');
  const permissions = new Set(PLATFORM_ROLE_PERMISSIONS[user.role] ?? []);
  req.platformUser = { id: String(user._id), email: user.email, name: user.name, role: user.role, permissions, sessionId: claims.sid };
  req.permissions = permissions;
  next();
}

/** Require ALL listed permissions. */
export const requirePermission =
  (...perms: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const have = req.permissions ?? new Set<string>();
    const missing = perms.filter((p) => !have.has(p));
    if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
    next();
  };

/** Require ANY of the listed permissions. */
export const requireAnyPermission =
  (...perms: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const have = req.permissions ?? new Set<string>();
    if (!perms.some((p) => have.has(p))) throw forbidden(`Requires one of: ${perms.join(', ')}`);
    next();
  };

export const requireBranch = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.branch) throw forbidden('No active branch selected', 'BRANCH_REQUIRED');
  next();
};
