import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid } from '../common/helpers';
import { postCharge } from '../billing/billingService';
import { nextPatientNumber } from '../patients/patientService';

const router = Router();
router.use(authenticateTenant);

const kin = z.object({ name: z.string().min(2).max(120), relationship: z.string().max(40), phone: z.string().max(20).optional(), idNumber: z.string().max(30).optional() });

router.post(
  '/cases',
  requirePermission('mortuary.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string().optional(),
        deceased: z.object({ name: z.string().min(2).max(160), sex: z.enum(['male', 'female', 'unknown']).optional(), age: z.string().max(20).optional(), idType: z.string().max(40).optional(), idNumber: z.string().max(40).optional() }).optional(),
        dateOfDeath: z.coerce.date().max(new Date(Date.now() + 60_000)),
        placeOfDeath: z.enum(['in_facility', 'brought_in_dead', 'other']).default('in_facility'),
        causeOfDeath: z.string().max(500).optional(),
        certifiedBy: z.string().max(120).optional(),
        broughtBy: z.object({ name: z.string().max(120), phone: z.string().max(20).optional(), relationship: z.string().max(40).optional() }).optional(),
        policeCase: z.object({ obNumber: z.string().max(40), station: z.string().max(80) }).optional(),
        storage: z.object({ chamber: z.string().max(20), tray: z.string().max(20) }).optional(),
        nextOfKin: z.array(kin).max(5).default([]),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    let deceased = body.deceased;
    if (body.patientId) {
      const p = await m.Patient.findById(oid(body.patientId, 'Patient'));
      if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
      if (await m.MortuaryCase.exists({ patientId: p._id, status: { $ne: 'released' } })) throw conflict('A mortuary case already exists for this patient');
      deceased = { name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '), sex: p.gender as 'male', age: p.dateOfBirth ? String(Math.floor((body.dateOfDeath.getTime() - p.dateOfBirth.getTime()) / (365.25 * 86400_000))) : undefined, idType: p.nationalId ? 'National ID' : undefined, idNumber: p.nationalId ?? undefined };
      p.status = 'deceased';
      p.deceasedAt = body.dateOfDeath;
      await p.save();
    }
    if (!deceased) throw badRequest('Deceased details or patientId are required');
    if (body.storage && (await m.MortuaryCase.exists({ 'storage.chamber': body.storage.chamber, 'storage.tray': body.storage.tray, status: { $ne: 'released' }, branchId: req.branch!.id }))) throw conflict('That storage position is occupied', undefined, 'STORAGE_OCCUPIED');
    const c = await m.MortuaryCase.create({ ...body, deceased, branchId: req.branch!.id, mortuaryNumber: await nextNumber(m, 'mortuary', 'MRT'), createdBy: req.user!.id });
    await audit(req, { action: 'mortuary.admit', resource: 'mortuary_case', resourceId: String(c._id), newValue: { name: deceased.name, placeOfDeath: body.placeOfDeath } });
    res.status(201).json({ success: true, data: c });
  }),
);

router.get(
  '/cases',
  requirePermission('mortuary.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    const [items, total] = await Promise.all([m.MortuaryCase.find(filter).sort({ admittedAt: -1 }).skip(skip).limit(limit).lean(), m.MortuaryCase.countDocuments(filter)]);
    res.json({ success: true, data: items.map((c) => ({ ...c, storageDays: Math.max(1, Math.ceil(((c.releasedAt ?? new Date()).getTime() - new Date(c.admittedAt).getTime()) / 86400_000)) })), meta: { page, limit, total } });
  }),
);

router.get(
  '/cases/:id',
  requirePermission('mortuary.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.MortuaryCase, req.params.id, 'Mortuary case');
    const invoice = await m.Invoice.findOne({ 'lines.source': 'mortuary', 'lines.sourceId': { $regex: `^${c._id}` } }).select('invoiceNumber status totals').lean();
    res.json({ success: true, data: { ...c.toObject(), invoice } });
  }),
);

router.patch(
  '/cases/:id',
  requirePermission('mortuary.manage'),
  h(async (req, res) => {
    const body = parse(z.object({ causeOfDeath: z.string().max(500).optional(), certifiedBy: z.string().max(120).optional(), storage: z.object({ chamber: z.string().max(20), tray: z.string().max(20) }).optional(), nextOfKin: z.array(kin).max(5).optional() }), req.body);
    const c = await loadScoped(req, req.tenant!.models.MortuaryCase, req.params.id, 'Mortuary case');
    if (c.status === 'released') throw conflict('Case is closed');
    const before = c.toObject();
    c.set(body);
    await c.save();
    await audit(req, { action: 'mortuary.update', resource: 'mortuary_case', resourceId: String(c._id), oldValue: before, newValue: body });
    res.json({ success: true, data: c });
  }),
);

/**
 * Release authorization: posts storage charges for the full stay, then requires the bill to be settled
 * (or waived) before authorizing. Authorization and physical release are separate, audited steps.
 */
router.post(
  '/cases/:id/authorize-release',
  requirePermission('mortuary.release'),
  h(async (req, res) => {
    const body = parse(z.object({ releaseTo: z.string().min(2).max(160), releaseToIdNumber: z.string().min(4).max(30), burialPermitNumber: z.string().min(2).max(40) }), req.body);
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.MortuaryCase, req.params.id, 'Mortuary case');
    if (c.status !== 'admitted') throw conflict(`Case is ${c.status}`);
    const days = Math.max(1, Math.ceil((Date.now() - c.admittedAt.getTime()) / 86400_000));
    const patientId = c.patientId ?? (await ensureDeceasedPatient(req, c));
    const { invoice } = await postCharge(req, m, { patientId, branchId: c.branchId, serviceCode: 'MORT-STORAGE', quantity: days, description: `Mortuary storage (${days} day${days > 1 ? 's' : ''})`, source: 'mortuary', sourceId: `${c._id}:storage` });
    if ((invoice.totals?.balance ?? 0) > 0) throw new AppError(422, 'MORTUARY_BILL_OUTSTANDING', `Mortuary bill ${invoice.invoiceNumber} has an outstanding balance of KES ${invoice.totals?.balance}. Settle or waive it before release.`, { invoiceId: invoice._id, balance: invoice.totals?.balance });
    c.releaseAuthorization = { ...body, by: req.user!.id, byName: req.user!.name, at: new Date(), invoiceCleared: true } as never;
    c.storageDaysCharged = days;
    c.status = 'release_authorized';
    await c.save();
    await audit(req, { action: 'mortuary.release_authorize', resource: 'mortuary_case', resourceId: String(c._id), newValue: body });
    res.json({ success: true, data: c });
  }),
);

router.post(
  '/cases/:id/release',
  requirePermission('mortuary.manage'),
  h(async (req, res) => {
    const { releaseToIdNumber } = parse(z.object({ releaseToIdNumber: z.string().min(4).max(30) }), req.body);
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.MortuaryCase, req.params.id, 'Mortuary case');
    if (c.status !== 'release_authorized') throw conflict('Release has not been authorized');
    if (c.releaseAuthorization?.releaseToIdNumber !== releaseToIdNumber) throw new AppError(422, 'ID_MISMATCH', 'The collecting person’s ID does not match the release authorization');
    c.status = 'released';
    c.releasedAt = new Date();
    c.releasedBy = req.user!.id as never;
    await c.save();
    await audit(req, { action: 'mortuary.release', resource: 'mortuary_case', resourceId: String(c._id), newValue: { releaseTo: c.releaseAuthorization?.releaseTo } });
    res.json({ success: true, data: c });
  }),
);

/** Brought-in-dead cases without a patient record get a minimal (deceased) record so billing can attach. */
async function ensureDeceasedPatient(req: Parameters<typeof loadScoped>[0], c: { _id: unknown; deceased?: { name?: string | null; sex?: string | null } | null; branchId: unknown; dateOfDeath: Date; patientId?: unknown; save: () => Promise<unknown> }) {
  const m = req.tenant!.models;
  const names = (c.deceased?.name ?? 'Unknown').split(/\s+/);
  const p = await m.Patient.create({ patientNumber: await nextPatientNumber(m), firstName: names[0], lastName: names.slice(1).join(' ') || '-', gender: (c.deceased?.sex ?? 'unknown') as 'male', status: 'deceased', deceasedAt: c.dateOfDeath, registeredBranchId: c.branchId as never, branchIds: [c.branchId as never], createdBy: req.user!.id });
  c.patientId = p._id;
  await c.save();
  return p._id;
}

export default router;
