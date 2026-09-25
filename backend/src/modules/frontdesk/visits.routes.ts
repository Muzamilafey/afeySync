import { assertShaTransactable } from '../sha/shaWorkflow';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { VISIT_TYPES, QUEUE_STAGES } from '../../models/tenant/clinical';
import { dayRange, loadScoped, nextNumber, oid } from '../common/helpers';
import { canWorkStage, enqueue, PRIORITY_RANK, type Stage } from './queueService';
import { postCharge } from '../billing/billingService';
import { nextPatientNumber } from '../patients/patientService';
import { refreshTenantStats } from '../tenants/provisioning';

export const visitsRouter = Router();
export const queuesRouter = Router();
export const referralsRouter = Router();
for (const r of [visitsRouter, queuesRouter, referralsRouter]) r.use(authenticateTenant);

const payerSchema = z.object({ type: z.enum(['cash', 'sha', 'insurance', 'corporate']).default('cash'), scheme: z.string().max(80).optional(), memberNumber: z.string().max(60).optional() }).default({ type: 'cash' });

async function accessiblePatient(req: Request, id: string) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient'));
  if (!p) throw notFound('Patient not found');
  if (!canAccessAnyBranch(req, p.branchIds ?? [])) throw forbidden('This patient is not registered in your branch', 'BRANCH_FORBIDDEN');
  return p;
}

/** SHA visits require an eligibility check in the last 24 hours showing the member is eligible. */
async function shaGate(req: Request, patient: { _id: unknown; sha?: { status?: string | null; lastCheckedAt?: Date | null; lastCheckId?: unknown } | null }) {
  const fresh = patient.sha?.lastCheckedAt && Date.now() - new Date(patient.sha.lastCheckedAt).getTime() < 24 * 3600_000;
  assertShaTransactable(patient as never);
  if (patient.sha?.status !== 'eligible' || !fresh) throw new AppError(422, 'SHA_ELIGIBILITY_REQUIRED', 'Check SHA eligibility (within the last 24 hours) before starting an SHA visit, or register the visit as cash.');
  return patient.sha?.lastCheckId;
}

/* ------------------------------------------------------------ Check-in / visits */
visitsRouter.post(
  '/',
  requirePermission('queue.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string(),
        type: z.enum(VISIT_TYPES).default('opd'),
        priority: z.enum(['normal', 'urgent', 'emergency']).default('normal'),
        payer: payerSchema,
        department: z.string().max(80).optional(),
        complaint: z.string().max(500).optional(),
        appointmentId: z.string().optional(),
        referralIn: z.object({ from: z.string().max(160), facilityCode: z.string().max(40).optional(), reason: z.string().max(500).optional(), referenceNumber: z.string().max(60).optional() }).optional(),
        firstStage: z.enum(QUEUE_STAGES).default('triage'),
        chargeServiceCodes: z.array(z.string().max(40)).max(10).default([]),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const patient = await accessiblePatient(req, body.patientId);
    const open = await m.Visit.findOne({ patientId: patient._id, branchId: req.branch!.id, status: { $in: ['open', 'in_progress'] } }).lean();
    if (open) throw conflict(`Patient already has an open visit (${open.visitNumber})`, { visitId: open._id, visitNumber: open.visitNumber }, 'VISIT_OPEN');
    let shaCheckId: string | undefined;
    if (body.payer.type === 'sha') shaCheckId = String(await shaGate(req, patient));
    const visit = await m.Visit.create({
      visitNumber: await nextNumber(m, 'visit', 'V'),
      patientId: patient._id,
      branchId: req.branch!.id,
      type: body.type,
      priority: body.priority,
      payer: { ...body.payer, memberNumber: body.payer.memberNumber ?? (body.payer.type === 'sha' ? patient.shaNumber ?? patient.clientRegistryId : undefined), shaEligibilityCheckId: shaCheckId },
      department: body.department,
      complaint: body.complaint,
      appointmentId: body.appointmentId,
      referralIn: body.referralIn,
      createdBy: req.user!.id,
    });
    if (!patient.branchIds.some((b) => String(b) === req.branch!.id)) {
      patient.branchIds.push(req.branch!.id as never);
      await patient.save();
    }
    if (body.appointmentId) await m.Appointment.updateOne({ _id: oid(body.appointmentId, 'Appointment'), patientId: patient._id }, { status: 'checked_in', visitId: visit._id });
    const entry = await enqueue(m, { visitId: visit._id, patientId: patient._id, branchId: req.branch!.id, stage: body.firstStage, priority: body.priority });
    for (const code of body.chargeServiceCodes) await postCharge(req, m, { patientId: patient._id, visitId: visit._id, branchId: req.branch!.id, serviceCode: code, source: 'visit_fee', sourceId: `${visit._id}:${code}` });
    await audit(req, { action: 'visit.create', resource: 'visit', resourceId: String(visit._id), newValue: { visitNumber: visit.visitNumber, type: body.type, payer: body.payer.type, ticket: entry.ticket } });
    res.status(201).json({ success: true, data: { visit, queueEntry: entry } });
  }),
);

/** Emergency registration: minimal details, patient created immediately, highest queue priority. */
visitsRouter.post(
  '/emergency',
  requirePermission('patients.create'),
  requirePermission('queue.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        firstName: z.string().trim().max(60).optional(),
        lastName: z.string().trim().max(60).optional(),
        gender: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
        estimatedAgeYears: z.number().int().min(0).max(120).optional(),
        phone: z.string().max(20).optional(),
        description: z.string().max(500).optional(),
        broughtBy: z.string().max(160).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const patient = new m.Patient({
      patientNumber: await nextPatientNumber(m),
      firstName: body.firstName || 'Unknown',
      lastName: body.lastName || (body.firstName ? '-' : `Emergency ${new Date().toISOString().slice(11, 16)}`),
      gender: body.gender,
      dateOfBirth: body.estimatedAgeYears !== undefined ? new Date(new Date().getFullYear() - body.estimatedAgeYears, 0, 1) : undefined,
      dobEstimated: body.estimatedAgeYears !== undefined,
      phone: body.phone,
      registeredBranchId: req.branch!.id,
      branchIds: [req.branch!.id],
      createdBy: req.user!.id,
    });
    await patient.save();
    const visit = await m.Visit.create({ visitNumber: await nextNumber(m, 'visit', 'V'), patientId: patient._id, branchId: req.branch!.id, type: 'emergency', priority: 'emergency', complaint: [body.description, body.broughtBy && `Brought by: ${body.broughtBy}`].filter(Boolean).join(' — '), createdBy: req.user!.id });
    const entry = await enqueue(m, { visitId: visit._id, patientId: patient._id, branchId: req.branch!.id, stage: 'consultation', priority: 'emergency' });
    await audit(req, { action: 'visit.emergency_register', resource: 'visit', resourceId: String(visit._id), newValue: { patientNumber: patient.patientNumber } });
    refreshTenantStats(req.tenant!.id, m).catch(() => undefined);
    res.status(201).json({ success: true, data: { patient, visit, queueEntry: entry } });
  }),
);

visitsRouter.get(
  '/',
  requireAnyPermission('queue.view', 'opd.view', 'consultation.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
    if (req.query.from || req.query.to || req.query.today === 'true') filter.createdAt = dayRange(req.query.from, req.query.to);
    const [items, total] = await Promise.all([
      m.Visit.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth sha.status').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      m.Visit.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

visitsRouter.get(
  '/:id',
  requireAnyPermission('queue.view', 'opd.view', 'consultation.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const visit = await loadScoped(req, m.Visit, req.params.id, 'Visit');
    const [patient, queue, vitals, consultations, labOrders, radiology, prescriptions, invoice, procedures, referrals] = await Promise.all([
      m.Patient.findById(visit.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth phone allergies clientRegistryId shaNumber sha nationalId').lean(),
      m.QueueEntry.find({ visitId: visit._id }).sort({ createdAt: 1 }).lean(),
      m.Vitals.find({ visitId: visit._id }).sort({ recordedAt: -1 }).lean(),
      m.Consultation.find({ visitId: visit._id }).sort({ createdAt: -1 }).lean(),
      m.LabOrder.find({ visitId: visit._id }).sort({ createdAt: -1 }).lean(),
      m.RadiologyRequest.find({ visitId: visit._id }).sort({ createdAt: -1 }).lean(),
      m.Prescription.find({ visitId: visit._id }).sort({ createdAt: -1 }).lean(),
      m.Invoice.findOne({ visitId: visit._id, status: { $ne: 'void' } }).select('invoiceNumber status totals').lean(),
      m.Procedure.find({ visitId: visit._id }).lean(),
      m.Referral.find({ visitId: visit._id }).lean(),
    ]);
    res.json({ success: true, data: { visit, patient, queue, vitals, consultations, labOrders, radiology, prescriptions, invoice, procedures, referrals } });
  }),
);

visitsRouter.post(
  '/:id/route',
  requireAnyPermission('queue.manage', 'consultation.create', 'opd.create'),
  h(async (req, res) => {
    const body = parse(z.object({ stage: z.enum(QUEUE_STAGES), priority: z.enum(['normal', 'urgent', 'emergency']).optional(), notes: z.string().max(300).optional() }), req.body);
    const m = req.tenant!.models;
    const visit = await loadScoped(req, m.Visit, req.params.id, 'Visit');
    if (!['open', 'in_progress'].includes(visit.status)) throw conflict('Visit is not open');
    const entry = await enqueue(m, { visitId: visit._id, patientId: visit.patientId, branchId: visit.branchId, stage: body.stage, priority: body.priority ?? (visit.priority as 'normal'), notes: body.notes });
    await audit(req, { action: 'queue.route', resource: 'visit', resourceId: String(visit._id), newValue: { stage: body.stage } });
    res.status(201).json({ success: true, data: entry });
  }),
);

visitsRouter.post(
  '/:id/close',
  requireAnyPermission('queue.manage', 'consultation.create'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const visit = await loadScoped(req, m.Visit, req.params.id, 'Visit');
    if (!['open', 'in_progress'].includes(visit.status)) throw conflict('Visit is already closed');
    const draft = await m.Consultation.exists({ visitId: visit._id, status: 'draft' });
    if (draft && req.body?.force !== true) throw new AppError(422, 'CONSULTATION_DRAFT_OPEN', 'A consultation for this visit is still in draft. Finalize it or confirm closing.');
    visit.status = 'closed';
    visit.closedAt = new Date();
    await visit.save();
    await m.QueueEntry.updateMany({ visitId: visit._id, status: { $in: ['waiting', 'called'] } }, { status: 'cancelled' });
    await m.QueueEntry.updateMany({ visitId: visit._id, status: 'in_service' }, { status: 'done', doneAt: new Date() });
    await audit(req, { action: 'visit.close', resource: 'visit', resourceId: String(visit._id) });
    res.json({ success: true, data: visit });
  }),
);

/* ------------------------------------------------------------ Queues */
queuesRouter.get(
  '/',
  h(async (req, res) => {
    const stage = String(req.query.stage ?? '') as Stage;
    if (!(QUEUE_STAGES as readonly string[]).includes(stage)) throw badRequest('stage is required');
    if (!req.permissions!.has('queue.view') && !canWorkStage(req, stage)) throw forbidden();
    const m = req.tenant!.models;
    const statuses = String(req.query.status ?? 'waiting,called,in_service').split(',');
    const filter: Record<string, unknown> = { stage, status: { $in: statuses }, ...(req.branch ? { branchId: req.branch.id } : branchFilter(req)) };
    if (req.query.mine === 'true') filter.$or = [{ assignedTo: req.user!.id }, { assignedTo: null }];
    const items = await m.QueueEntry.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth sha.status allergies').populate('visitId', 'visitNumber type payer.type complaint').limit(300).lean();
    items.sort((a, b) => PRIORITY_RANK[a.priority as 'normal'] - PRIORITY_RANK[b.priority as 'normal'] || +new Date(a.createdAt!) - +new Date(b.createdAt!));
    const doneToday = await m.QueueEntry.countDocuments({ stage, status: 'done', doneAt: dayRange(), ...(req.branch ? { branchId: req.branch.id } : {}) });
    res.json({ success: true, data: items, meta: { doneToday } });
  }),
);

const transitions: Record<string, { from: string[]; to: string; stamp?: string }> = {
  call: { from: ['waiting', 'called'], to: 'called', stamp: 'calledAt' },
  start: { from: ['waiting', 'called'], to: 'in_service', stamp: 'startedAt' },
  complete: { from: ['called', 'in_service'], to: 'done', stamp: 'doneAt' },
  skip: { from: ['waiting', 'called'], to: 'skipped' },
  requeue: { from: ['skipped', 'called'], to: 'waiting' },
};

for (const [action, t] of Object.entries(transitions)) {
  queuesRouter.post(
    `/:id/${action}`,
    h(async (req, res) => {
      const body = parse(z.object({ nextStage: z.enum(QUEUE_STAGES).optional(), room: z.string().max(40).optional() }), req.body ?? {});
      const m = req.tenant!.models;
      const entry = await loadScoped(req, m.QueueEntry, req.params.id, 'Queue entry');
      if (!canWorkStage(req, entry.stage as Stage)) throw forbidden(`You cannot serve the ${entry.stage} queue`);
      if (!t.from.includes(entry.status)) throw conflict(`Cannot ${action} an entry that is ${entry.status}`, undefined, 'INVALID_QUEUE_TRANSITION');
      entry.status = t.to as never;
      if (t.stamp) entry.set(t.stamp, new Date());
      if (action === 'call') entry.calledBy = req.user!.id as never;
      if (action === 'start' || action === 'call') {
        entry.assignedTo = req.user!.id as never;
        if (body.room) entry.room = body.room;
      }
      if (action === 'complete') entry.servedBy = req.user!.id as never;
      await entry.save();
      if (action === 'start') await m.Visit.updateOne({ _id: entry.visitId, status: 'open' }, { status: 'in_progress' });
      let next = null;
      if (action === 'complete' && body.nextStage) {
        // The next stage inherits the visit's current priority (triage may have escalated it).
        const visit = await m.Visit.findById(entry.visitId).select('priority').lean();
        next = await enqueue(m, { visitId: entry.visitId, patientId: entry.patientId, branchId: entry.branchId, stage: body.nextStage, priority: (visit?.priority ?? entry.priority) as 'normal' });
      }
      await audit(req, { action: `queue.${action}`, resource: 'queue_entry', resourceId: String(entry._id), newValue: { stage: entry.stage, ticket: entry.ticket, nextStage: body.nextStage } });
      res.json({ success: true, data: { entry, next } });
    }),
  );
}

/* ------------------------------------------------------------ Referrals */
referralsRouter.post(
  '/',
  requireAnyPermission('consultation.create', 'queue.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string(),
        visitId: z.string().optional(),
        direction: z.enum(['out', 'in', 'internal']),
        toFacility: z.string().max(160).optional(),
        toFacilityCode: z.string().max(40).optional(),
        toDepartment: z.string().max(80).optional(),
        reason: z.string().min(3).max(1000),
        clinicalSummary: z.string().max(4000).optional(),
        urgency: z.enum(['routine', 'urgent', 'emergency']).default('routine'),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const patient = await accessiblePatient(req, body.patientId);
    if (body.visitId) await loadScoped(req, m.Visit, body.visitId, 'Visit');
    const r = await m.Referral.create({ ...body, patientId: patient._id, branchId: req.branch!.id, referralNumber: await nextNumber(m, 'referral', 'REF'), createdBy: req.user!.id });
    await audit(req, { action: 'referral.create', resource: 'referral', resourceId: String(r._id), newValue: { direction: body.direction, to: body.toFacility ?? body.toDepartment } });
    res.status(201).json({ success: true, data: r });
  }),
);

referralsRouter.get(
  '/',
  requireAnyPermission('consultation.view', 'queue.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
    if (req.query.status) filter.status = String(req.query.status);
    res.json({ success: true, data: await req.tenant!.models.Referral.find(filter).populate('patientId', 'patientNumber firstName lastName').sort({ createdAt: -1 }).limit(200).lean() });
  }),
);

referralsRouter.post(
  '/:id/status',
  requireAnyPermission('consultation.create', 'queue.manage'),
  h(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['sent', 'accepted', 'completed', 'cancelled']) }), req.body);
    const r = await loadScoped(req, req.tenant!.models.Referral, req.params.id, 'Referral');
    r.status = status;
    await r.save();
    await audit(req, { action: 'referral.status', resource: 'referral', resourceId: String(r._id), newValue: { status } });
    res.json({ success: true, data: r });
  }),
);
