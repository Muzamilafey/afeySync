import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { meta } from '../../models/meta';
import { randomToken, sha256 } from '../../utils/crypto';
import { unauthorized } from '../../utils/errors';

export type TokenScope = 'platform' | 'tenant' | 'support';

export interface AccessClaims {
  sub: string;
  scope: TokenScope;
  sid: string;
  tid?: string;
  gid?: string;
  /** Restricted session (e.g. 'mfa_enroll'): only enrollment endpoints are allowed. */
  rst?: string;
}

const ISSUER = 'afeysync';

export function signAccessToken(claims: AccessClaims, ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS) {
  return jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256', issuer: ISSUER, audience: claims.scope, expiresIn: ttlSeconds });
}

export function verifyAccessToken(token: string, allowed: TokenScope[]): AccessClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: allowed as [string, ...string[]],
    }) as AccessClaims & jwt.JwtPayload;
    return decoded;
  } catch {
    throw unauthorized('Invalid or expired access token', 'TOKEN_INVALID');
  }
}

interface SessionInput {
  subjectType: TokenScope;
  subjectId: string;
  tenantId?: string;
  ip?: string;
  userAgent?: string;
  familyId?: string;
  expiresAt?: Date;
  restricted?: string;
  amr?: string[];
}

/** Creates a refresh session. The raw refresh token is returned once and only its hash is stored. */
export async function createSession(input: SessionInput) {
  const raw = randomToken(48);
  const session = await meta().Session.create({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    tenantId: input.tenantId,
    familyId: input.familyId ?? randomToken(16),
    tokenHash: sha256(`${env.JWT_REFRESH_SECRET}:${raw}`),
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 300),
    lastUsedAt: new Date(),
    restricted: input.restricted,
    amr: input.amr,
    expiresAt: input.expiresAt ?? new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
  });
  return { refreshToken: raw, session };
}

/**
 * Refresh-token rotation with reuse detection: a refresh token can be used exactly once. Presenting a
 * token that was already rotated revokes the whole session family (likely token theft).
 */
export async function rotateSession(raw: string, expectedScope: TokenScope, meta_: { ip?: string; userAgent?: string }) {
  const { Session } = meta();
  const tokenHash = sha256(`${env.JWT_REFRESH_SECRET}:${raw}`);
  const current = await Session.findOne({ tokenHash });
  if (!current || current.subjectType !== expectedScope) throw unauthorized('Session not found', 'SESSION_INVALID');
  if (current.revokedAt) {
    if (current.replacedBy) {
      await Session.updateMany({ familyId: current.familyId, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'reuse_detected' });
    }
    throw unauthorized('Session has been revoked', 'SESSION_REVOKED');
  }
  if (current.expiresAt < new Date()) throw unauthorized('Session expired', 'SESSION_EXPIRED');
  const idleMs = env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
  if (current.lastUsedAt && Date.now() - current.lastUsedAt.getTime() > idleMs && expectedScope !== 'support') {
    current.revokedAt = new Date();
    current.revokedReason = 'idle_timeout';
    await current.save();
    throw unauthorized('Session timed out due to inactivity', 'SESSION_IDLE_TIMEOUT');
  }
  const next = await createSession({
    subjectType: current.subjectType as TokenScope,
    subjectId: String(current.subjectId),
    tenantId: current.tenantId ? String(current.tenantId) : undefined,
    familyId: current.familyId,
    ip: meta_.ip,
    userAgent: meta_.userAgent,
    expiresAt: current.expiresAt,
    restricted: current.restricted ?? undefined,
    amr: current.amr ?? undefined,
  });
  current.revokedAt = new Date();
  current.revokedReason = 'rotated';
  current.replacedBy = String(next.session._id);
  await current.save();
  return { previous: current, ...next };
}

export async function touchSession(sessionId: string) {
  await meta().Session.updateOne({ _id: sessionId }, { lastUsedAt: new Date() });
}

export async function isSessionActive(sessionId: string, familyAware = true): Promise<boolean> {
  const { Session } = meta();
  const s = await Session.findById(sessionId).select('revokedAt revokedReason familyId expiresAt').lean();
  if (!s) return false;
  if (s.expiresAt < new Date()) return false;
  if (!s.revokedAt) return true;
  // A rotated session's access tokens remain valid until they expire, as long as the family is alive.
  if (familyAware && s.revokedReason === 'rotated') {
    const alive = await Session.exists({ familyId: s.familyId, revokedAt: null });
    return Boolean(alive);
  }
  return false;
}

export async function revokeFamily(sessionId: string, reason = 'logout') {
  const { Session } = meta();
  const s = await Session.findById(sessionId).lean();
  if (s) await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
}

export async function revokeAllForSubject(subjectId: string, reason: string) {
  await meta().Session.updateMany({ subjectId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
}
