import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse, parsePatch } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid } from '../common/helpers';
import { postCharge, voidChargeForSource } from '../billing/billingService';
import { enqueue } from '../frontdesk/queueService';
import { nextAccession } from '../laboratory/labService';
import { notifyStaff } from '../notifications/notify';

const router = Router();
router.use(authenticateTenant);

/** DICOM UID derived from a UUID (2.25.<uuid as decimal>) — globally unique without an org root. */
const dicomUid = () => `2.25.${BigInt(`0x${crypto.randomUUID().replace(/-/g, '')}`).toString()}`;

const examSchema = z.object({ code: z.string().min(2).max(30).regex(/^[A-Za-z0-9-_]+$/), name: z.string().min(2).max(160), modality: z.enum(['XR', 'US', 'CT', 'MR', 'MG', 'FL', 'ECG', 'OTHER']), bodyPart: z.string().max(60).optional(), serviceCode: z.string().max(40).optional(), requiresPreauth: z.boolean().default(false), active: z.boolean().optional() });

router.get(
  '/exams',
  requireAnyPermission('radiology.view', 'radiology.order'),
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const filter: Record<string, unknown> = req.query.all === 'true' ? {} : { active: true };
    if (q) filter.$or = [{ code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) }, { name: new RegExp(escapeRegex(q), 'i') }];
    res.json({ success: true, data: await req.tenant!.models.ImagingExam.find(filter).sort({ modality: 1, name: 1 }).lean() });
  }),
);

router.post(
  '/exams',
  requirePermission('radiology.manage'),
  h(async (req, res) => {
    const body = parse(examSchema, req.body);
    const m = req.tenant!.models;
    if (await m.ImagingExam.exists({ code: body.code.toUpperCase() })) throw conflict('Exam code exists');
    const e = await m.ImagingExam.create({ ...body, code: body.code.toUpperCase() });
    await audit(req, { action: 'radiology.exam_create', resource: 'imaging_exam', resourceId: e.code, newValue: body });
    res.status(201).json({ success: true, data: e });
  }),
);

router.patch(
  '/exams/:code',
  requirePermission('radiology.manage'),
  h(async (req, res) => {
    const body = parsePatch(examSchema.omit({ code: true }).partial(), req.body);
    const e = await req.tenant!.models.ImagingExam.findOneAndUpdate({ code: String(req.params.code).toUpperCase() }, { $set: body }, { returnDocument: 'after' });
    if (!e) throw notFound('Exam not found');
    await audit(req, { action: 'radiology.exam_update', resource: 'imaging_exam', resourceId: e.code, newValue: body });
    res.json({ success: true, data: e });
  }),
);

router.post(
  '/requests',
  requirePermission('radiology.order'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ visitId: z.string().optional(), admissionId: z.string().optional(), examCode: z.string(), clinicalIndication: z.string().min(3).max(2000), priority: z.enum(['routine', 'urgent', 'stat']).default('routine') }), req.body);
    const m = req.tenant!.models;
    let ctx: { patientId: unknown; branchId: unknown; visitId?: unknown; admissionId?: unknown; payer?: string };
    if (body.visitId) {
      const v = await loadScoped(req, m.Visit, body.visitId, 'Visit');
      if (!['open', 'in_progress', 'admitted'].includes(v.status)) throw conflict('Visit is closed');
      ctx = { patientId: v.patientId, branchId: v.branchId, visitId: v._id, payer: v.payer?.type ?? undefined };
    } else if (body.admissionId) {
      const a = await loadScoped(req, m.Admission, body.admissionId, 'Admission');
      ctx = { patientId: a.patientId, branchId: a.branchId, visitId: a.visitId ?? undefined, admissionId: a._id };
    } else throw badRequest('visitId or admissionId is required');
    const exam = await m.ImagingExam.findOne({ code: body.examCode.toUpperCase(), active: true }).lean();
    if (!exam) throw notFound('Imaging exam not found');
    const r = await m.RadiologyRequest.create({
      requestNumber: await nextNumber(m, 'radrequest', 'RR'),
      accessionNumber: await nextAccession(m, 'R'),
      studyInstanceUid: dicomUid(),
      ...ctx,
      examCode: exam.code,
      examName: exam.name,
      modality: exam.modality,
      clinicalIndication: body.clinicalIndication,
      priority: body.priority,
      requestedBy: req.user!.id,
      requestedByName: req.user!.name,
    } as never);
    await postCharge(req, m, { patientId: ctx.patientId as string, visitId: ctx.visitId as string | undefined, branchId: ctx.branchId as string, serviceCode: exam.serviceCode ?? `RAD-${exam.code}`, description: `Imaging: ${exam.name}`, source: 'radiology', sourceId: String(r._id) });
    if (ctx.visitId) await enqueue(m, { visitId: ctx.visitId as string, patientId: ctx.patientId as string, branchId: ctx.branchId as string, stage: 'radiology', priority: body.priority === 'routine' ? 'normal' : 'urgent' });
    await audit(req, { action: 'radiology.request', resource: 'radiology_request', resourceId: String(r._id), newValue: { exam: exam.code } });
    res.status(201).json({ success: true, data: r, warnings: exam.requiresPreauth && ctx.payer === 'sha' ? ['This exam requires SHA preauthorization before it is performed.'] : [] });
  }),
);

router.get(
  '/requests',
  requireAnyPermission('radiology.view', 'radiology.order'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    for (const k of ['visitId', 'admissionId', 'patientId'] as const) if (req.query[k]) filter[k] = oid(req.query[k], k);
    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    if (req.query.modality) filter.modality = String(req.query.modality);
    const [items, total] = await Promise.all([m.RadiologyRequest.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.RadiologyRequest.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/requests/:id',
  requireAnyPermission('radiology.view', 'radiology.order'),
  h(async (req, res) => {
    const r = await loadScoped(req, req.tenant!.models.RadiologyRequest, req.params.id, 'Request');
    const [patient, attachments] = await Promise.all([
      req.tenant!.models.Patient.findById(r.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth').lean(),
      req.tenant!.models.Document.find({ 'relatedTo.resource': 'radiology_request', 'relatedTo.id': String(r._id), deletedAt: null }).select('title mimeType sizeBytes createdAt').lean(),
    ]);
    res.json({ success: true, data: { ...r.toObject(), patient, attachments } });
  }),
);

const RSTEPS: Record<string, { perms: string[]; from: string[]; to: string }> = {
  schedule: { perms: ['radiology.manage'], from: ['requested', 'scheduled'], to: 'scheduled' },
  start: { perms: ['radiology.manage', 'radiology.report'], from: ['requested', 'scheduled'], to: 'in_progress' },
  report: { perms: ['radiology.report'], from: ['in_progress', 'reported'], to: 'reported' },
  verify: { perms: ['radiology.report'], from: ['reported'], to: 'verified' },
  cancel: { perms: ['radiology.order', 'radiology.manage'], from: ['requested', 'scheduled'], to: 'cancelled' },
};

router.post(
  '/requests/:id/:step',
  h(async (req, res) => {
    const name = String(req.params.step);
    const step = RSTEPS[name];
    if (!step) throw notFound();
    if (!step.perms.some((p) => req.permissions!.has(p))) throw forbidden(`Requires one of: ${step.perms.join(', ')}`);
    const body = parse(z.object({ scheduledAt: z.coerce.date().optional(), room: z.string().max(60).optional(), findings: z.string().max(10000).optional(), impression: z.string().max(4000).optional(), reason: z.string().max(300).optional(), pacsViewerUrl: z.string().url().optional() }), req.body ?? {});
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.RadiologyRequest, req.params.id, 'Request');
    if (!step.from.includes(r.status)) throw conflict(`Cannot ${name} a request that is ${r.status}`, undefined, 'INVALID_RADIOLOGY_TRANSITION');
    const me = req.user!;
    if (name === 'schedule') {
      if (!body.scheduledAt) throw badRequest('scheduledAt is required');
      r.scheduledAt = body.scheduledAt;
      r.room = body.room;
    }
    if (name === 'start') {
      r.performedAt = new Date();
      r.performedBy = me.id as never;
    }
    if (name === 'report') {
      if (!body.findings || !body.impression) throw badRequest('Findings and impression are required');
      r.set('report.findings', body.findings);
      r.set('report.impression', body.impression);
      r.set('report.reportedBy', me.id);
      r.set('report.reportedByName', me.name);
      r.set('report.reportedAt', new Date());
      if (body.pacsViewerUrl) r.pacsViewerUrl = body.pacsViewerUrl;
    }
    if (name === 'verify') {
      r.set('report.verifiedBy', me.id);
      r.set('report.verifiedByName', me.name);
      r.set('report.verifiedAt', new Date());
    }
    if (name === 'cancel') {
      if (!body.reason) throw badRequest('A reason is required');
      await voidChargeForSource(m, 'radiology', String(r._id), `Imaging cancelled: ${body.reason}`, me.id);
    }
    r.status = step.to as never;
    await r.save();
    if (name === 'verify') await notifyStaff(m, [r.requestedBy], { event: 'Lab Result', title: `Imaging report ready: ${r.examName}`, body: r.report?.impression ?? '', link: r.visitId ? `/visits/${r.visitId}?tab=orders` : `/radiology/${r._id}`, branchId: String(r.branchId) });
    await audit(req, { action: `radiology.${name}`, resource: 'radiology_request', resourceId: String(r._id), newValue: { status: r.status, reason: body.reason } });
    res.json({ success: true, data: r });
  }),
);

/** Modality worklist feed (DICOM MWL-ready fields) for integration with a PACS/RIS broker. */
router.get(
  '/worklist',
  requireAnyPermission('radiology.view', 'radiology.manage'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const filter: Record<string, unknown> = { ...branchFilter(req), status: { $in: ['requested', 'scheduled', 'in_progress'] } };
    if (req.query.modality) filter.modality = String(req.query.modality);
    if (req.query.date) filter.scheduledAt = dayRange(req.query.date, req.query.date);
    const rows = await m.RadiologyRequest.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth').sort({ scheduledAt: 1, createdAt: 1 }).limit(500).lean();
    res.json({
      success: true,
      data: rows.map((r) => {
        const p = r.patientId as unknown as { patientNumber: string; firstName: string; lastName: string; gender: string; dateOfBirth?: Date };
        return { AccessionNumber: r.accessionNumber, StudyInstanceUID: r.studyInstanceUid, PatientID: p.patientNumber, PatientName: `${p.lastName}^${p.firstName}`, PatientSex: p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'O', PatientBirthDate: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().slice(0, 10).replace(/-/g, '') : '', Modality: r.modality, RequestedProcedureDescription: r.examName, ScheduledProcedureStepStartDateTime: r.scheduledAt ?? null, RequestingPhysician: r.requestedByName, Priority: r.priority };
      }),
    });
  }),
);

export default router;
