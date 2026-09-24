import { Router } from 'express';
import { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { authenticateTenant } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { integrationStatusForTenant } from '../integrations/integrationConfigService';

const router = Router();
router.use(authenticateTenant);

/** Facility dashboard. Each section is included only if the user holds the relevant permission. */
router.get(
  '/',
  h(async (req, res) => {
    const m = req.tenant!.models;
    const perms = req.permissions!;
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const since = new Date(today.getTime() - 13 * 86400_000);
    const data: Record<string, unknown> = { branch: req.branch ?? null };

    if (perms.has('patients.view') || perms.has('patients.search')) {
      const pf: Record<string, unknown> = { ...branchFilter(req, 'branchIds'), status: { $ne: 'merged' } };
      const [total, todayCount, trend, recent] = await Promise.all([
        m.Patient.countDocuments(pf),
        m.Patient.countDocuments({ ...pf, createdAt: { $gte: today } }),
        // Bucketed in code (projection only) so it also runs on MongoDB-compatible engines without $dateToString.
        m.Patient.find({ ...pf, createdAt: { $gte: since } }).select('createdAt -_id').limit(50_000).lean(),
        m.Patient.find(pf).sort({ createdAt: -1 }).limit(8).select('patientNumber firstName lastName gender createdAt sha.status clientRegistryId').lean(),
      ]);
      const buckets = new Map<string, number>();
      for (const p of trend) {
        // Africa/Nairobi is UTC+3 with no DST.
        const day = new Date(new Date(p.createdAt as Date).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
        buckets.set(day, (buckets.get(day) ?? 0) + 1);
      }
      data.patients = { total, today: todayCount, trend: [...buckets].sort().map(([date, count]) => ({ date, count })), recent };
    }

    if (perms.has('sha.view') || perms.has('sha.eligibility')) {
      const bf = branchFilter(req);
      const [elig, tx] = await Promise.all([
        m.ShaEligibilityCheck.aggregate([{ $match: { ...bf, createdAt: { $gte: today } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        m.ShaTransaction.aggregate([{ $match: { ...bf, status: { $exists: true } } }, { $group: { _id: { kind: '$kind', status: '$status' }, count: { $sum: 1 } } }]),
      ]);
      data.sha = {
        eligibilityToday: Object.fromEntries(elig.map((e) => [e._id, e.count])),
        transactions: tx.map((t) => ({ kind: t._id.kind, status: t._id.status, count: t.count })),
      };
    }

    if (perms.has('admin.users') || perms.has('admin.branches')) {
      const [users, branches] = await Promise.all([
        m.User.countDocuments(req.user!.branchAccess === 'all' ? { status: 'active' } : { status: 'active', branchIds: { $in: req.user!.branchIds.map((b) => new Types.ObjectId(b)) } }),
        m.Branch.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, beds: { $sum: '$bedCapacity' } } }]),
      ]);
      data.admin = { activeUsers: users, branches: branches.reduce((s, b) => s + b.count, 0), beds: branches.reduce((s, b) => s + (b.beds ?? 0), 0) };
      data.integrations = await integrationStatusForTenant(req.tenant!.id);
    }
    res.json({ success: true, data });
  }),
);

export default router;
