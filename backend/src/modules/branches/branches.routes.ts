import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { assertBranchAccess, branchFilter } from '../../middleware/branchScope';
import { branchInput, refreshTenantStats } from '../tenants/provisioning';
import { audit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { z } from 'zod';

const router = Router();
router.use(authenticateTenant);

const oid = (id: string) => {
  if (!isValidObjectId(id)) throw notFound('Branch not found');
  return id;
};

router.get(
  '/',
  h(async (req, res) => {
    const { Branch, User } = req.tenant!.models;
    const filter = req.user!.branchAccess === 'all' ? {} : { _id: { $in: req.user!.branchIds } };
    const branches = await Branch.find(filter).sort({ isMain: -1, branchName: 1 }).lean();
    const staff = await User.aggregate([{ $unwind: '$branchIds' }, { $group: { _id: '$branchIds', count: { $sum: 1 } } }]);
    res.json({ success: true, data: branches.map((b) => ({ ...b, staffCount: staff.find((s) => String(s._id) === String(b._id))?.count ?? 0 })) });
  }),
);

router.get(
  '/:id',
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    assertBranchAccess(req, id);
    const b = await req.tenant!.models.Branch.findById(id).lean();
    if (!b) throw notFound('Branch not found');
    res.json({ success: true, data: b });
  }),
);

router.post(
  '/',
  requirePermission('admin.branches'),
  h(async (req, res) => {
    if (req.user!.branchAccess !== 'all') throw forbidden('Only tenant-wide administrators can create branches');
    const body = parse(branchInput.extend({ services: z.record(z.string(), z.boolean()).optional() }), req.body);
    const { Branch } = req.tenant!.models;
    const sub = await meta().TenantSubscription.findOne({ tenantId: req.tenant!.id }).sort({ createdAt: -1 }).lean();
    if (sub && (await Branch.countDocuments({})) >= (sub.maxBranches ?? 1)) throw forbidden('Your subscription branch limit has been reached', 'SUBSCRIPTION_LIMIT');
    const code = body.branchCode.toUpperCase();
    if (await Branch.exists({ branchCode: code })) throw conflict('Branch code already exists');
    const b = await Branch.create({ ...body, email: body.email || undefined, branchCode: code, isMain: false });
    await refreshTenantStats(req.tenant!.id, req.tenant!.models);
    await audit(req, { action: 'branch.create', resource: 'branch', resourceId: String(b._id), newValue: b });
    res.status(201).json({ success: true, data: b });
  }),
);

router.patch(
  '/:id',
  requirePermission('admin.branches'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    assertBranchAccess(req, id);
    const body = parse(branchInput.partial().extend({ services: z.record(z.string(), z.boolean()).optional() }), req.body);
    const { Branch } = req.tenant!.models;
    const before = await Branch.findById(id).lean();
    if (!before) throw notFound('Branch not found');
    const update: Record<string, unknown> = { ...body };
    if (body.branchCode) update.branchCode = body.branchCode.toUpperCase();
    if (body.services) {
      delete update.services;
      for (const [k, v] of Object.entries(body.services)) update[`services.${k}`] = v;
    }
    const after = await Branch.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after', runValidators: true }).lean();
    await audit(req, { action: 'branch.update', resource: 'branch', resourceId: id, oldValue: before, newValue: after });
    res.json({ success: true, data: after });
  }),
);

for (const action of ['suspend', 'activate'] as const) {
  router.post(
    `/:id/${action}`,
    requirePermission('admin.branches'),
    h(async (req, res) => {
      const id = oid(req.params.id as string);
      if (req.user!.branchAccess !== 'all') throw forbidden('Only tenant-wide administrators can change branch status');
      const { Branch } = req.tenant!.models;
      const b = await Branch.findById(id);
      if (!b) throw notFound('Branch not found');
      if (action === 'suspend' && b.isMain) throw forbidden('The main branch cannot be suspended');
      b.status = action === 'suspend' ? 'suspended' : 'active';
      await b.save();
      await audit(req, { action: `branch.${action}`, resource: 'branch', resourceId: id, newValue: { status: b.status } });
      res.json({ success: true, data: b });
    }),
  );
}

/** Assign / unassign staff to a branch. */
router.put(
  '/:id/staff',
  requirePermission('admin.users'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    assertBranchAccess(req, id);
    const body = parse(z.object({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) }), req.body);
    const { User, Branch } = req.tenant!.models;
    if (!(await Branch.exists({ _id: id }))) throw notFound('Branch not found');
    const valid = (ids: string[]) => ids.filter(isValidObjectId);
    if (body.add.length) await User.updateMany({ _id: { $in: valid(body.add) } }, { $addToSet: { branchIds: id } });
    if (body.remove.length) await User.updateMany({ _id: { $in: valid(body.remove) } }, { $pull: { branchIds: id } });
    await audit(req, { action: 'branch.staff_assign', resource: 'branch', resourceId: id, newValue: body });
    const staff = await User.find({ branchIds: id, ...branchFilter(req, 'branchIds') }).select('name email status').lean();
    res.json({ success: true, data: staff });
  }),
);

export default router;
