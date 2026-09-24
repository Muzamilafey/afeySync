import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import type { Request } from 'express';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { AppError, badRequest, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { assertBranchAccess, branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { SHABenefitsService, SHAEligibilityService, DHAFacilityRegistryService, HIE_IDENTIFICATION_TYPES } from '../../integrations/hie/services';
import { integrationStatusForTenant } from '../integrations/integrationConfigService';
import { meta } from '../../models/meta';
import { nextSequence } from '../../models/tenant';
import { randomToken, sha256 } from '../../utils/crypto';
import { env } from '../../config/env';
import { IntegrationSecretService } from '../integrations/secretService';

const router = Router();
router.use(authenticateTenant);

const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });

async function accessiblePatient(req: Request, id: string) {
  if (!isValidObjectId(id)) throw notFound('Patient not found');
  const p = await req.tenant!.models.Patient.findById(id).lean();
  if (!p) throw notFound('Patient not found');
  if (!canAccessAnyBranch(req, p.branchIds ?? [])) throw forbidden('This patient is not registered in your branch', 'BRANCH_FORBIDDEN');
  return p;
}

/** ClientRegistry ID is preferred for eligibility; other identifiers are fallbacks (per HIE docs). */
function bestIdentifier(p: { clientRegistryId?: string | null; nationalId?: string | null; identifiers?: Array<{ type: string; value: string }> }) {
  if (p.clientRegistryId) return { type: 'ClientRegistry ID', number: p.clientRegistryId };
  if (p.nationalId) return { type: 'National ID', number: p.nationalId };
  const id = (p.identifiers ?? []).find((i) => (HIE_IDENTIFICATION_TYPES as readonly string[]).includes(i.type));
  return id ? { type: id.type, number: id.value } : null;
}

const hiePatientId = (p: { clientRegistryId?: string | null }) => {
  if (!p.clientRegistryId) throw new AppError(422, 'CR_ID_REQUIRED', 'This patient has no Client Registry ID. Search/import the patient from the DHA Client Registry first.');
  return p.clientRegistryId;
};

router.get(
  '/status',
  requirePermission('sha.view'),
  h(async (req, res) => {
    res.json({ success: true, data: (await integrationStatusForTenant(req.tenant!.id)).sha });
  }),
);

/* ---------------- Eligibility */
router.post(
  '/eligibility',
  requirePermission('sha.eligibility'),
  h(async (req, res) => {
    const body = parse(
      z.union([
        z.object({ patientId: z.string() }),
        z.object({ identificationType: z.enum(HIE_IDENTIFICATION_TYPES), identificationNumber: z.string().trim().min(3).max(40) }),
      ]),
      req.body,
    );
    let patient = null;
    let ident: { type: string; number: string } | null;
    if ('patientId' in body) {
      patient = await accessiblePatient(req, body.patientId);
      ident = bestIdentifier(patient);
      if (!ident) throw badRequest('Patient has no identifier usable for SHA eligibility');
    } else ident = { type: body.identificationType, number: body.identificationNumber };

    const { ShaEligibilityCheck, Patient } = req.tenant!.models;
    const masked = ident.number.length > 4 ? `${'*'.repeat(ident.number.length - 4)}${ident.number.slice(-4)}` : '****';
    try {
      const result = await SHAEligibilityService.check(ctx(req), ident.type, ident.number);
      const status = result.eligible === true ? 'eligible' : result.eligible === false ? 'not_eligible' : 'error';
      const check = await ShaEligibilityCheck.create({
        patientId: patient?._id,
        branchId: req.branch?.id,
        identificationType: ident.type,
        identificationNumberMasked: masked,
        eligible: result.eligible ?? undefined,
        status,
        summary: { statusText: result.statusText, memberName: result.memberName, clientRegistryId: result.clientRegistryId, scheme: result.scheme, reason: result.reason },
        raw: result.raw,
        checkedBy: req.user!.id,
      });
      if (patient) await Patient.updateOne({ _id: patient._id }, { 'sha.status': status, 'sha.lastCheckedAt': new Date(), 'sha.lastCheckId': check._id });
      await audit(req, { action: 'sha.eligibility.check', resource: 'patient', resourceId: patient ? String(patient._id) : null, newValue: { identificationType: ident.type, status } });
      res.json({ success: true, data: { id: check._id, status, eligible: result.eligible, identificationType: ident.type, ...check.summary, raw: result.raw, checkedAt: check.createdAt } });
    } catch (err) {
      await audit(req, { action: 'sha.eligibility.check', resource: 'patient', resourceId: patient ? String(patient._id) : null, newValue: { identificationType: ident.type, error: (err as AppError).code }, result: 'failure' });
      throw err;
    }
  }),
);

router.get(
  '/eligibility/history',
  requirePermission('sha.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.patientId) {
      const p = await accessiblePatient(req, String(req.query.patientId));
      filter.patientId = p._id;
      delete filter.branchId;
    }
    const items = await req.tenant!.models.ShaEligibilityCheck.find(filter).select('-raw').sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, data: items });
  }),
);

/* ---------------- Benefits / Interventions / Utilization */
router.get(
  '/benefits',
  requirePermission('sha.eligibility'),
  h(async (req, res) => {
    const p = await accessiblePatient(req, String(req.query.patientId ?? ''));
    const data = await SHABenefitsService.benefits(ctx(req), hiePatientId(p), { page: req.query.page, page_size: req.query.page_size });
    await audit(req, { action: 'sha.benefits.view', resource: 'patient', resourceId: String(p._id) });
    res.json({ success: true, data });
  }),
);

router.get(
  '/interventions',
  requirePermission('sha.eligibility'),
  h(async (req, res) => {
    const p = await accessiblePatient(req, String(req.query.patientId ?? ''));
    const data = await SHABenefitsService.interventions(ctx(req), hiePatientId(p), req.query as Record<string, unknown>);
    res.json({ success: true, data });
  }),
);

router.get(
  '/utilization',
  requirePermission('sha.eligibility'),
  h(async (req, res) => {
    const p = await accessiblePatient(req, String(req.query.patientId ?? ''));
    const code = String(req.query.interventionCode ?? '');
    if (!/^[A-Za-z0-9\-_.]{2,40}$/.test(code)) throw badRequest('interventionCode is required');
    const data = await SHABenefitsService.utilization(ctx(req), hiePatientId(p), code);
    await audit(req, { action: 'sha.utilization.view', resource: 'patient', resourceId: String(p._id), newValue: { interventionCode: code } });
    res.json({ success: true, data });
  }),
);

router.get(
  '/facility/beds-occupancy',
  requirePermission('sha.view'),
  h(async (req, res) => {
    const t = await meta().Tenant.findById(req.tenant!.id).select('dhaRegistry facilityCode').lean();
    const code = String(req.query.facilityCode || t?.dhaRegistry?.facilityRegistryCode || t?.facilityCode || '');
    if (!code) throw badRequest('Facility registry code is not configured for this facility');
    res.json({ success: true, data: await DHAFacilityRegistryService.bedOccupancy(ctx(req), code) });
  }),
);

/* ---------------- Authorizations / preauths / claims: local workflow records.
   Submission to the HIE requires the corresponding contract operation to be configured by the owner. */
const txKinds = ['authorization', 'visit_consent', 'preauthorization', 'claim', 'emergency_claim'] as const;
const txPermission: Record<(typeof txKinds)[number], string> = {
  authorization: 'sha.authorization',
  visit_consent: 'sha.authorization',
  preauthorization: 'sha.preauthorization',
  claim: 'sha.claim',
  emergency_claim: 'sha.claim',
};

router.get(
  '/transactions',
  requirePermission('sha.view'),
  h(async (req, res) => {
    const { ShaTransaction } = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.kind) filter.kind = String(req.query.kind);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) filter.reference = String(req.query.q).toUpperCase();
    const [items, total, counts] = await Promise.all([
      ShaTransaction.find(filter).select('-requestPayload -lastResponse').populate('patientId', 'patientNumber firstName lastName clientRegistryId').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      ShaTransaction.countDocuments(filter),
      ShaTransaction.aggregate([{ $match: { ...filter, status: { $exists: true } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total, counts: Object.fromEntries(counts.map((c) => [c._id, c.count])) } });
  }),
);

router.post(
  '/transactions',
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        kind: z.enum(txKinds),
        patientId: z.string(),
        benefitCode: z.string().max(60).optional(),
        interventionCode: z.string().max(60).optional(),
        accessPoint: z.string().max(20).optional(),
        diagnoses: z.array(z.object({ code: z.string().max(30), display: z.string().max(200).optional(), system: z.string().max(100).optional() })).max(20).default([]),
        lines: z.array(z.object({ serviceCode: z.string().max(40), description: z.string().max(200), quantity: z.number().positive(), unitPrice: z.number().min(0) })).max(100).default([]),
        clinicalJustification: z.string().max(4000).optional(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      }),
      req.body,
    );
    if (!req.permissions!.has(txPermission[body.kind])) throw forbidden(`Missing permission: ${txPermission[body.kind]}`);
    const p = await accessiblePatient(req, body.patientId);
    const { ShaTransaction } = req.tenant!.models;
    const idempotencyKey = body.idempotencyKey ?? randomToken(16);
    const existing = await ShaTransaction.findOne({ idempotencyKey }).lean();
    if (existing) return res.status(200).json({ success: true, data: existing, idempotentReplay: true });
    const prefix = { authorization: 'AUT', visit_consent: 'VIS', preauthorization: 'PRE', claim: 'CLM', emergency_claim: 'EMC' }[body.kind];
    const seq = await nextSequence(req.tenant!.models, `sha_${body.kind}`);
    const lines = body.lines.map((l) => ({ ...l, amount: Math.round(l.quantity * l.unitPrice * 100) / 100 }));
    const tx = await ShaTransaction.create({
      ...body,
      lines,
      idempotencyKey,
      reference: `SHA-${prefix}-${String(seq).padStart(6, '0')}`,
      patientId: p._id,
      branchId: req.branch!.id,
      amounts: { claimed: lines.reduce((s, l) => s + l.amount, 0) },
      status: 'draft',
      statusHistory: [{ status: 'draft', at: new Date(), source: 'user' }],
      createdBy: req.user!.id,
    });
    await audit(req, { action: `sha.${body.kind}.draft`, resource: 'sha_transaction', resourceId: String(tx._id), newValue: { reference: tx.reference } });
    res.status(201).json({ success: true, data: tx });
  }),
);

router.get(
  '/transactions/:id',
  requirePermission('sha.view'),
  h(async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound();
    const tx = await req.tenant!.models.ShaTransaction.findById(req.params.id).populate('patientId', 'patientNumber firstName lastName clientRegistryId gender dateOfBirth sha').lean();
    if (!tx) throw notFound('Transaction not found');
    assertBranchAccess(req, tx.branchId);
    res.json({ success: true, data: tx });
  }),
);

/* ---------------- Status callback endpoint management (per facility) */
router.get(
  '/callback-endpoints',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const items = await meta().CallbackEndpoint.find({ tenantId: req.tenant!.id }).select('-tokenHash -hmacSecret').lean();
    res.json({ success: true, data: items });
  }),
);

router.post(
  '/callback-endpoints',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const body = parse(z.object({ provider: z.enum(['sha', 'dha']).default('sha'), hmacHeader: z.string().max(60).optional(), hmacSecret: z.string().min(16).max(200).optional() }), req.body ?? {});
    const token = randomToken(32);
    const ep = await meta().CallbackEndpoint.create({
      provider: body.provider,
      tenantId: req.tenant!.id,
      tokenHash: sha256(token),
      hmacHeader: body.hmacHeader?.toLowerCase(),
      hmacSecret: body.hmacSecret ? IntegrationSecretService.encrypt(body.hmacSecret) : undefined,
      active: true,
    });
    await audit(req, { action: 'callback.endpoint_create', resource: 'callback_endpoint', resourceId: String(ep._id) });
    // The full URL (containing the secret token) is shown exactly once.
    res.status(201).json({ success: true, data: { id: ep._id, url: `${env.API_URL.replace(/\/$/, '')}/api/v1/${body.provider}/callbacks/${token}` } });
  }),
);

router.get(
  '/callback-events',
  requirePermission('sha.view'),
  h(async (req, res) => {
    const items = await meta().CallbackEvent.find({ tenantId: req.tenant!.id }).select('-payload -sourceIp').sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: items });
  }),
);

export default router;
