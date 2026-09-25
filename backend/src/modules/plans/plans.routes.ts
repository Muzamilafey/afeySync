import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse, parsePatch } from '../../utils/validate';
import { conflict, notFound } from '../../utils/errors';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { meta } from '../../models/meta';
import { platformAudit } from '../audit/auditService';
import { CORE_MODULES, MODULE_KEYS, MODULES, clearEntitlementCache } from './planService';

/** Owner portal: the subscription plan catalogue and the modules each plan switches on. */
export const planOwnerRouter = Router();
planOwnerRouter.use(authenticatePlatform);

planOwnerRouter.get('/modules', requirePermission('owner.subscriptions'), h(async (_req, res) => {
  res.json({ success: true, data: { core: CORE_MODULES, optional: MODULE_KEYS.map((k) => ({ key: k, label: MODULES[k].label, description: MODULES[k].description })) } });
}));

planOwnerRouter.get('/', requirePermission('owner.subscriptions'), h(async (_req, res) => {
  const { SubscriptionPlan, TenantSubscription } = meta();
  const [plans, usage] = await Promise.all([
    SubscriptionPlan.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    TenantSubscription.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$plan', n: { $sum: 1 } } }]),
  ]);
  res.json({ success: true, data: plans.map((p) => ({ ...p, facilities: usage.find((u) => u._id === p.key)?.n ?? 0 })) });
}));

const money = z.number().min(0).max(100_000_000);
const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, digits or hyphens'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  prices: z.object({ monthly: money, quarterly: money, annual: money }),
  setupFee: money.default(0),
  maxBranches: z.number().int().min(1).max(1000),
  maxUsers: z.number().int().min(1).max(100_000),
  trialDays: z.number().int().min(0).max(365).default(0),
  modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).max(MODULE_KEYS.length).default([]),
  features: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  public: z.boolean().default(true),
  active: z.boolean().default(true),
  highlight: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

planOwnerRouter.post('/', requirePermission('owner.subscriptions'), h(async (req, res) => {
  const body = parse(planSchema, req.body);
  const { SubscriptionPlan } = meta();
  if (await SubscriptionPlan.exists({ key: body.key })) throw conflict('A plan with this key already exists', undefined, 'PLAN_EXISTS');
  if (body.highlight) await SubscriptionPlan.updateMany({}, { highlight: false });
  const plan = await SubscriptionPlan.create(body);
  await platformAudit(req, { action: 'plan.create', resource: 'subscription_plan', resourceId: plan.key, newValue: body });
  res.status(201).json({ success: true, data: plan });
}));

planOwnerRouter.patch('/:key', requirePermission('owner.subscriptions'), h(async (req, res) => {
  const body = parsePatch(planSchema.omit({ key: true }).partial(), req.body);
  const { SubscriptionPlan } = meta();
  const plan = await SubscriptionPlan.findOne({ key: String(req.params.key) });
  if (!plan) throw notFound('Plan not found');
  const before = plan.toObject();
  if (body.highlight) await SubscriptionPlan.updateMany({ key: { $ne: plan.key } }, { highlight: false });
  plan.set(body);
  await plan.save();
  clearEntitlementCache(); // module changes apply to every facility on this plan
  await platformAudit(req, { action: 'plan.update', resource: 'subscription_plan', resourceId: plan.key, oldValue: before, newValue: body });
  res.json({ success: true, data: plan });
}));
