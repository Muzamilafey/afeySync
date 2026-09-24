import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, oid } from '../common/helpers';
import { postCharge } from '../billing/billingService';

const router = Router();
router.use(authenticateTenant);

/** FDI two-digit notation: permanent 11–48, primary 51–85. */
const FDI = /^([1-4][1-8]|[5-8][1-5])$/;
const STATUSES = ['sound', 'caries', 'filled', 'missing', 'crown', 'root_canal', 'extracted', 'fractured', 'implant', 'bridge', 'impacted'] as const;

async function patientFor(req: Request, id: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}

router.get(
  '/patients/:id/chart',
  requirePermission('dental.view'),
  h(async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const m = req.tenant!.models;
    const [chart, visits] = await Promise.all([m.DentalChart.findOne({ patientId: p._id }).lean(), m.DentalVisit.find({ patientId: p._id }).sort({ createdAt: -1 }).limit(50).lean()]);
    res.json({ success: true, data: { teeth: chart?.teeth ?? {}, visits } });
  }),
);

router.put(
  '/patients/:id/chart',
  requirePermission('dental.manage'),
  h(async (req, res) => {
    const body = parse(z.object({ teeth: z.record(z.string().regex(FDI, 'Invalid FDI tooth number'), z.object({ status: z.enum(STATUSES), surfaces: z.array(z.enum(['M', 'O', 'D', 'B', 'L', 'I', 'P'])).max(5).default([]), notes: z.string().max(300).optional() })) }), req.body);
    const p = await patientFor(req, req.params.id);
    const m = req.tenant!.models;
    const chart = (await m.DentalChart.findOne({ patientId: p._id })) ?? new m.DentalChart({ patientId: p._id });
    const before = Object.fromEntries((chart.teeth as unknown as Map<string, unknown>)?.entries?.() ?? []);
    for (const [tooth, v] of Object.entries(body.teeth)) (chart.teeth as unknown as Map<string, unknown>).set(tooth, { ...v, updatedAt: new Date() });
    chart.updatedBy = req.user!.id as never;
    await chart.save();
    await audit(req, { action: 'dental.chart_update', resource: 'patient', resourceId: String(p._id), oldValue: before, newValue: body.teeth });
    res.json({ success: true, data: chart });
  }),
);

router.post(
  '/visits',
  requirePermission('dental.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientId: z.string(), visitId: z.string().optional(), examination: z.string().max(4000).optional(), diagnosis: z.string().max(1000).optional(), treatmentPlan: z.array(z.object({ tooth: z.string().regex(FDI).optional(), procedure: z.string().min(2).max(160), serviceCode: z.string().max(40).optional() })).max(40).default([]), notes: z.string().max(2000).optional() }), req.body);
    const p = await patientFor(req, body.patientId);
    if (body.visitId) await loadScoped(req, req.tenant!.models.Visit, body.visitId, 'Visit');
    const v = await req.tenant!.models.DentalVisit.create({ ...body, patientId: p._id, branchId: req.branch!.id, dentistId: req.user!.id, dentistName: req.user!.name });
    await audit(req, { action: 'dental.visit', resource: 'dental_visit', resourceId: String(v._id), newValue: { plan: body.treatmentPlan.length } });
    res.status(201).json({ success: true, data: v });
  }),
);

/** Mark a planned treatment as done: bills it and updates the tooth chart where relevant. */
router.post(
  '/visits/:id/plan/:itemId/:action',
  requirePermission('dental.manage'),
  h(async (req, res) => {
    const action = String(req.params.action);
    if (!['done', 'cancel'].includes(action)) throw notFound();
    const m = req.tenant!.models;
    const v = await loadScoped(req, m.DentalVisit, req.params.id, 'Dental visit');
    const item = v.treatmentPlan.id(oid(req.params.itemId, 'Plan item'));
    if (!item) throw notFound('Plan item not found');
    if (item.status !== 'planned') throw conflict(`Treatment is ${item.status}`);
    if (action === 'done') {
      item.status = 'done';
      item.doneAt = new Date();
      if (item.serviceCode) await postCharge(req, m, { patientId: v.patientId, visitId: v.visitId, branchId: v.branchId, serviceCode: item.serviceCode, description: `Dental: ${item.procedure}${item.tooth ? ` (tooth ${item.tooth})` : ''}`, source: 'dental', sourceId: String(item._id) });
      const proc = item.procedure ?? '';
      const mapped = /extract/i.test(proc) ? 'extracted' : /fill|restor/i.test(proc) ? 'filled' : /root canal|rct|endodont/i.test(proc) ? 'root_canal' : /crown/i.test(proc) ? 'crown' : undefined;
      if (item.tooth && mapped) {
        const chart = (await m.DentalChart.findOne({ patientId: v.patientId })) ?? new m.DentalChart({ patientId: v.patientId });
        (chart.teeth as unknown as Map<string, unknown>).set(item.tooth, { status: mapped, surfaces: [], notes: item.procedure, updatedAt: new Date() });
        await chart.save();
      }
    } else item.status = 'cancelled';
    await v.save();
    await audit(req, { action: `dental.treatment_${action}`, resource: 'dental_visit', resourceId: String(v._id), newValue: { procedure: item.procedure, tooth: item.tooth } });
    res.json({ success: true, data: v });
  }),
);

export default router;
export { badRequest };
