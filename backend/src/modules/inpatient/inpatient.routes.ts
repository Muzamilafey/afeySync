import { Router, type Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid } from '../common/helpers';
import { postCharge } from '../billing/billingService';
import { BED_CATEGORIES } from '../../models/tenant/inpatient';
import { notifyPatientSms } from '../notifications/notify';

const router = Router();
router.use(authenticateTenant);

/* ------------------------------------------------------------ Wards & beds */
const wardSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/),
  type: z.enum(['general', 'maternity', 'pediatric', 'surgical', 'icu', 'hdu', 'newborn', 'dialysis', 'isolation']).default('general'),
  gender: z.enum(['any', 'male', 'female']).default('any'),
  bedChargeServiceCode: z.string().max(40).optional(),
  active: z.boolean().optional(),
});

router.get(
  '/wards',
  requireAnyPermission('inpatient.view', 'inpatient.manage', 'nursing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const filter: Record<string, unknown> = req.branch ? { branchId: req.branch.id } : branchFilter(req);
    const wards = await m.Ward.find({ ...filter, active: true }).sort({ name: 1 }).lean();
    const beds = await m.Bed.find({ wardId: { $in: wards.map((w) => w._id) } }).select('wardId status').lean();
    res.json({ success: true, data: wards.map((w) => { const b = beds.filter((x) => String(x.wardId) === String(w._id)); return { ...w, beds: b.length, occupied: b.filter((x) => x.status === 'occupied').length, available: b.filter((x) => x.status === 'available').length }; }) });
  }),
);

router.post(
  '/wards',
  requirePermission('inpatient.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(wardSchema, req.body);
    const m = req.tenant!.models;
    if (await m.Ward.exists({ branchId: req.branch!.id, code: body.code.toUpperCase() })) throw conflict('Ward code exists in this branch');
    const w = await m.Ward.create({ ...body, code: body.code.toUpperCase(), branchId: req.branch!.id });
    await audit(req, { action: 'inpatient.ward_create', resource: 'ward', resourceId: String(w._id), newValue: body });
    res.status(201).json({ success: true, data: w });
  }),
);

router.patch(
  '/wards/:id',
  requirePermission('inpatient.manage'),
  h(async (req, res) => {
    const body = parse(wardSchema.omit({ code: true }).partial(), req.body);
    const w = await loadScoped(req, req.tenant!.models.Ward, req.params.id, 'Ward');
    w.set(body);
    await w.save();
    await audit(req, { action: 'inpatient.ward_update', resource: 'ward', resourceId: String(w._id), newValue: body });
    res.json({ success: true, data: w });
  }),
);

router.post(
  '/wards/:id/beds',
  requirePermission('inpatient.manage'),
  h(async (req, res) => {
    const body = parse(z.object({ numbers: z.array(z.string().min(1).max(20)).min(1).max(200), category: z.enum(BED_CATEGORIES).default('normal') }), req.body);
    const m = req.tenant!.models;
    const w = await loadScoped(req, m.Ward, req.params.id, 'Ward');
    const existing = await m.Bed.find({ wardId: w._id, number: { $in: body.numbers } }).select('number').lean();
    if (existing.length) throw conflict(`Beds already exist: ${existing.map((b) => b.number).join(', ')}`);
    const beds = await m.Bed.insertMany(body.numbers.map((number) => ({ wardId: w._id, branchId: w.branchId, number, category: body.category })));
    const total = await m.Bed.countDocuments({ branchId: w.branchId });
    await m.Branch.updateOne({ _id: w.branchId }, { bedCapacity: total });
    await audit(req, { action: 'inpatient.beds_create', resource: 'ward', resourceId: String(w._id), newValue: body });
    res.status(201).json({ success: true, data: beds });
  }),
);

router.get(
  '/beds',
  requireAnyPermission('inpatient.view', 'inpatient.manage', 'nursing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const filter: Record<string, unknown> = req.branch ? { branchId: req.branch.id } : branchFilter(req);
    if (req.query.wardId) filter.wardId = oid(req.query.wardId, 'Ward');
    if (req.query.status) filter.status = String(req.query.status);
    const beds = await m.Bed.find(filter).populate('wardId', 'name code type').populate({ path: 'admissionId', select: 'admissionNumber patientId admittedAt', populate: { path: 'patientId', select: 'firstName lastName patientNumber gender' } }).sort({ number: 1 }).lean();
    res.json({ success: true, data: beds });
  }),
);

router.post(
  '/beds/:id/status',
  requireAnyPermission('inpatient.manage', 'nursing.record'),
  h(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['available', 'cleaning', 'maintenance']) }), req.body);
    const m = req.tenant!.models;
    const bed = await loadScoped(req, m.Bed, req.params.id, 'Bed');
    if (bed.status === 'occupied') throw conflict('Bed is occupied');
    if (status === 'maintenance' && !req.permissions!.has('inpatient.manage')) throw forbidden();
    bed.status = status;
    await bed.save();
    await audit(req, { action: 'inpatient.bed_status', resource: 'bed', resourceId: String(bed._id), newValue: { status } });
    res.json({ success: true, data: bed });
  }),
);

/** Occupancy by ward and by SHA/DHA bed category (used for facility status and reporting). */
router.get(
  '/occupancy',
  requireAnyPermission('inpatient.view', 'reports.view', 'sha.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const filter: Record<string, unknown> = req.branch && req.query.all !== 'true' ? { branchId: req.branch.id } : branchFilter(req);
    const beds = await m.Bed.find(filter).populate('wardId', 'name').lean();
    const group = (key: (b: (typeof beds)[number]) => string) => {
      const out: Record<string, { total: number; occupied: number; available: number }> = {};
      for (const b of beds) {
        const k = key(b);
        out[k] ??= { total: 0, occupied: 0, available: 0 };
        out[k].total += 1;
        if (b.status === 'occupied') out[k].occupied += 1;
        if (b.status === 'available') out[k].available += 1;
      }
      return out;
    };
    const total = beds.length;
    const occupied = beds.filter((b) => b.status === 'occupied').length;
    res.json({ success: true, data: { total, occupied, occupancyRate: total ? Math.round((occupied / total) * 1000) / 10 : 0, byWard: group((b) => (b.wardId as unknown as { name: string })?.name ?? 'Unknown'), byCategory: group((b) => b.category) } });
  }),
);

/* ------------------------------------------------------------ Admissions */
async function occupyBed(req: Request, bedId: string, admissionId: Types.ObjectId) {
  const m = req.tenant!.models;
  const bed = await loadScoped(req, m.Bed, bedId, 'Bed');
  const r = await m.Bed.updateOne({ _id: bed._id, status: 'available' }, { status: 'occupied', admissionId });
  if (r.modifiedCount !== 1) throw new AppError(409, 'BED_UNAVAILABLE', 'This bed is no longer available');
  return bed;
}

router.post(
  '/admissions',
  requirePermission('inpatient.admit'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string(),
        visitId: z.string().optional(),
        bedId: z.string(),
        admissionDiagnosis: z.string().min(2).max(500),
        admissionType: z.enum(['elective', 'emergency', 'maternity', 'transfer_in']).default('emergency'),
        payer: z.object({ type: z.enum(['cash', 'sha', 'insurance', 'corporate']), scheme: z.string().max(80).optional() }).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const patient = await m.Patient.findById(oid(body.patientId, 'Patient')).lean();
    if (!patient || !canAccessAnyBranch(req, patient.branchIds ?? [])) throw notFound('Patient not found');
    if (await m.Admission.exists({ patientId: patient._id, status: 'admitted' })) throw conflict('Patient is already admitted', undefined, 'ALREADY_ADMITTED');
    let visit = body.visitId ? await loadScoped(req, m.Visit, body.visitId, 'Visit') : null;
    if (!visit) {
      visit = await m.Visit.create({ visitNumber: await nextNumber(m, 'visit', 'V'), patientId: patient._id, branchId: req.branch!.id, type: 'inpatient', status: 'admitted', payer: body.payer ?? { type: 'cash' }, createdBy: req.user!.id });
    }
    const bedDoc = await m.Bed.findById(oid(body.bedId, 'Bed')).lean();
    if (!bedDoc) throw notFound('Bed not found');
    const admission = new m.Admission({
      admissionNumber: await nextNumber(m, 'admission', 'IP'),
      visitId: visit._id,
      patientId: patient._id,
      branchId: bedDoc.branchId,
      wardId: bedDoc.wardId,
      bedId: bedDoc._id,
      admittingDoctorId: req.user!.id,
      admittingDoctorName: req.user!.name,
      admissionDiagnosis: body.admissionDiagnosis,
      admissionType: body.admissionType,
    });
    await occupyBed(req, body.bedId, admission._id);
    try {
      await admission.save();
    } catch (err) {
      await m.Bed.updateOne({ _id: bedDoc._id }, { status: 'available', admissionId: null });
      throw err;
    }
    await m.Visit.updateOne({ _id: visit._id }, { status: 'admitted' });
    await m.QueueEntry.updateMany({ visitId: visit._id, status: { $in: ['waiting', 'called'] } }, { status: 'cancelled' });
    await audit(req, { action: 'inpatient.admit', resource: 'admission', resourceId: String(admission._id), newValue: { admissionNumber: admission.admissionNumber, bed: bedDoc.number } });
    res.status(201).json({ success: true, data: admission });
  }),
);

router.get(
  '/admissions',
  requireAnyPermission('inpatient.view', 'nursing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req), status: String(req.query.status ?? 'admitted') };
    if (req.query.wardId) filter.wardId = oid(req.query.wardId, 'Ward');
    if (req.query.patientId) {
      filter.patientId = oid(req.query.patientId, 'Patient');
      if (!req.query.status) delete filter.status;
    }
    const [items, total] = await Promise.all([
      m.Admission.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth allergies').populate('wardId', 'name').populate('bedId', 'number').sort({ admittedAt: -1 }).skip(skip).limit(limit).lean(),
      m.Admission.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/admissions/:id',
  requireAnyPermission('inpatient.view', 'nursing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    const [patient, ward, bed, notes, vitals, mar, fluids, labOrders, prescriptions, radiology] = await Promise.all([
      m.Patient.findById(a.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth allergies clientRegistryId sha phone').lean(),
      m.Ward.findById(a.wardId).lean(),
      m.Bed.findById(a.bedId).lean(),
      m.ClinicalNote.find({ admissionId: a._id }).sort({ createdAt: -1 }).limit(200).lean(),
      m.Vitals.find({ admissionId: a._id }).sort({ recordedAt: -1 }).limit(100).lean(),
      m.MedicationAdministration.find({ admissionId: a._id }).sort({ givenAt: -1 }).limit(200).lean(),
      m.FluidEntry.find({ admissionId: a._id }).sort({ at: -1 }).limit(200).lean(),
      m.LabOrder.find({ admissionId: a._id }).sort({ createdAt: -1 }).lean(),
      m.Prescription.find({ admissionId: a._id }).sort({ createdAt: -1 }).lean(),
      m.RadiologyRequest.find({ admissionId: a._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const since = Date.now() - 24 * 3600_000;
    const last24 = fluids.filter((f) => new Date(f.at).getTime() >= since);
    const intake = last24.filter((f) => f.direction === 'intake').reduce((s, f) => s + f.volumeMl, 0);
    const output = last24.filter((f) => f.direction === 'output').reduce((s, f) => s + f.volumeMl, 0);
    await audit(req, { action: 'inpatient.view', resource: 'admission', resourceId: String(a._id) });
    res.json({ success: true, data: { admission: a, patient, ward, bed, notes, vitals, mar, fluids, fluidBalance24h: { intake, output, net: intake - output }, labOrders, prescriptions, radiology, lengthOfStayDays: Math.max(1, Math.ceil((Date.now() - a.admittedAt.getTime()) / 86400_000)) } });
  }),
);

router.post(
  '/admissions/:id/transfer',
  requirePermission('inpatient.transfer'),
  h(async (req, res) => {
    const body = parse(z.object({ toBedId: z.string(), reason: z.string().min(3).max(300) }), req.body);
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    if (String(a.bedId) === body.toBedId) throw badRequest('Patient is already in this bed');
    const to = await occupyBed(req, body.toBedId, a._id);
    await m.Bed.updateOne({ _id: a.bedId }, { status: 'cleaning', admissionId: null });
    a.transfers.push({ fromWardId: a.wardId, fromBedId: a.bedId, toWardId: to.wardId, toBedId: to._id, at: new Date(), by: req.user!.id, reason: body.reason } as never);
    a.wardId = to.wardId;
    a.bedId = to._id;
    await a.save();
    await audit(req, { action: 'inpatient.transfer', resource: 'admission', resourceId: String(a._id), newValue: { toBed: to.number, reason: body.reason } });
    res.json({ success: true, data: a });
  }),
);

router.post(
  '/admissions/:id/discharge',
  requirePermission('inpatient.discharge'),
  h(async (req, res) => {
    const body = parse(
      z.object({
        outcome: z.enum(['recovered', 'improved', 'referred', 'against_advice', 'absconded', 'deceased']),
        summary: z.string().min(10).max(10000),
        finalDiagnosis: z.string().min(2).max(500),
        dischargeMedications: z.string().max(2000).optional(),
        followUp: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    const days = Math.max(1, Math.ceil((Date.now() - a.admittedAt.getTime()) / 86400_000));
    const ward = await m.Ward.findById(a.wardId).lean();
    // Bed-day charges are posted once at discharge for the whole stay (idempotent per admission).
    await postCharge(req, m, { patientId: a.patientId, visitId: a.visitId, branchId: a.branchId, serviceCode: ward?.bedChargeServiceCode ?? 'BED-DAY', quantity: days, description: `Bed days — ${ward?.name ?? 'ward'}`, source: 'bed', sourceId: String(a._id) });
    a.status = body.outcome === 'deceased' ? 'deceased' : body.outcome === 'absconded' ? 'absconded' : body.outcome === 'referred' ? 'referred' : 'discharged';
    a.discharge = { ...body, at: new Date(), by: req.user!.id, byName: req.user!.name } as never;
    a.bedDaysCharged = days;
    await a.save();
    await m.Bed.updateOne({ _id: a.bedId }, { status: 'cleaning', admissionId: null });
    if (a.visitId) await m.Visit.updateOne({ _id: a.visitId }, { status: 'closed', closedAt: new Date() });
    if (body.outcome === 'deceased') await m.Patient.updateOne({ _id: a.patientId }, { status: 'deceased', deceasedAt: new Date() });
    const patient = await m.Patient.findById(a.patientId).select('phone consent').lean();
    if (patient && body.outcome !== 'deceased') await notifyPatientSms(req.tenant!, patient, `discharge:${a._id}`, `You have been discharged (${a.admissionNumber}). ${body.followUp ? `Follow-up: ${body.followUp}. ` : ''}Get well soon.`);
    await audit(req, { action: 'inpatient.discharge', resource: 'admission', resourceId: String(a._id), newValue: { outcome: body.outcome, days } });
    res.json({ success: true, data: a });
  }),
);

/* ------------------------------------------------------------ Nursing & ward rounds */
router.post(
  '/admissions/:id/notes',
  requireAnyPermission('nursing.record', 'consultation.create'),
  h(async (req, res) => {
    const body = parse(z.object({ kind: z.enum(['nursing', 'doctor_round', 'progress', 'handover']), text: z.string().min(2).max(8000) }), req.body);
    if (['doctor_round', 'progress'].includes(body.kind) && !req.permissions!.has('consultation.create')) throw forbidden('Only clinicians can write ward rounds and progress notes');
    if (['nursing', 'handover'].includes(body.kind) && !req.permissions!.has('nursing.record')) throw forbidden('Only nursing staff can write nursing notes');
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    const n = await m.ClinicalNote.create({ ...body, admissionId: a._id, patientId: a.patientId, branchId: a.branchId, by: req.user!.id, byName: req.user!.name });
    await audit(req, { action: `inpatient.note_${body.kind}`, resource: 'admission', resourceId: String(a._id) });
    res.status(201).json({ success: true, data: n });
  }),
);

router.post(
  '/admissions/:id/mar',
  requirePermission('nursing.record'),
  h(async (req, res) => {
    const body = parse(z.object({ prescriptionId: z.string().optional(), drugName: z.string().min(2).max(160), dose: z.string().max(60).optional(), route: z.string().max(40).optional(), scheduledAt: z.coerce.date().optional(), status: z.enum(['given', 'held', 'refused', 'missed']), notes: z.string().max(500).optional() }), req.body);
    if (body.status !== 'given' && !body.notes) throw badRequest('A note is required when a dose is not given');
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    const e = await m.MedicationAdministration.create({ ...body, admissionId: a._id, patientId: a.patientId, branchId: a.branchId, by: req.user!.id, byName: req.user!.name });
    await audit(req, { action: 'inpatient.mar', resource: 'admission', resourceId: String(a._id), newValue: { drug: body.drugName, status: body.status } });
    res.status(201).json({ success: true, data: e });
  }),
);

router.post(
  '/admissions/:id/fluids',
  requirePermission('nursing.record'),
  h(async (req, res) => {
    const body = parse(z.object({ direction: z.enum(['intake', 'output']), route: z.string().min(2).max(40), volumeMl: z.number().positive().max(20000), at: z.coerce.date().optional() }), req.body);
    const m = req.tenant!.models;
    const a = await loadScoped(req, m.Admission, req.params.id, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    const f = await m.FluidEntry.create({ ...body, admissionId: a._id, branchId: a.branchId, by: req.user!.id });
    res.status(201).json({ success: true, data: f });
  }),
);

export default router;
