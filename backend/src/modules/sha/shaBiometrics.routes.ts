import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError, badRequest, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { oid } from '../common/helpers';
import { hieRequest } from '../../integrations/hie/hieClient';
import { pick } from '../../integrations/hie/normalize';
import { localStorageDriver } from '../documents/storage';
import { meta } from '../../models/meta';
import { assertShaTransactable } from './shaWorkflow';
import { dispatchBiometric, reconcileJob } from './shaBiometrics';

/**
 * Minors biometrics enrollment (enrol, then verify, per finger, until fully enrolled) and OTP whitelist requests.
 * Mounted under /sha. Every outcome of a capture arrives by callback; the screen watches the local job record.
 */
const router = Router();
router.use(authenticateTenant);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });

async function shaPatient(req: Request, patientId: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(patientId, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  assertShaTransactable(p);
  if (!p.clientRegistryId) throw new AppError(422, 'CR_ID_REQUIRED', 'This patient has no Client Registry ID. Search/import the patient from the DHA Client Registry first.');
  return p;
}

const capture = z.object({
  patientId: z.string(),
  position: z.number().int().min(1).max(10),
  workstationId: z.string().min(4).max(120),
  deviceId: z.string().min(1).max(120),
  agentId: z.string().min(1).max(80),
});

/* ------------------------------------------------------------------ Enrollment */
router.get('/biometrics/enrollment-status', requireAnyPermission('sha.view', 'sha.authorization'), h(async (req, res) => {
  const p = await shaPatient(req, req.query.patientId);
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.biometrics.enrollment.status', query: { beneficiary_code: p.clientRegistryId! } });
  const o = isObj(r.data) ? (isObj(r.data.data) ? (r.data.data as Obj) : r.data) : {};
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => n >= 1 && n <= 10) : []);
  res.json({
    success: true,
    data: {
      beneficiaryCode: p.clientRegistryId,
      useSilBiometrics: p.sha?.useSilBiometrics ?? null,
      enrollmentStatus: pick(o, 'enrollment_status', 'enrollmentStatus') ?? '',
      verified: nums(o.verified),
      nonVerified: nums(o.non_verified ?? o.nonVerified),
      total: Number(o.total ?? 0),
    },
  });
}));

router.post('/biometrics/enrollments', requirePermission('sha.authorization'), h(async (req, res) => {
  const body = parse(capture, req.body);
  const p = await shaPatient(req, body.patientId);
  const job = await dispatchBiometric(req, 'enrollment', { ...body, patientId: p._id, beneficiaryCode: p.clientRegistryId! });
  res.status(202).json({ success: true, data: job });
}));

router.post('/biometrics/verifications', requirePermission('sha.authorization'), h(async (req, res) => {
  const body = parse(capture, req.body);
  const p = await shaPatient(req, body.patientId);
  const job = await dispatchBiometric(req, 'verification', { ...body, patientId: p._id, beneficiaryCode: p.clientRegistryId! });
  res.status(202).json({ success: true, data: job });
}));

/** Local job records, updated by SHA's callbacks. The screen watches these; nothing here calls SHA. */
router.get('/biometrics/jobs', requireAnyPermission('sha.view', 'sha.authorization'), h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.patientId) filter.patientId = (await shaPatient(req, req.query.patientId))._id;
  else if (req.query.shaVisitId) filter.shaVisitId = oid(req.query.shaVisitId, 'SHA visit');
  else throw badRequest('patientId or shaVisitId is required');
  const rows = await req.tenant!.models.ShaBiometricJob.find(filter).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ success: true, data: rows });
}));

router.get('/biometrics/jobs/:id', requireAnyPermission('sha.view', 'sha.authorization'), h(async (req, res) => {
  const job = await req.tenant!.models.ShaBiometricJob.findById(oid(req.params.id, 'Job')).lean();
  if (!job) throw notFound('Capture not found');
  await shaPatient(req, String(job.patientId));
  res.json({ success: true, data: job });
}));

/** For a callback believed missed: one reconciliation read of a match (documented as not for polling). */
router.post('/biometrics/jobs/:id/reconcile', requirePermission('sha.authorization'), h(async (req, res) => {
  const job = await req.tenant!.models.ShaBiometricJob.findById(oid(req.params.id, 'Job'));
  if (!job) throw notFound('Capture not found');
  await shaPatient(req, String(job.patientId));
  res.json({ success: true, data: await reconcileJob(req, job) });
}));

/* ------------------------------------------------------------------ OTP whitelist requests */
export const WHITELIST_REASONS = ['BIOMETRIC_FAILURE', 'CHILD_BELOW_7_YEARS', 'AMPUTEE', 'OLD', 'MEDICAL_CONDITION', 'MENTALLY_UNSTABLE', 'EXPIRED', 'OTHER'] as const;

router.get('/otp-whitelists', requireAnyPermission('sha.view', 'sha.authorization'), h(async (req, res) => {
  const m = req.tenant!.models;
  const p = await shaPatient(req, req.query.patientId);
  // Refresh statuses from SHA (by beneficiary), then return our records with SHA's latest review.
  if (req.query.sync !== 'false') {
    try {
      const r = await hieRequest('sha', ctx(req), { operation: 'sha.otpWhitelist.list', query: { beneficiary_cr_id: p.clientRegistryId! } });
      const results = isObj(r.data) && Array.isArray(r.data.results) ? (r.data.results as unknown[]).filter(isObj) : [];
      for (const x of results) {
        const guid = pick(x, 'guid');
        if (!guid) continue;
        const notes = Array.isArray(x.reviewerResponseNotes) ? (x.reviewerResponseNotes as unknown[]).map((n) => (isObj(n) ? String(n.responseNotes ?? '') : String(n))).filter(Boolean) : [];
        await m.ShaOtpWhitelist.updateOne(
          { patientId: p._id, guid },
          { $set: { status: pick(x, 'status'), reviewerNotes: notes, reviewedBy: pick(x, 'reviewedByUser'), lastSyncedAt: new Date() }, $setOnInsert: { beneficiaryCrId: p.clientRegistryId, reasonType: pick(x, 'reasonType'), reason: pick(x, 'reason'), biometricAttempts: Number(x.biometricsAttempt ?? 0) || undefined } },
          { upsert: true },
        );
      }
    } catch (err) {
      if (!(err instanceof AppError) || !/NOT_CONFIGURED|UNREACHABLE|UNAVAILABLE/.test(err.code)) throw err;
    }
  }
  const rows = await m.ShaOtpWhitelist.find({ patientId: p._id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: rows });
}));

router.post('/otp-whitelists', requirePermission('sha.authorization'), h(async (req, res) => {
  const body = parse(z.object({
    patientId: z.string(),
    reasonType: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/),
    reason: z.string().trim().min(10).max(1000),
    biometricAttempts: z.number().int().min(0).max(100).optional(),
    attachments: z.array(z.object({ documentId: z.string(), documentType: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/).default('MEDICAL_REPORT'), title: z.string().trim().max(120).optional() })).max(5).default([]),
  }), req.body);
  const m = req.tenant!.models;
  const p = await shaPatient(req, body.patientId);
  const docs = await m.Document.find({ _id: { $in: body.attachments.map((a) => oid(a.documentId, 'Document')) }, patientId: p._id, deletedAt: null }).select('+storageKey').lean();
  if (docs.length !== body.attachments.length) throw badRequest('Some documents were not found for this patient');
  const tenant = await meta().Tenant.findById(req.tenant!.id).select('dhaRegistry').lean();
  const fr = tenant?.dhaRegistry?.facilityRegistryCode;
  const form = new FormData();
  form.set('beneficiary_cr_id', p.clientRegistryId!);
  form.set('reason_type', body.reasonType);
  form.set('reason', body.reason);
  if (body.biometricAttempts !== undefined) form.set('biometric_attempts', String(body.biometricAttempts));
  if (fr) form.set('facility_fr_code', fr);
  // attachments: JSON metadata, each entry naming the multipart field that carries its file.
  const attachmentMeta = body.attachments.map((a, i) => ({ document_title: a.title || docs.find((d) => String(d._id) === a.documentId)?.fileName || `Document ${i + 1}`, document_type: a.documentType, file_field_name: `attachment_${i + 1}` }));
  if (attachmentMeta.length) form.set('attachments', JSON.stringify(attachmentMeta));
  for (const [i, a] of body.attachments.entries()) {
    const d = docs.find((x) => String(x._id) === a.documentId)!;
    form.append(`attachment_${i + 1}`, new Blob([new Uint8Array(await localStorageDriver.read(d.storageKey))], { type: d.mimeType ?? 'application/octet-stream' }), d.fileName ?? `document-${i + 1}`);
  }
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.otpWhitelist.create', body: form, idempotencyKey: `otpwl:${p._id}:${Date.now()}` });
  const o = isObj(r.data) ? r.data : {};
  const row = await m.ShaOtpWhitelist.create({
    patientId: p._id, beneficiaryCrId: p.clientRegistryId!, guid: pick(o, 'guid') ?? undefined, reasonType: body.reasonType, reason: body.reason,
    biometricAttempts: body.biometricAttempts, documentIds: docs.map((d) => d._id), status: pick(o, 'status') ?? 'PENDING', lastSyncedAt: new Date(),
    requestedBy: req.user!.id, requestedByName: req.user!.name,
  });
  await audit(req, { action: 'sha.otp_whitelist.request', resource: 'patient', resourceId: String(p._id), newValue: { reasonType: body.reasonType, attachments: docs.length, guid: row.guid } });
  res.status(201).json({ success: true, data: row });
}));

export default router;
