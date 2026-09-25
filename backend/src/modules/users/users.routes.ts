import { sendAccountEmail } from './accountEmails';
import { requestOrigin } from '../../utils/origin';
import { Router } from 'express';
import { registerDirectoryEntry, removeDirectoryEntry } from '../auth/directory';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse, parsePatch } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { hashPassword, passwordPolicy } from '../auth/password';
import { revokeAllForSubject } from '../auth/tokens';
import { audit } from '../audit/auditService';
import { refreshTenantStats } from '../tenants/provisioning';
import { ALL_TENANT_PERMISSIONS, PERMISSION_GROUPS } from '../rbac/catalog';
import { meta } from '../../models/meta';
import { randomToken } from '../../utils/crypto';
import { notifyEmail } from '../notifications/notify';
import type { Request } from 'express';

export const usersRouter = Router();
export const rolesRouter = Router();
export const permissionsRouter = Router();
for (const r of [usersRouter, rolesRouter, permissionsRouter]) r.use(authenticateTenant);

const oid = (id: string) => {
  if (!isValidObjectId(id)) throw notFound();
  return id;
};

/** Branch admins may only manage users inside their branches and cannot grant tenant-wide access. */
async function assertCanManageUser(req: Request, target: { branchAccess?: string | null; branchIds?: Types.ObjectId[] | string[] | null }) {
  if (req.user!.branchAccess === 'all') return;
  if (target.branchAccess === 'all') throw forbidden('Branch administrators cannot manage tenant-wide users');
  const ids = (target.branchIds ?? []).map(String);
  if (!ids.length || ids.some((b) => !req.user!.branchIds.includes(b))) throw forbidden('User is assigned to branches outside your scope', 'BRANCH_FORBIDDEN');
}

async function assertRolesGrantable(req: Request, roleIds: string[]) {
  const roles = await req.tenant!.models.Role.find({ _id: { $in: roleIds } }).lean();
  if (roles.length !== roleIds.length) throw badRequest('One or more roles do not exist');
  if (req.user!.branchAccess !== 'all' && roles.some((r) => r.scope === 'tenant')) throw forbidden('Branch administrators cannot assign tenant-wide roles');
  // Nobody can grant permissions they do not hold themselves.
  const escalation = roles.flatMap((r) => r.permissions).filter((p) => !req.user!.permissions.has(p));
  if (escalation.length) throw forbidden(`Cannot grant permissions you do not hold: ${[...new Set(escalation)].slice(0, 5).join(', ')}`);
}

/**
 * Keeps at least one active user who can manage users, so a facility can never lock itself out.
 * `change` describes the target user after the edit.
 */
async function assertAdminRemains(req: Request, targetId: string, change: { roleIds?: string[]; status?: string }) {
  const { User, Role } = req.tenant!.models;
  const adminRoles = (await Role.find({ permissions: 'admin.users' }).select('_id').lean()).map((r) => String(r._id));
  const target = await User.findById(targetId).select('roleIds status').lean();
  if (!target) return;
  const isAdminNow = target.status === 'active' && (target.roleIds ?? []).some((r) => adminRoles.includes(String(r)));
  if (!isAdminNow) return;
  const staysAdmin = (change.status ?? target.status) === 'active' && (change.roleIds ?? (target.roleIds ?? []).map(String)).some((r) => adminRoles.includes(String(r)));
  if (staysAdmin) return;
  const others = await User.countDocuments({ _id: { $ne: target._id }, status: 'active', roleIds: { $in: adminRoles } });
  if (!others) throw forbidden('This is the only active administrator. Give another user an administrator role first.', 'LAST_ADMIN');
}

usersRouter.get(
  '/',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const { User } = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = {};
    if (req.user!.branchAccess !== 'all') {
      filter.branchAccess = 'specific';
      filter.branchIds = { $in: req.user!.branchIds.map((b) => new Types.ObjectId(b)) };
    }
    const q = String(req.query.q ?? '').trim();
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }];
    const [items, total] = await Promise.all([
      User.find(filter).select('-passwordHash').populate('roleIds', 'name key scope').populate('branchIds', 'branchName branchCode').sort({ name: 1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

const userSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  roleIds: z.array(z.string().refine(isValidObjectId)).min(1),
  branchAccess: z.enum(['all', 'specific']),
  branchIds: z.array(z.string().refine(isValidObjectId)).default([]),
  password: passwordPolicy.optional(),
  practitioner: z.object({ cadre: z.string().max(60).optional(), licenseNumber: z.string().max(60).optional(), registryId: z.string().max(60).optional() }).optional(),
});

usersRouter.post(
  '/',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const body = parse(userSchema, req.body);
    const { User, Branch } = req.tenant!.models;
    if (body.branchAccess === 'specific' && !body.branchIds.length) throw badRequest('Select at least one branch');
    await assertCanManageUser(req, body);
    await assertRolesGrantable(req, body.roleIds);
    if ((await Branch.countDocuments({ _id: { $in: body.branchIds } })) !== body.branchIds.length) throw badRequest('Unknown branch');
    const sub = await meta().TenantSubscription.findOne({ tenantId: req.tenant!.id }).sort({ createdAt: -1 }).lean();
    if (sub && (await User.countDocuments({ status: { $ne: 'suspended' } })) >= (sub.maxUsers ?? 10)) throw forbidden('Your subscription user limit has been reached', 'SUBSCRIPTION_LIMIT');
    if (await User.exists({ email: body.email.toLowerCase() })) throw conflict('A user with this email already exists');
    const temporaryPassword = body.password ? undefined : `Afs-${randomToken(9)}9a`;
    const u = await User.create({
      ...body,
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password ?? temporaryPassword!),
      defaultBranchId: body.branchIds[0],
      mustChangePassword: true,
    });
    await registerDirectoryEntry(u.email, req.tenant!.id);
    await refreshTenantStats(req.tenant!.id, req.tenant!.models);
    await audit(req, { action: 'user.create', resource: 'user', resourceId: String(u._id), newValue: { ...body, password: undefined } });
    const roleNames = (await req.tenant!.models.Role.find({ _id: { $in: body.roleIds } }).select('name').lean()).map((r) => r.name);
    const { emailed } = await sendAccountEmail({ tenantId: req.tenant!.id, PasswordReset: req.tenant!.models.PasswordReset, user: u, origin: requestOrigin(req), kind: 'welcome', roleNames, byName: req.user!.name });
    res.status(201).json({ success: true, data: { id: u._id, email: u.email, temporaryPassword, welcomeEmail: emailed ? 'sent' : 'email_not_configured' } });
  }),
);

usersRouter.patch(
  '/:id',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parsePatch(userSchema.omit({ password: true }).partial(), req.body);
    const { User } = req.tenant!.models;
    const user = await User.findById(id);
    if (!user) throw notFound('User not found');
    await assertCanManageUser(req, user);
    if (body.branchAccess === 'specific' && !(body.branchIds ?? user.branchIds ?? []).length) throw badRequest('Select at least one branch');
    if (body.branchAccess || body.branchIds) await assertCanManageUser(req, { branchAccess: body.branchAccess ?? user.branchAccess, branchIds: body.branchIds ?? user.branchIds });
    if (body.branchIds?.length && (await req.tenant!.models.Branch.countDocuments({ _id: { $in: body.branchIds } })) !== body.branchIds.length) throw badRequest('Unknown branch');
    const rolesChanged = body.roleIds && JSON.stringify([...body.roleIds].sort()) !== JSON.stringify((user.roleIds ?? []).map(String).sort());
    if (rolesChanged) {
      if (id === req.user!.id) throw forbidden('You cannot change your own roles');
      await assertRolesGrantable(req, body.roleIds!);
      await assertAdminRemains(req, id, { roleIds: body.roleIds });
    } else delete body.roleIds;
    const oldEmail = user.email;
    const newEmail = body.email?.toLowerCase().trim();
    const emailChanged = !!newEmail && newEmail !== oldEmail;
    if (emailChanged && (await User.exists({ email: newEmail, _id: { $ne: user._id } }))) throw conflict('Another user already has this email address', undefined, 'EMAIL_TAKEN');
    delete body.email;
    const before = user.toObject();
    user.set(body);
    if (emailChanged) user.email = newEmail!;
    if (body.branchAccess === 'all') user.branchIds = [] as never;
    if (body.branchIds?.length && !body.branchIds.includes(String(user.defaultBranchId ?? ''))) user.defaultBranchId = new Types.ObjectId(body.branchIds[0]) as never;
    await user.save();
    if (emailChanged) {
      await removeDirectoryEntry(oldEmail, req.tenant!.id);
      await registerDirectoryEntry(newEmail!, req.tenant!.id);
      const msg = `The sign-in email for your AfeySync account at ${req.tenant!.name} was changed from ${oldEmail} to ${newEmail} by ${req.user!.name}. If you did not expect this, contact your administrator.`;
      await notifyEmail(req.tenant!.id, `email-changed:${id}:${Date.now()}:old`, oldEmail, `${req.tenant!.name}: your sign-in email was changed`, msg);
      await notifyEmail(req.tenant!.id, `email-changed:${id}:${Date.now()}:new`, newEmail!, `${req.tenant!.name}: this is now your sign-in email`, msg);
    }
    // Role or branch changes take effect on the next request (access is read from the database each time).
    await audit(req, { action: 'user.update', resource: 'user', resourceId: id, oldValue: before, newValue: user.toObject() });
    res.json({ success: true, data: { id, email: user.email } });
  }),
);

for (const action of ['suspend', 'activate'] as const) {
  usersRouter.post(
    `/:id/${action}`,
    requirePermission('admin.users'),
    h(async (req, res) => {
      const id = oid(req.params.id as string);
      if (id === req.user!.id) throw forbidden('You cannot change your own status');
      const { User } = req.tenant!.models;
      const user = await User.findById(id);
      if (!user) throw notFound('User not found');
      await assertCanManageUser(req, user);
      if (action === 'suspend') await assertAdminRemains(req, id, { status: 'suspended' });
      user.status = action === 'suspend' ? 'suspended' : 'active';
      await user.save();
      if (action === 'suspend') await revokeAllForSubject(id, 'suspended');
      await audit(req, { action: `user.${action}`, resource: 'user', resourceId: id });
      res.json({ success: true });
    }),
  );
}

/** Clears a user's two-factor methods (lost phone). The user must re-enroll if policy requires it. */
usersRouter.post(
  '/:id/mfa/reset',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { reason } = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
    if (id === req.user!.id) throw forbidden('Ask another administrator to reset your two-factor authentication');
    const { User } = req.tenant!.models;
    const user = await User.findById(id);
    if (!user) throw notFound('User not found');
    await assertCanManageUser(req, user);
    user.set('mfa', { totp: { lastStep: -1 }, passkeys: [], recoveryCodes: [] });
    await user.save();
    await revokeAllForSubject(id, 'mfa_reset');
    await audit(req, { action: 'user.mfa_reset', resource: 'user', resourceId: id, newValue: { reason } });
    await notifyEmail(req.tenant!.id, `mfa-reset:${id}:${Date.now()}`, user.email, `${req.tenant!.name}: two-factor authentication reset`, `An administrator reset two-factor authentication on your account (${reason}). You may need to set it up again at your next sign-in. If you did not request this, contact your administrator.`);
    res.json({ success: true });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { User } = req.tenant!.models;
    const user = await User.findById(id);
    if (!user) throw notFound('User not found');
    await assertCanManageUser(req, user);
    const temporaryPassword = `Afs-${randomToken(9)}9a`;
    user.passwordHash = await hashPassword(temporaryPassword);
    user.mustChangePassword = true;
    user.lockedUntil = undefined;
    await user.save();
    await revokeAllForSubject(id, 'password_reset');
    await audit(req, { action: 'user.password_reset', resource: 'user', resourceId: id });
    const { emailed } = await sendAccountEmail({ tenantId: req.tenant!.id, PasswordReset: req.tenant!.models.PasswordReset, user, origin: requestOrigin(req), kind: 'admin_reset', byName: req.user!.name });
    res.json({ success: true, data: { temporaryPassword, email: emailed ? 'sent' : 'email_not_configured' } });
  }),
);

/* Roles */
rolesRouter.get(
  '/',
  h(async (req, res) => {
    res.json({ success: true, data: await req.tenant!.models.Role.find({}).sort({ system: -1, name: 1 }).lean() });
  }),
);

const roleSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  scope: z.enum(['tenant', 'branch']).default('branch'),
  permissions: z.array(z.string()).min(1),
});

rolesRouter.post(
  '/',
  requirePermission('admin.roles'),
  h(async (req, res) => {
    const body = parse(roleSchema, req.body);
    const unknown = body.permissions.filter((p) => !ALL_TENANT_PERMISSIONS.includes(p));
    if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);
    const escalation = body.permissions.filter((p) => !req.user!.permissions.has(p));
    if (escalation.length) throw forbidden('Cannot create a role with permissions you do not hold');
    const key = `custom_${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
    const { Role } = req.tenant!.models;
    if (await Role.exists({ key })) throw conflict('A role with this name exists');
    const role = await Role.create({ ...body, key, system: false });
    await audit(req, { action: 'role.create', resource: 'role', resourceId: String(role._id), newValue: body });
    res.status(201).json({ success: true, data: role });
  }),
);

rolesRouter.patch(
  '/:id',
  requirePermission('admin.roles'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parsePatch(roleSchema.partial(), req.body);
    const { Role } = req.tenant!.models;
    const role = await Role.findById(id);
    if (!role) throw notFound('Role not found');
    if (role.key === 'facility_owner' || role.key === 'facility_admin') throw forbidden('Built-in administrator roles cannot be modified');
    if (body.permissions) {
      const unknown = body.permissions.filter((p) => !ALL_TENANT_PERMISSIONS.includes(p));
      if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);
      if (body.permissions.some((p) => !req.user!.permissions.has(p))) throw forbidden('Cannot grant permissions you do not hold');
    }
    const before = role.toObject();
    role.set(body);
    await role.save();
    await audit(req, { action: 'role.update', resource: 'role', resourceId: id, oldValue: before, newValue: role.toObject() });
    res.json({ success: true, data: role });
  }),
);

rolesRouter.delete(
  '/:id',
  requirePermission('admin.roles'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { Role, User } = req.tenant!.models;
    const role = await Role.findById(id);
    if (!role) throw notFound('Role not found');
    if (role.system) throw forbidden('System roles cannot be deleted');
    if (await User.exists({ roleIds: id })) throw conflict('Role is assigned to users');
    await role.deleteOne();
    await audit(req, { action: 'role.delete', resource: 'role', resourceId: id, oldValue: role.toObject() });
    res.json({ success: true });
  }),
);

permissionsRouter.get('/', (_req, res) => {
  res.json({ success: true, data: PERMISSION_GROUPS });
});
