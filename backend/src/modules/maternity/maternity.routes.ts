import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid } from '../common/helpers';
import { nextPatientNumber } from '../patients/patientService';
import { ancFlags, assessRisk, DAY, eddFromLmp, FP_RETURN_DAYS, gestation, immunizationStatus, muacStatus, nextDueFor, partographAlerts } from './obstetrics';
import { notifyPatientSms } from '../notifications/notify';

export const maternityRouter = Router();
export const mchRouter = Router();
export const fpRouter = Router();
for (const r of [maternityRouter, mchRouter, fpRouter]) r.use(authenticateTenant);

async function patientFor(req: Request, id: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient'));
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}
const ageYears = (dob?: Date | null) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * DAY)) : undefined);

/* ------------------------------------------------------------ Pregnancies / ANC */
const histSchema = z.object({ year: z.number().int().min(1950).max(2100).optional(), outcome: z.string().max(60).optional(), mode: z.string().max(40).optional(), gestationWeeks: z.number().min(4).max(45).optional(), birthWeightKg: z.number().min(0.2).max(7).optional(), complications: z.string().max(200).optional() });

maternityRouter.post(
  '/pregnancies',
  requirePermission('maternity.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string(),
        lmp: z.coerce.date().max(new Date()).optional(),
        eddByUltrasound: z.coerce.date().optional(),
        gravida: z.number().int().min(1).max(25),
        para: z.number().int().min(0).max(25),
        abortions: z.number().int().min(0).max(25).default(0),
        livingChildren: z.number().int().min(0).max(25).default(0),
        obstetricHistory: z.array(histSchema).max(20).default([]),
        riskFactors: z.array(z.string().max(80)).max(20).default([]),
        bloodGroup: z.string().max(10).optional(),
        hivStatus: z.string().max(30).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const p = await patientFor(req, body.patientId);
    if (p.gender !== 'female') throw badRequest('Pregnancy records apply to female patients');
    if (await m.Pregnancy.exists({ patientId: p._id, status: { $in: ['active', 'in_labour'] } })) throw conflict('Patient already has an active pregnancy', undefined, 'PREGNANCY_ACTIVE');
    if (body.para >= body.gravida) throw badRequest('Para must be less than gravida for a current pregnancy');
    const risk = assessRisk({ ageYears: ageYears(p.dateOfBirth), gravida: body.gravida, para: body.para, riskFactors: body.riskFactors, obstetricHistory: body.obstetricHistory });
    const preg = await m.Pregnancy.create({ ...body, patientId: p._id, branchId: req.branch!.id, ancNumber: await nextNumber(m, 'anc', 'ANC'), edd: body.eddByUltrasound ?? (body.lmp ? eddFromLmp(body.lmp) : undefined), riskFactors: risk.reasons, riskLevel: risk.riskLevel, createdBy: req.user!.id });
    await audit(req, { action: 'maternity.pregnancy_create', resource: 'pregnancy', resourceId: String(preg._id), newValue: { riskLevel: risk.riskLevel } });
    res.status(201).json({ success: true, data: { ...preg.toObject(), gestation: gestation(preg.lmp) } });
  }),
);

maternityRouter.get(
  '/pregnancies',
  requireAnyPermission('maternity.view', 'mch.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.patientId) filter.patientId = (await patientFor(req, req.query.patientId))._id;
    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    if (req.query.riskLevel) filter.riskLevel = String(req.query.riskLevel);
    const [items, total] = await Promise.all([m.Pregnancy.find(filter).populate('patientId', 'patientNumber firstName lastName dateOfBirth phone').sort({ edd: 1 }).skip(skip).limit(limit).lean(), m.Pregnancy.countDocuments(filter)]);
    res.json({ success: true, data: items.map((p) => ({ ...p, gestation: gestation(p.lmp) })), meta: { page, limit, total } });
  }),
);

maternityRouter.get(
  '/pregnancies/:id',
  requireAnyPermission('maternity.view', 'mch.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const preg = await loadScoped(req, m.Pregnancy, req.params.id, 'Pregnancy');
    const [patient, anc, labour, delivery, pnc] = await Promise.all([
      m.Patient.findById(preg.patientId).select('patientNumber firstName middleName lastName dateOfBirth phone allergies').lean(),
      m.AncVisit.find({ pregnancyId: preg._id }).sort({ createdAt: 1 }).lean(),
      m.Labour.findOne({ pregnancyId: preg._id }).sort({ createdAt: -1 }).lean(),
      m.Delivery.findOne({ pregnancyId: preg._id }).lean(),
      m.PncVisit.find({ motherId: preg.patientId, createdAt: { $gte: preg.createdAt } }).sort({ createdAt: 1 }).lean(),
    ]);
    res.json({ success: true, data: { pregnancy: { ...preg.toObject(), gestation: gestation(preg.lmp) }, patient, anc, labour, delivery, pnc } });
  }),
);

maternityRouter.post(
  '/pregnancies/:id/anc',
  requirePermission('maternity.manage'),
  h(async (req, res) => {
    const body = parse(
      z.object({
        visitId: z.string().optional(),
        weightKg: z.number().min(25).max(250).optional(),
        systolic: z.number().int().min(60).max(260).optional(),
        diastolic: z.number().int().min(30).max(180).optional(),
        fundalHeightCm: z.number().min(5).max(50).optional(),
        fetalHeartRate: z.number().int().min(60).max(220).optional(),
        presentation: z.string().max(40).optional(),
        fetalMovement: z.string().max(40).optional(),
        haemoglobin: z.number().min(2).max(22).optional(),
        urineProtein: z.string().max(20).optional(),
        interventions: z.array(z.string().max(80)).max(20).default([]),
        notes: z.string().max(2000).optional(),
        nextVisit: z.coerce.date().optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const preg = await loadScoped(req, m.Pregnancy, req.params.id, 'Pregnancy');
    if (preg.status !== 'active') throw conflict('Pregnancy is not active');
    const ga = gestation(preg.lmp);
    const contactNumber = (await m.AncVisit.countDocuments({ pregnancyId: preg._id })) + 1;
    const flags = ancFlags({ ...body, gestationWeeks: ga?.weeks });
    const v = await m.AncVisit.create({ ...body, pregnancyId: preg._id, patientId: preg.patientId, branchId: preg.branchId, gestationWeeks: ga?.weeks, contactNumber, by: req.user!.id, byName: req.user!.name, notes: [body.notes, flags.length ? `FLAGS: ${flags.join('; ')}` : ''].filter(Boolean).join('\n') || undefined });
    if (flags.some((f) => /pre-eclampsia|severe anaemia/i.test(f)) && preg.riskLevel !== 'high') {
      preg.riskLevel = 'high';
      preg.riskFactors = [...new Set([...(preg.riskFactors ?? []), ...flags])];
      await preg.save();
    }
    if (body.nextVisit) {
      const patient = await m.Patient.findById(preg.patientId).select('phone consent').lean();
      if (patient) await notifyPatientSms(req.tenant!, patient, `anc:${v._id}`, `Your next ANC visit is on ${body.nextVisit.toISOString().slice(0, 10)}.`);
    }
    await audit(req, { action: 'maternity.anc_visit', resource: 'pregnancy', resourceId: String(preg._id), newValue: { contactNumber, flags } });
    res.status(201).json({ success: true, data: { ...v.toObject(), flags } });
  }),
);

/* ------------------------------------------------------------ Labour & partograph */
maternityRouter.post(
  '/pregnancies/:id/labour',
  requirePermission('maternity.manage'),
  h(async (req, res) => {
    const body = parse(z.object({ admissionId: z.string().optional(), membranesRupturedAt: z.coerce.date().optional() }), req.body ?? {});
    const m = req.tenant!.models;
    const preg = await loadScoped(req, m.Pregnancy, req.params.id, 'Pregnancy');
    if (preg.status !== 'active') throw conflict('Pregnancy is not active');
    const l = await m.Labour.create({ pregnancyId: preg._id, patientId: preg.patientId, branchId: preg.branchId, admissionId: body.admissionId, membranesRupturedAt: body.membranesRupturedAt });
    preg.status = 'in_labour';
    await preg.save();
    await audit(req, { action: 'maternity.labour_start', resource: 'pregnancy', resourceId: String(preg._id) });
    res.status(201).json({ success: true, data: l });
  }),
);

maternityRouter.post(
  '/labour/:id/partograph',
  requirePermission('maternity.manage'),
  h(async (req, res) => {
    const body = parse(
      z.object({
        at: z.coerce.date().default(() => new Date()),
        cervicalDilationCm: z.number().min(0).max(10).optional(),
        descentFifths: z.number().int().min(0).max(5).optional(),
        contractionsPer10: z.number().int().min(0).max(10).optional(),
        contractionDurationSec: z.number().int().min(0).max(180).optional(),
        fetalHeartRate: z.number().int().min(40).max(240).optional(),
        liquor: z.string().max(20).optional(),
        moulding: z.string().max(10).optional(),
        maternalPulse: z.number().int().min(30).max(220).optional(),
        systolic: z.number().int().min(50).max(260).optional(),
        diastolic: z.number().int().min(30).max(180).optional(),
        temperatureC: z.number().min(33).max(43).optional(),
        oxytocin: z.string().max(40).optional(),
        drugs: z.string().max(200).optional(),
        urine: z.string().max(60).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const labour = await loadScoped(req, m.Labour, req.params.id, 'Labour');
    if (labour.status !== 'in_progress') throw conflict('Labour record is closed');
    if (!labour.activePhaseAt && (body.cervicalDilationCm ?? 0) >= 4) labour.activePhaseAt = body.at;
    const first = labour.partograph.find((p) => (p.cervicalDilationCm ?? 0) >= 4)?.cervicalDilationCm ?? body.cervicalDilationCm ?? 4;
    const alerts = partographAlerts(body, labour.activePhaseAt, Math.max(4, first));
    labour.partograph.push({ ...body, alerts, by: req.user!.id } as never);
    labour.partograph.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    await labour.save();
    await audit(req, { action: 'maternity.partograph', resource: 'labour', resourceId: String(labour._id), newValue: { dilation: body.cervicalDilationCm, alerts } });
    res.status(201).json({ success: true, data: { labour, alerts } });
  }),
);

/* ------------------------------------------------------------ Delivery & newborns */
maternityRouter.post(
  '/pregnancies/:id/delivery',
  requirePermission('maternity.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        deliveredAt: z.coerce.date().max(new Date(Date.now() + 5 * 60_000)),
        mode: z.enum(['SVD', 'assisted_vacuum', 'assisted_forceps', 'breech', 'c_section']),
        cSection: z.object({ indication: z.string().max(200), type: z.enum(['elective', 'emergency']), surgeon: z.string().max(120).optional(), anaesthesia: z.string().max(60).optional() }).optional(),
        bloodLossMl: z.number().int().min(0).max(10000).optional(),
        placenta: z.string().max(60).optional(),
        perineum: z.string().max(60).optional(),
        complications: z.array(z.string().max(80)).max(10).default([]),
        maternalOutcome: z.enum(['alive', 'referred', 'deceased']).default('alive'),
        attendantName: z.string().max(120).optional(),
        admissionId: z.string().optional(),
        babies: z.array(z.object({ sex: z.enum(['male', 'female', 'unknown']), birthWeightGrams: z.number().int().min(200).max(7000), apgar1: z.number().int().min(0).max(10).optional(), apgar5: z.number().int().min(0).max(10).optional(), apgar10: z.number().int().min(0).max(10).optional(), outcome: z.enum(['live_birth', 'fresh_stillbirth', 'macerated_stillbirth', 'neonatal_death']).default('live_birth'), resuscitation: z.boolean().default(false), notes: z.string().max(500).optional() })).min(1).max(6),
      }),
      req.body,
    );
    if (body.mode === 'c_section' && !body.cSection) throw badRequest('C-section details are required');
    const m = req.tenant!.models;
    const preg = await loadScoped(req, m.Pregnancy, req.params.id, 'Pregnancy');
    if (!['active', 'in_labour'].includes(preg.status)) throw conflict('Pregnancy already delivered or closed');
    const mother = await m.Patient.findById(preg.patientId);
    const ga = gestation(preg.lmp, body.deliveredAt);
    const babies = [];
    for (const [i, b] of body.babies.entries()) {
      let newbornPatientId;
      if (b.outcome === 'live_birth') {
        // Register the newborn immediately and link to the mother.
        const baby = await m.Patient.create({
          patientNumber: await nextPatientNumber(m),
          firstName: body.babies.length > 1 ? `Baby ${String.fromCharCode(65 + i)}` : 'Baby',
          lastName: `of ${mother!.firstName} ${mother!.lastName}`,
          gender: b.sex === 'unknown' ? 'unknown' : b.sex,
          dateOfBirth: body.deliveredAt,
          phone: mother!.phone,
          address: mother!.address,
          nextOfKin: [{ name: `${mother!.firstName} ${mother!.lastName}`, relationship: 'Mother', phone: mother!.phone ?? undefined }],
          motherId: mother!._id,
          registeredBranchId: req.branch!.id,
          branchIds: [req.branch!.id],
          createdBy: req.user!.id,
        });
        newbornPatientId = baby._id;
      }
      babies.push({ ...b, newbornPatientId });
    }
    const flags = [
      ...body.babies.filter((b) => b.birthWeightGrams < 2500).map(() => 'Low birth weight (<2500g)'),
      ...body.babies.filter((b) => (b.apgar5 ?? 10) < 7).map(() => 'APGAR at 5 min < 7'),
      ...((body.bloodLossMl ?? 0) >= 500 ? ['Postpartum haemorrhage (≥500 ml)'] : []),
    ];
    const d = await m.Delivery.create({ ...body, babies, pregnancyId: preg._id, motherId: preg.patientId, branchId: preg.branchId, gestationWeeks: ga?.weeks, complications: [...body.complications, ...flags], recordedBy: req.user!.id });
    preg.status = 'delivered';
    await preg.save();
    await m.Labour.updateMany({ pregnancyId: preg._id, status: 'in_progress' }, { status: 'delivered' });
    await audit(req, { action: 'maternity.delivery', resource: 'pregnancy', resourceId: String(preg._id), newValue: { mode: body.mode, babies: babies.length, flags } });
    res.status(201).json({ success: true, data: { delivery: d, flags } });
  }),
);

maternityRouter.post(
  '/pnc',
  requireAnyPermission('maternity.manage', 'mch.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ motherId: z.string(), deliveryId: z.string().optional(), daysPostpartum: z.number().int().min(0).max(365).optional(), motherFindings: z.string().max(2000).optional(), babyFindings: z.string().max(2000).optional(), breastfeeding: z.string().max(60).optional(), fpCounselled: z.boolean().default(false), notes: z.string().max(2000).optional() }), req.body);
    const mother = await patientFor(req, body.motherId);
    const v = await req.tenant!.models.PncVisit.create({ ...body, motherId: mother._id, branchId: req.branch!.id, by: req.user!.id });
    await audit(req, { action: 'maternity.pnc', resource: 'patient', resourceId: String(mother._id) });
    res.status(201).json({ success: true, data: v });
  }),
);

/* ------------------------------------------------------------ MCH: immunization & growth */
mchRouter.get(
  '/patients/:id/immunizations',
  requireAnyPermission('mch.view', 'maternity.view'),
  h(async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const given = await req.tenant!.models.Immunization.find({ patientId: p._id }).sort({ givenAt: 1 }).lean();
    res.json({ success: true, data: { given, schedule: immunizationStatus(p.dateOfBirth, given) } });
  }),
);

mchRouter.post(
  '/immunizations',
  requirePermission('mch.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientId: z.string(), vaccine: z.string().min(2).max(80), dose: z.number().int().min(0).max(10).default(1), givenAt: z.coerce.date().max(new Date(Date.now() + 60_000)).default(() => new Date()), batchNumber: z.string().max(40).optional(), site: z.string().max(40).optional() }), req.body);
    const m = req.tenant!.models;
    const p = await patientFor(req, body.patientId);
    if (await m.Immunization.exists({ patientId: p._id, vaccine: body.vaccine, dose: body.dose })) throw conflict(`${body.vaccine} dose ${body.dose} is already recorded`, undefined, 'DUPLICATE_DOSE');
    const nextDue = nextDueFor(body.vaccine, body.dose, p.dateOfBirth);
    const im = await m.Immunization.create({ ...body, patientId: p._id, branchId: req.branch!.id, nextDue, by: req.user!.id, byName: req.user!.name });
    if (nextDue) await notifyPatientSms(req.tenant!, p, `imm:${im._id}`, `${p.firstName}'s next immunization (${body.vaccine}) is due on ${nextDue.toISOString().slice(0, 10)}.`);
    await audit(req, { action: 'mch.immunization', resource: 'patient', resourceId: String(p._id), newValue: { vaccine: body.vaccine, dose: body.dose } });
    res.status(201).json({ success: true, data: im });
  }),
);

mchRouter.get(
  '/patients/:id/growth',
  requireAnyPermission('mch.view', 'maternity.view'),
  h(async (req, res) => {
    const p = await patientFor(req, req.params.id);
    res.json({ success: true, data: await req.tenant!.models.GrowthRecord.find({ patientId: p._id }).sort({ measuredAt: 1 }).lean() });
  }),
);

mchRouter.post(
  '/growth',
  requirePermission('mch.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientId: z.string(), measuredAt: z.coerce.date().default(() => new Date()), weightKg: z.number().min(0.3).max(150).optional(), heightCm: z.number().min(20).max(200).optional(), muacCm: z.number().min(5).max(40).optional(), headCircumferenceCm: z.number().min(20).max(70).optional(), notes: z.string().max(500).optional() }), req.body);
    const p = await patientFor(req, body.patientId);
    const ageMonths = p.dateOfBirth ? Math.floor((body.measuredAt.getTime() - new Date(p.dateOfBirth).getTime()) / (30.4375 * DAY)) : undefined;
    const g = await req.tenant!.models.GrowthRecord.create({ ...body, patientId: p._id, branchId: req.branch!.id, ageMonths, nutritionStatus: muacStatus(body.muacCm, ageMonths), by: req.user!.id });
    await audit(req, { action: 'mch.growth', resource: 'patient', resourceId: String(p._id) });
    res.status(201).json({ success: true, data: g });
  }),
);

/** Immunization defaulters: children with overdue routine doses. */
mchRouter.get(
  '/defaulters',
  requirePermission('mch.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const since = new Date(Date.now() - 5 * 365 * DAY);
    const children = await m.Patient.find({ ...branchFilter(req, 'branchIds'), dateOfBirth: { $gte: since }, status: 'active' }).select('patientNumber firstName lastName dateOfBirth phone').limit(2000).lean();
    const imms = await m.Immunization.find({ patientId: { $in: children.map((c) => c._id) } }).select('patientId vaccine dose givenAt').lean();
    const out = children
      .map((c) => ({ patient: c, overdue: immunizationStatus(c.dateOfBirth, imms.filter((i) => String(i.patientId) === String(c._id))).filter((s) => s.status === 'overdue' && !s.regional).map((s) => `${s.vaccine} ${s.dose}`) }))
      .filter((r) => r.overdue.length);
    res.json({ success: true, data: out });
  }),
);

/* ------------------------------------------------------------ Family planning */
fpRouter.post(
  '/visits',
  requirePermission('fp.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientId: z.string(), visitType: z.enum(['new', 'revisit', 'removal', 'switch']).default('new'), method: z.enum(['coc_pills', 'pop_pills', 'injectable_dmpa', 'implant', 'iucd', 'condoms', 'emergency_pill', 'btl', 'vasectomy', 'lam', 'natural', 'counselling_only']), counselling: z.string().max(2000).optional(), sideEffects: z.string().max(1000).optional(), quantity: z.number().int().min(0).max(1000).optional(), batchNumber: z.string().max(40).optional(), nextDue: z.coerce.date().optional() }), req.body);
    const p = await patientFor(req, body.patientId);
    if (body.method === 'vasectomy' && p.gender !== 'male') throw badRequest('Vasectomy applies to male clients');
    if (['btl', 'iucd', 'implant'].includes(body.method) && p.gender !== 'female') throw badRequest('Method applies to female clients');
    const days = FP_RETURN_DAYS[body.method];
    const cycles = ['coc_pills', 'pop_pills'].includes(body.method) && body.quantity ? body.quantity : 1;
    const nextDue = body.nextDue ?? (days ? new Date(Date.now() + days * cycles * DAY) : undefined);
    const v = await req.tenant!.models.FpVisit.create({ ...body, patientId: p._id, branchId: req.branch!.id, nextDue, by: req.user!.id, byName: req.user!.name });
    if (nextDue) await notifyPatientSms(req.tenant!, p, `fp:${v._id}`, `Your next family planning visit is due on ${nextDue.toISOString().slice(0, 10)}.`);
    await audit(req, { action: 'fp.visit', resource: 'patient', resourceId: String(p._id), newValue: { method: body.method, visitType: body.visitType } });
    res.status(201).json({ success: true, data: v });
  }),
);

fpRouter.get(
  '/visits',
  requirePermission('fp.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.patientId) filter.patientId = (await patientFor(req, req.query.patientId))._id;
    res.json({ success: true, data: await req.tenant!.models.FpVisit.find(filter).populate('patientId', 'patientNumber firstName lastName phone').sort({ createdAt: -1 }).limit(300).lean() });
  }),
);

/** Clients whose most recent FP visit is past its return date. */
fpRouter.get(
  '/defaulters',
  requirePermission('fp.view'),
  h(async (req, res) => {
    const rows = await req.tenant!.models.FpVisit.find({ ...branchFilter(req) }).populate('patientId', 'patientNumber firstName lastName phone').sort({ createdAt: -1 }).limit(5000).lean();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(String((r.patientId as unknown as { _id: string })._id))) latest.set(String((r.patientId as unknown as { _id: string })._id), r);
    res.json({ success: true, data: [...latest.values()].filter((r) => r.nextDue && new Date(r.nextDue) < new Date()) });
  }),
);

export { forbidden };
