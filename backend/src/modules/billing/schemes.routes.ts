import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse, parsePatch } from '../../utils/validate';
import { conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { oid, round2 } from '../common/helpers';

/**
 * Corporate and insurance schemes: which price list their patients are charged from, the copay the
 * patient pays at the counter, and whether the scheme pays per visit (fee for service) or a fixed
 * monthly fee per member (capitation).
 */
const router = Router();
router.use(authenticateTenant);

const schemeSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-_]+$/, 'can only contain letters, numbers, - and _'),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['insurance', 'corporate']),
  payerId: z.string().optional(),
  priceList: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/, 'use lower-case letters, numbers, - and _').default('insurance'),
  coverage: z.enum(['fee_for_service', 'capitation']).default('fee_for_service'),
  copay: z.object({ type: z.enum(['none', 'fixed', 'percent']), value: z.number().min(0).max(1_000_000) }).refine((c) => c.type !== 'percent' || c.value <= 100, 'A percentage copay cannot exceed 100').default({ type: 'none', value: 0 }),
  capitationRate: z.number().min(0).max(10_000_000).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
});

router.get('/', requireAnyPermission('billing.view', 'queue.manage', 'insurance.view', 'billing.prices'), h(async (req, res) => {
  const filter = req.query.all === 'true' ? {} : { active: true };
  res.json({ success: true, data: await req.tenant!.models.PayerScheme.find(filter).sort({ name: 1 }).lean() });
}));

router.post('/', requirePermission('billing.prices'), h(async (req, res) => {
  const body = parse(schemeSchema, req.body);
  const m = req.tenant!.models;
  if (await m.PayerScheme.exists({ code: body.code.toUpperCase() })) throw conflict('A scheme with this code already exists');
  if (body.payerId && !(await m.InsurancePayer.exists({ _id: oid(body.payerId, 'Payer') }))) throw notFound('Insurer not found');
  const s = await m.PayerScheme.create({ ...body, email: body.email || undefined });
  await audit(req, { action: 'billing.scheme_create', resource: 'payer_scheme', resourceId: String(s._id), newValue: body });
  res.status(201).json({ success: true, data: s });
}));

router.patch('/:id', requirePermission('billing.prices'), h(async (req, res) => {
  const body = parsePatch(schemeSchema.omit({ code: true }).partial(), req.body);
  const m = req.tenant!.models;
  const s = await m.PayerScheme.findById(oid(req.params.id, 'Scheme'));
  if (!s) throw notFound('Scheme not found');
  const before = s.toObject();
  s.set({ ...body, ...(body.email !== undefined ? { email: body.email || undefined } : {}) });
  await s.save();
  await audit(req, { action: 'billing.scheme_update', resource: 'payer_scheme', resourceId: String(s._id), oldValue: { priceList: before.priceList, coverage: before.coverage, copay: before.copay, active: before.active }, newValue: body });
  res.json({ success: true, data: s });
}));

/**
 * Utilisation for a period: visits, patients, the value of care given, copays collected and, for
 * capitation, what was covered by the monthly fee. Helps judge whether a capitation rate is fair.
 */
router.get('/:id/utilisation', requireAnyPermission('billing.view', 'insurance.view', 'reports.view'), h(async (req, res) => {
  const m = req.tenant!.models;
  const s = await m.PayerScheme.findById(oid(req.params.id, 'Scheme')).lean();
  if (!s) throw notFound('Scheme not found');
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const invoices = await m.Invoice.find({ ...branchFilter(req), 'payer.schemeId': s._id, status: { $ne: 'void' }, createdAt: { $gte: from, $lt: to } }).select('patientId totals').lean();
  const sum = (k: 'gross' | 'net' | 'paid' | 'patientShare' | 'payerShare' | 'capitation') => round2(invoices.reduce((t, i) => t + (i.totals?.[k] ?? 0), 0));
  const patients = new Set(invoices.map((i) => String(i.patientId))).size;
  res.json({
    success: true,
    data: {
      scheme: { _id: s._id, name: s.name, code: s.code, coverage: s.coverage, capitationRate: s.capitationRate },
      month,
      visits: invoices.length,
      patients,
      valueOfCare: sum('gross'),
      copayDue: sum('patientShare'),
      collected: sum('paid'),
      claimable: sum('payerShare'),
      coveredByCapitation: sum('capitation'),
      averagePerPatient: patients ? round2(sum('gross') / patients) : 0,
    },
  });
}));

export default router;
