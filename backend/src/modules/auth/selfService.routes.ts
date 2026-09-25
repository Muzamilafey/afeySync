import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parsePatch } from '../../utils/validate';
import { forbidden, notFound } from '../../utils/errors';
import { authenticateTenant } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { revokeFamily } from './tokens';

/**
 * Self-service for every signed-in facility user: their profile, the devices signed in to their
 * account and their recent sign-in activity. A user can only ever see and change their own account;
 * roles, branches, email and licence details stay with administrators.
 */
const router = Router();
router.use(authenticateTenant);

const selfOnly = (kind: string | undefined) => {
  if (kind !== 'tenant') throw forbidden('Only facility user accounts have a profile', 'NOT_A_FACILITY_USER');
};

router.get(
  '/profile',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const { User } = req.tenant!.models;
    const u = await User.findById(req.user!.id).populate('roleIds', 'name key').populate('branchIds', 'branchName branchCode').populate('defaultBranchId', 'branchName').lean();
    if (!u) throw notFound('User not found');
    const mfa = u.mfa;
    res.json({
      success: true,
      data: {
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone ?? null,
        roles: (u.roleIds as unknown as Array<{ name: string; key: string }>).map((r) => ({ name: r.name, key: r.key })),
        branchAccess: u.branchAccess,
        branches: u.branchAccess === 'all' ? [] : (u.branchIds as unknown as Array<{ branchName: string; branchCode: string }>).map((b) => ({ name: b.branchName, code: b.branchCode })),
        defaultBranch: (u.defaultBranchId as unknown as { branchName?: string } | null)?.branchName ?? null,
        practitioner: { cadre: u.practitioner?.cadre ?? null, licenseNumber: u.practitioner?.licenseNumber ?? null, registryVerified: !!u.practitioner?.registryVerifiedAt },
        facility: req.tenant!.name,
        memberSince: (u as { createdAt?: Date }).createdAt ?? null,
        lastLoginAt: u.lastLoginAt ?? null,
        security: {
          passwordChangedAt: u.passwordChangedAt ?? null,
          twoStep: [mfa?.totp?.confirmedAt && 'Authenticator app', mfa?.email?.enabledAt && 'Email code', mfa?.sms?.enabledAt && 'SMS code', mfa?.passkeys?.length && `Passkeys (${mfa.passkeys.length})`].filter(Boolean),
          googleLinked: !!u.google?.sub,
        },
      },
    });
  }),
);

/** Users can correct their own display name and phone number. Everything else is set by an administrator. */
router.patch(
  '/profile',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const body = parsePatch(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, 'can only contain digits, spaces, +, ( ) and -') }), req.body);
    const { User } = req.tenant!.models;
    const u = await User.findById(req.user!.id);
    if (!u) throw notFound('User not found');
    const before = { name: u.name, phone: u.phone };
    if (body.name !== undefined) u.name = body.name;
    if (body.phone !== undefined) u.phone = body.phone || undefined;
    await u.save();
    await audit(req, { action: 'user.profile_update', resource: 'user', resourceId: String(u._id), oldValue: before, newValue: { name: u.name, phone: u.phone } });
    res.json({ success: true, data: { name: u.name, phone: u.phone ?? null } });
  }),
);

function describeDevice(ua?: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Devices currently signed in to this account (one entry per sign-in). */
router.get(
  '/sessions',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const { Session } = meta();
    const current = await Session.findById(req.user!.sessionId).select('familyId').lean();
    const live = await Session.find({ subjectType: 'tenant', subjectId: req.user!.id, tenantId: req.tenant!.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
    const firstSeen = new Map<string, Date>();
    // When each sign-in started: the oldest record in its refresh-token family.
    for (const f of await Session.find({ familyId: { $in: live.map((s) => s.familyId) } }).select('familyId createdAt').lean()) {
      const at = (f as { createdAt?: Date }).createdAt;
      if (at && (!firstSeen.has(f.familyId) || at < firstSeen.get(f.familyId)!)) firstSeen.set(f.familyId, at);
    }
    res.json({
      success: true,
      data: live.map((s) => ({
        id: s.familyId,
        current: s.familyId === current?.familyId,
        device: describeDevice(s.userAgent),
        ip: s.ip ?? null,
        signedInAt: firstSeen.get(s.familyId) ?? (s as { createdAt?: Date }).createdAt,
        lastActiveAt: s.lastUsedAt ?? null,
        method: (s.amr ?? []).join(' + ') || 'password',
      })),
    });
  }),
);

router.post(
  '/sessions/:id/revoke',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const { Session } = meta();
    const s = await Session.findOne({ familyId: String(req.params.id), subjectType: 'tenant', subjectId: req.user!.id, tenantId: req.tenant!.id, revokedAt: null });
    if (!s) throw notFound('That sign-in was not found or has already ended');
    await revokeFamily(String(s._id), 'signed_out_by_user');
    await audit(req, { action: 'auth.session_revoked', resource: 'user', resourceId: req.user!.id, newValue: { device: describeDevice(s.userAgent) } });
    res.json({ success: true });
  }),
);

/** Signs out every other device, keeping this one. */
router.post(
  '/sessions/revoke-others',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const { Session } = meta();
    const current = await Session.findById(req.user!.sessionId).select('familyId').lean();
    const r = await Session.updateMany({ subjectType: 'tenant', subjectId: req.user!.id, tenantId: req.tenant!.id, revokedAt: null, familyId: { $ne: current?.familyId } }, { revokedAt: new Date(), revokedReason: 'signed_out_by_user' });
    await audit(req, { action: 'auth.sessions_revoked_others', resource: 'user', resourceId: req.user!.id, newValue: { count: r.modifiedCount } });
    res.json({ success: true, data: { signedOut: r.modifiedCount } });
  }),
);

const ACTIVITY_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_completed': 'Password reset by email link',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.mfa_enabled': 'Two-step method added',
  'auth.mfa_disabled': 'Two-step method removed',
  'auth.mfa_failed': 'Wrong two-step code',
  'auth.mfa_recovery_regenerated': 'New recovery codes',
  'auth.session_revoked': 'Signed out a device',
  'auth.sessions_revoked_others': 'Signed out other devices',
  'user.password_reset': 'Password reset by an administrator',
  'user.mfa_reset': 'Two-step reset by an administrator',
  'user.profile_update': 'Profile updated',
};

/** The account's recent security events, including failed sign-in attempts. */
router.get(
  '/activity',
  h(async (req, res) => {
    selfOnly(req.user!.kind);
    const rows = await req.tenant!.models.AuditLog.find({ resource: 'user', resourceId: req.user!.id, action: { $in: Object.keys(ACTIVITY_LABELS) } }).sort({ createdAt: -1 }).limit(25).select('action result ip device createdAt').lean();
    res.json({ success: true, data: rows.map((r) => ({ at: (r as { createdAt?: Date }).createdAt, event: r.result === 'failure' && r.action === 'auth.login' ? 'Failed sign-in attempt' : ACTIVITY_LABELS[r.action] ?? r.action, ok: r.result !== 'failure', ip: r.ip ?? null, device: describeDevice(r.device) })) });
  }),
);

export default router;
