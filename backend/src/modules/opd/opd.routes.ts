import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, oid, round2 } from '../common/helpers';
import { postCharge, voidChargeForSource } from '../billing/billingService';
import { enqueueFhirForConsultation } from '../fhir/outbox';
import { DHATerminologyService } from '../../integrations/hie/services';
import { AppError as E } from '../../utils/errors';

export const opdRouter = Router();
export const consultationsRouter = Router();
opdRouter.use(authenticateTenant);
consultationsRouter.use(authenticateTenant);

async function patientFor(req: Request, id: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}

/* ------------------------------------------------------------ Vitals / triage */
const vitalsSchema = z.object({
  visitId: z.string().optional(),
  admissionId: z.string().optional(),
  temperatureC: z.number().min(25).max(45).optional(),
  pulse: z.number().int().min(20).max(250).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  systolic: z.number().int().min(40).max(300).optional(),
  diastolic: z.number().int().min(20).max(200).optional(),
  spo2: z.number().min(40).max(100).optional(),
  weightKg: z.number().min(0.3).max(400).optional(),
  heightCm: z.number().min(20).max(250).optional(),
  muacCm: z.number().min(5).max(60).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  bloodGlucose: z.number().min(0.5).max(60).optional(),
  triageCategory: z.enum(['emergency', 'priority', 'queue']).optional(),
  notes: z.string().max(1000).optional(),
});

/** Clinical flags and a suggested triage category (the nurse's own category always wins). */
export function assessVitals(v: z.infer<typeof vitalsSchema>) {
  const flags: string[] = [];
  if (v.temperatureC !== undefined && v.temperatureC >= 38) flags.push('Fever');
  if (v.temperatureC !== undefined && v.temperatureC < 35.5) flags.push('Hypothermia');
  if (v.pulse !== undefined && v.pulse > 120) flags.push('Tachycardia');
  if (v.pulse !== undefined && v.pulse < 50) flags.push('Bradycardia');
  if (v.systolic !== undefined && v.systolic < 90) flags.push('Hypotension');
  if ((v.systolic ?? 0) >= 160 || (v.diastolic ?? 0) >= 110) flags.push('Severe hypertension');
  else if ((v.systolic ?? 0) >= 140 || (v.diastolic ?? 0) >= 90) flags.push('Hypertension');
  if (v.spo2 !== undefined && v.spo2 < 92) flags.push('Low SpO2');
  if (v.respiratoryRate !== undefined && v.respiratoryRate > 30) flags.push('Tachypnoea');
  if (v.bloodGlucose !== undefined && v.bloodGlucose < 3.5) flags.push('Hypoglycaemia');
  if (v.muacCm !== undefined && v.muacCm < 11.5) flags.push('Severe acute malnutrition (MUAC)');
  const emergency = (v.spo2 ?? 100) < 90 || (v.systolic ?? 120) < 80 || (v.respiratoryRate ?? 16) > 30 || (v.bloodGlucose ?? 5) < 3 || (v.temperatureC ?? 37) >= 40;
  const priority = flags.length > 0;
  const bmi = v.weightKg && v.heightCm ? round2(v.weightKg / (v.heightCm / 100) ** 2) : undefined;
  const suggested: 'emergency' | 'priority' | 'queue' = emergency ? 'emergency' : priority ? 'priority' : 'queue';
  return { flags, suggested, bmi };
}

opdRouter.post(
  '/vitals',
  requireAnyPermission('opd.create', 'nursing.record'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(vitalsSchema, req.body);
    const m = req.tenant!.models;
    let patientId;
    if (body.visitId) patientId = (await loadScoped(req, m.Visit, body.visitId, 'Visit')).patientId;
    else if (body.admissionId) patientId = (await loadScoped(req, m.Admission, body.admissionId, 'Admission')).patientId;
    else throw badRequest('visitId or admissionId is required');
    const a = assessVitals(body);
    const v = await m.Vitals.create({ ...body, patientId, branchId: req.branch!.id, bmi: a.bmi, flags: a.flags, triageCategory: body.triageCategory ?? a.suggested, recordedBy: req.user!.id, recordedByName: req.user!.name });
    if (body.visitId && v.triageCategory === 'emergency') {
      await m.Visit.updateOne({ _id: body.visitId }, { priority: 'emergency' });
      await m.QueueEntry.updateMany({ visitId: body.visitId, status: { $in: ['waiting', 'called'] } }, { priority: 'emergency' });
    }
    await audit(req, { action: 'vitals.record', resource: 'vitals', resourceId: String(v._id), newValue: { flags: a.flags, triage: v.triageCategory } });
    res.status(201).json({ success: true, data: v });
  }),
);

opdRouter.get(
  '/vitals',
  requireAnyPermission('opd.view', 'nursing.view', 'consultation.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.visitId) filter.visitId = (await loadScoped(req, req.tenant!.models.Visit, req.query.visitId, 'Visit'))._id;
    else if (req.query.admissionId) filter.admissionId = (await loadScoped(req, req.tenant!.models.Admission, req.query.admissionId, 'Admission'))._id;
    else if (req.query.patientId) filter.patientId = (await patientFor(req, req.query.patientId))._id;
    else throw badRequest('visitId, admissionId or patientId required');
    res.json({ success: true, data: await req.tenant!.models.Vitals.find(filter).sort({ recordedAt: -1 }).limit(100).lean() });
  }),
);

/* ------------------------------------------------------------ Procedures */
opdRouter.post(
  '/procedures',
  requireAnyPermission('consultation.create', 'nursing.record', 'dental.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ visitId: z.string().optional(), admissionId: z.string().optional(), serviceCode: z.string().max(40).optional(), name: z.string().min(2).max(160), notes: z.string().max(2000).optional(), done: z.boolean().default(false) }), req.body);
    const m = req.tenant!.models;
    const ctx = body.visitId ? await loadScoped(req, m.Visit, body.visitId, 'Visit') : body.admissionId ? await loadScoped(req, m.Admission, body.admissionId, 'Admission') : null;
    if (!ctx) throw badRequest('visitId or admissionId is required');
    const p = await m.Procedure.create({ ...body, patientId: ctx.patientId, branchId: ctx.branchId, status: body.done ? 'done' : 'ordered', performedBy: body.done ? req.user!.id : undefined, performedAt: body.done ? new Date() : undefined, orderedBy: req.user!.id });
    if (body.serviceCode) await postCharge(req, m, { patientId: ctx.patientId, visitId: body.visitId ?? (ctx as { visitId?: unknown }).visitId as string, branchId: ctx.branchId, serviceCode: body.serviceCode, source: 'procedure', sourceId: String(p._id), description: body.name });
    await audit(req, { action: 'procedure.create', resource: 'procedure', resourceId: String(p._id), newValue: { name: body.name, done: body.done } });
    res.status(201).json({ success: true, data: p });
  }),
);

opdRouter.post(
  '/procedures/:id/:action',
  requireAnyPermission('consultation.create', 'nursing.record', 'dental.manage'),
  h(async (req, res) => {
    const action = String(req.params.action);
    if (!['done', 'cancel'].includes(action)) throw notFound();
    const m = req.tenant!.models;
    const p = await loadScoped(req, m.Procedure, req.params.id, 'Procedure');
    if (p.status !== 'ordered') throw conflict(`Procedure is ${p.status}`);
    p.status = action === 'done' ? 'done' : 'cancelled';
    if (action === 'done') {
      p.performedBy = req.user!.id as never;
      p.performedAt = new Date();
    } else await voidChargeForSource(m, 'procedure', String(p._id), 'Procedure cancelled', req.user!.id);
    await p.save();
    await audit(req, { action: `procedure.${action}`, resource: 'procedure', resourceId: String(p._id) });
    res.json({ success: true, data: p });
  }),
);

/* ------------------------------------------------------------ Diagnosis search */
opdRouter.get(
  '/diagnoses/search',
  requireAnyPermission('consultation.create', 'consultation.view'),
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ success: true, data: [], source: 'none' });
    // The facility's own diagnosis catalog comes first (Admin → Diagnoses).
    const cre = new RegExp(escapeRegex(q), 'i');
    const catalog = (await req.tenant!.models.Diagnosis.find({ active: true, $or: [{ name: cre }, { code: cre }, { synonyms: cre }] }).sort({ name: 1 }).limit(15).lean()).map((d) => ({ code: d.code || undefined, display: d.name, system: d.code ? d.system : 'local', source: 'catalog' }));
    // Then the national terminology service when configured; otherwise this facility's own coded history.
    try {
      const data = await DHATerminologyService.search({ tenantId: req.tenant!.id, userId: req.user!.id, requestId: req.requestId }, { q });
      return res.json({ success: true, data: Array.isArray(data) ? [...catalog, ...data] : catalog.length ? catalog : data, source: 'dha_terminology' });
    } catch (err) {
      if (!(err instanceof E)) throw err;
    }
    const re = new RegExp(escapeRegex(q), 'i');
    const rows = await req.tenant!.models.Consultation.aggregate([
      { $match: { status: 'final' } },
      { $unwind: '$diagnoses' },
      { $match: { $or: [{ 'diagnoses.display': re }, { 'diagnoses.code': re }] } },
      { $group: { _id: { code: '$diagnoses.code', display: '$diagnoses.display', system: '$diagnoses.system' }, uses: { $sum: 1 } } },
      { $sort: { uses: -1 } },
      { $limit: 20 },
    ]);
    res.json({ success: true, data: [...catalog, ...rows.map((r) => ({ ...r._id, uses: r.uses }))], source: 'facility_history' });
  }),
);

/** Clinical summary for the consultation header. */
opdRouter.get(
  '/patients/:patientId/summary',
  requireAnyPermission('consultation.view', 'opd.view', 'nursing.view'),
  h(async (req, res) => {
    const p = await patientFor(req, req.params.patientId);
    const m = req.tenant!.models;
    const [diagnoses, meds, lastVitals, visits] = await Promise.all([
      m.Consultation.find({ patientId: p._id, status: 'final' }).select('diagnoses finalizedAt').sort({ finalizedAt: -1 }).limit(10).lean(),
      m.Prescription.find({ patientId: p._id, createdAt: { $gte: new Date(Date.now() - 90 * 86400_000) } }).select('items.drugName items.dose items.frequency createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      m.Vitals.findOne({ patientId: p._id }).sort({ recordedAt: -1 }).lean(),
      m.Visit.find({ patientId: p._id }).select('visitNumber type status createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    const dx = diagnoses.flatMap((c) => c.diagnoses.map((d) => ({ code: d.code, display: d.display, at: c.finalizedAt }))).slice(0, 15);
    res.json({ success: true, data: { allergies: p.allergies ?? [], diagnoses: dx, medications: meds.flatMap((r) => r.items.map((i) => ({ ...i, at: r.createdAt }))), lastVitals, visits } });
  }),
);

/* ------------------------------------------------------------ Consultations */
const diagnosis = z.object({ code: z.string().max(30).optional(), display: z.string().min(2).max(300), system: z.string().max(40).default('ICD-11'), type: z.enum(['primary', 'secondary', 'provisional']).default('primary') });
const noteFields = z.object({
  chiefComplaint: z.string().max(2000).optional(),
  historyOfPresentingIllness: z.string().max(8000).optional(),
  reviewOfSystems: z.string().max(4000).optional(),
  pastHistory: z.string().max(4000).optional(),
  examination: z.string().max(8000).optional(),
  assessment: z.string().max(4000).optional(),
  diagnoses: z.array(diagnosis).max(20).optional(),
  plan: z.string().max(4000).optional(),
  followUpDate: z.coerce.date().optional().nullable(),
  followUpNotes: z.string().max(1000).optional(),
});

consultationsRouter.post(
  '/',
  requirePermission('consultation.create'),
  h(async (req, res) => {
    const body = parse(noteFields.extend({ visitId: z.string() }), req.body);
    const m = req.tenant!.models;
    const visit = await loadScoped(req, m.Visit, body.visitId, 'Visit');
    if (!['open', 'in_progress', 'admitted'].includes(visit.status)) throw conflict('Visit is closed');
    const existing = await m.Consultation.findOne({ visitId: visit._id, status: 'draft', providerId: req.user!.id });
    if (existing) return res.json({ success: true, data: existing, existing: true });
    const c = await m.Consultation.create({ ...body, visitId: visit._id, patientId: visit.patientId, branchId: visit.branchId, providerId: req.user!.id, providerName: req.user!.name });
    if (visit.status === 'open') await m.Visit.updateOne({ _id: visit._id }, { status: 'in_progress', attendingProviderId: req.user!.id });
    await audit(req, { action: 'consultation.create', resource: 'consultation', resourceId: String(c._id) });
    res.status(201).json({ success: true, data: c });
  }),
);

consultationsRouter.get(
  '/',
  requirePermission('consultation.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.visitId) filter.visitId = (await loadScoped(req, req.tenant!.models.Visit, req.query.visitId, 'Visit'))._id;
    else if (req.query.patientId) filter.patientId = (await patientFor(req, req.query.patientId))._id;
    else throw badRequest('visitId or patientId required');
    res.json({ success: true, data: await req.tenant!.models.Consultation.find(filter).sort({ createdAt: -1 }).limit(50).lean() });
  }),
);

consultationsRouter.get(
  '/:id',
  requirePermission('consultation.view'),
  h(async (req, res) => {
    const c = await loadScoped(req, req.tenant!.models.Consultation, req.params.id, 'Consultation');
    await audit(req, { action: 'consultation.view', resource: 'consultation', resourceId: String(c._id) });
    res.json({ success: true, data: c });
  }),
);

/** Drafts are editable by their author (or users with consultation.edit). Finalized notes never change. */
consultationsRouter.patch(
  '/:id',
  requirePermission('consultation.create'),
  h(async (req, res) => {
    const body = parse(noteFields, req.body);
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.Consultation, req.params.id, 'Consultation');
    if (c.status === 'final') throw new AppError(409, 'CONSULTATION_FINALIZED', 'This consultation is finalized. Add an addendum instead of editing.');
    if (String(c.providerId) !== req.user!.id && !req.permissions!.has('consultation.edit')) throw forbidden('Only the author can edit this draft');
    c.set(body);
    await c.save();
    res.json({ success: true, data: c });
  }),
);

consultationsRouter.post(
  '/:id/finalize',
  requirePermission('consultation.finalize'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.Consultation, req.params.id, 'Consultation');
    if (c.status === 'final') throw conflict('Already finalized', undefined, 'CONSULTATION_FINALIZED');
    if (String(c.providerId) !== req.user!.id) throw forbidden('Only the authoring clinician can finalize this consultation');
    if (!c.chiefComplaint || !c.diagnoses?.length) throw new AppError(422, 'CONSULTATION_INCOMPLETE', 'A chief complaint and at least one diagnosis are required to finalize');
    c.status = 'final';
    c.finalizedAt = new Date();
    c.finalizedBy = req.user!.id as never;
    await c.save();
    await audit(req, { action: 'consultation.finalize', resource: 'consultation', resourceId: String(c._id), newValue: { diagnoses: c.diagnoses } });
    await enqueueFhirForConsultation(req, String(c._id)).catch(() => undefined);
    res.json({ success: true, data: c });
  }),
);

consultationsRouter.post(
  '/:id/addenda',
  requirePermission('consultation.create'),
  h(async (req, res) => {
    const body = parse(z.object({ text: z.string().min(3).max(4000), reason: z.string().min(3).max(300) }), req.body);
    const m = req.tenant!.models;
    const c = await loadScoped(req, m.Consultation, req.params.id, 'Consultation');
    if (c.status !== 'final') throw conflict('Addenda apply only to finalized consultations; edit the draft instead');
    c.addenda.push({ ...body, by: req.user!.id, byName: req.user!.name, at: new Date() } as never);
    await c.save();
    await audit(req, { action: 'consultation.addendum', resource: 'consultation', resourceId: String(c._id), newValue: body });
    res.status(201).json({ success: true, data: c });
  }),
);
