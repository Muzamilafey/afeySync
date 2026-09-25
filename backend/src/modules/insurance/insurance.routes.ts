import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch, canAccessBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, oid, round2 } from '../common/helpers';
import { nextSequence, type TenantModels } from '../../models/tenant';
import { IntegrationSecretService } from '../integrations/secretService';
import { localStorageDriver } from '../documents/storage';
import { completePayment, recalcInvoice } from '../billing/billingService';
import { sladeConfig, sladeToken } from '../../integrations/slade360/sladeClient';
import { meta } from '../../models/meta';
import { getAdapter, registeredProviders } from './adapters/registry';
import type { AdapterCtx, EligibilityResult, RemittanceRecord } from './adapters/types';

/**
 * Private insurance through the provider-neutral adapter layer (Slade360 first). Credentials never reach the
 * browser; every call is made by the backend with the facility's own integration configuration.
 */
const router = Router();
router.use(authenticateTenant);

type M = TenantModels;
type Coverage = NonNullable<Awaited<ReturnType<M['InsuranceCoverage']['findOne']>>>;
type Visit = NonNullable<Awaited<ReturnType<M['InsuranceVisit']['findOne']>>>;
type Claim = NonNullable<Awaited<ReturnType<M['InsuranceClaim']['findOne']>>>;
const ctx = (req: Request): AdapterCtx => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });

const SLADE_SANDBOX_PAYERS: Array<[string, string]> = [
  ['457', 'Jubilee Health Insurance Limited'],
  ['2001', 'APA Insurance Company'],
  ['2011', 'Madison General Insurance Kenya'],
  ['2002', 'Britam General Insurance'],
  ['2020', 'Minet Insurance Brokers Limited'],
  ['2023', 'Savannah Informatics Insurance Scheme'],
  ['2022', 'GNRSH Insurance Scheme'],
];

async function sladeStatus(tenantId: string) {
  try {
    const cfg = await sladeConfig(tenantId);
    return { configured: true, environment: cfg.environment };
  } catch (err) {
    return { configured: false, reason: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ Providers & connection */
router.get('/providers', requirePermission('insurance.view'), h(async (req, res) => {
  res.json({ success: true, data: { adapters: registeredProviders(), slade360: await sladeStatus(req.tenant!.id) } });
}));

router.post('/slade360/test-connection', requirePermission('admin.integrations'), h(async (req, res) => {
  const cfg = await sladeConfig(req.tenant!.id);
  await sladeToken(cfg, ctx(req), true);
  await meta().IntegrationConfig.updateOne({ _id: cfg.configId }, { 'health.status': 'connected', 'health.lastTestAt': new Date(), 'health.lastSuccessAt': new Date() });
  await audit(req, { action: 'insurance.slade360.test', resource: 'integration', resourceId: 'slade360' });
  res.json({ success: true, data: { status: 'CONNECTED', environment: cfg.environment } });
}));

/* ------------------------------------------------------------------ Payer directory */
router.get('/payers', requirePermission('insurance.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.enabled === 'true') Object.assign(filter, { enabled: true, supported: true });
  res.json({ success: true, data: await req.tenant!.models.InsurancePayer.find(filter).sort({ name: 1 }).lean() });
}));

const payerSchema = z.object({ providerType: z.enum(['SLADE360', 'DIRECT_INSURER', 'OTHER']).default('SLADE360'), sladeCode: z.string().trim().max(20).optional(), name: z.string().min(2).max(160), displayName: z.string().max(160).optional(), enabled: z.boolean().default(false), supported: z.boolean().default(false), environment: z.enum(['sandbox', 'production']).optional(), notes: z.string().max(500).optional() });
router.post('/payers', requireAnyPermission('insurance.manage', 'admin.integrations'), h(async (req, res) => {
  const body = parse(payerSchema, req.body);
  if (body.providerType === 'SLADE360' && !body.sladeCode) throw badRequest('payer_slade_code is required for Slade360 payers');
  const p = await req.tenant!.models.InsurancePayer.create(body);
  await audit(req, { action: 'insurance.payer_create', resource: 'insurance_payer', resourceId: String(p._id), newValue: body });
  res.status(201).json({ success: true, data: p });
}));
router.patch('/payers/:id', requireAnyPermission('insurance.manage', 'admin.integrations'), h(async (req, res) => {
  const body = parse(payerSchema.partial(), req.body);
  const p = await req.tenant!.models.InsurancePayer.findById(oid(req.params.id, 'Payer'));
  if (!p) throw notFound('Payer not found');
  const before = p.toObject();
  p.set(body);
  await p.save();
  await audit(req, { action: 'insurance.payer_update', resource: 'insurance_payer', resourceId: String(p._id), oldValue: before, newValue: body });
  res.json({ success: true, data: p });
}));
/** Adds the Slade360 sandbox example payers (disabled) — not a production payer list. */
router.post('/payers/sandbox-examples', requireAnyPermission('insurance.manage', 'admin.integrations'), h(async (req, res) => {
  const m = req.tenant!.models;
  let added = 0;
  for (const [code, name] of SLADE_SANDBOX_PAYERS) {
    const r = await m.InsurancePayer.updateOne({ providerType: 'SLADE360', sladeCode: code }, { $setOnInsert: { providerType: 'SLADE360', sladeCode: code, name, enabled: false, supported: false, environment: 'sandbox', notes: 'Slade360 sandbox example payer' } }, { upsert: true });
    added += r.upsertedCount;
  }
  res.json({ success: true, data: { added } });
}));

/* ------------------------------------------------------------------ Diagnosis code mappings (e.g. ICD-11 → ICD-10) */
router.get('/code-maps', requirePermission('insurance.view'), h(async (req, res) => {
  res.json({ success: true, data: await req.tenant!.models.DiagnosisCodeMap.find({}).sort({ sourceCode: 1 }).limit(1000).lean() });
}));
router.post('/code-maps', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ sourceSystem: z.string().min(3).max(20), sourceCode: z.string().min(2).max(30), targetSystem: z.literal('ICD-10'), targetCode: z.string().regex(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/, 'Enter a valid ICD-10 code'), description: z.string().max(200).optional(), reference: z.string().max(300).optional() }), req.body);
  const r = await req.tenant!.models.DiagnosisCodeMap.findOneAndUpdate({ sourceSystem: body.sourceSystem, sourceCode: body.sourceCode, targetSystem: body.targetSystem }, { ...body, createdBy: req.user!.id }, { upsert: true, returnDocument: 'after' });
  await audit(req, { action: 'insurance.code_map', resource: 'code_map', resourceId: String(r._id), newValue: body });
  res.status(201).json({ success: true, data: r });
}));

/* ------------------------------------------------------------------ Patient coverages */
async function loadPatient(req: Request, id: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}
async function loadCoverage(req: Request, id: unknown) {
  const c = await req.tenant!.models.InsuranceCoverage.findById(oid(id, 'Coverage'));
  if (!c) throw notFound('Coverage not found');
  await loadPatient(req, String(c.patientId));
  return c;
}
const coverageHistory = (c: Coverage, req: Request, action: string, changes?: unknown) => c.history.push({ at: new Date(), action, by: req.user!.id as never, byName: req.user!.name, changes: changes as never });

router.get('/coverages', requirePermission('insurance.view'), h(async (req, res) => {
  const p = await loadPatient(req, req.query.patientId);
  res.json({ success: true, data: await req.tenant!.models.InsuranceCoverage.find({ patientId: p._id }).sort({ isActive: -1, updatedAt: -1 }).lean() });
}));

const coverageSchema = z.object({
  patientId: z.string(),
  providerType: z.enum(['SLADE360', 'DIRECT_INSURER', 'OTHER']).default('SLADE360'),
  payerId: z.string().optional(),
  payerName: z.string().max(160).optional(),
  memberNumber: z.string().trim().min(2).max(60),
  schemeName: z.string().max(160).optional(),
  schemeCode: z.string().max(60).optional(),
  policyNumber: z.string().max(80).optional(),
  principalMember: z.boolean().default(true),
  principalMemberName: z.string().max(160).optional(),
  relationship: z.string().max(40).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
});
router.post('/coverages', requirePermission('insurance.eligibility'), h(async (req, res) => {
  const body = parse(coverageSchema, req.body);
  const m = req.tenant!.models;
  const p = await loadPatient(req, body.patientId);
  let payer = null;
  if (body.payerId) {
    payer = await m.InsurancePayer.findById(oid(body.payerId, 'Payer')).lean();
    if (!payer) throw badRequest('Payer not found');
    if (body.providerType === 'SLADE360' && (!payer.enabled || !payer.supported)) throw new AppError(422, 'PAYER_NOT_AVAILABLE', `${payer.name} is not enabled for this facility`);
  }
  if (!payer && !body.payerName) throw badRequest('Select a payer');
  const dup = await m.InsuranceCoverage.exists({ patientId: p._id, memberNumber: body.memberNumber, payerSladeCode: payer?.sladeCode, isActive: true });
  if (dup) throw conflict('This cover is already on the patient', undefined, 'COVERAGE_EXISTS');
  const c = await m.InsuranceCoverage.create({ ...body, patientId: p._id, payerId: payer?._id, payerName: payer?.displayName ?? payer?.name ?? body.payerName, payerSladeCode: payer?.sladeCode, providerType: payer?.providerType ?? body.providerType, history: [{ at: new Date(), action: 'created', by: req.user!.id, byName: req.user!.name }], createdBy: req.user!.id });
  await audit(req, { action: 'insurance.coverage_create', resource: 'insurance_coverage', resourceId: String(c._id), newValue: { payer: c.payerName, memberNumber: c.memberNumber } });
  res.status(201).json({ success: true, data: c });
}));

router.patch('/coverages/:id', requirePermission('insurance.eligibility'), h(async (req, res) => {
  const body = parse(coverageSchema.omit({ patientId: true, payerId: true, providerType: true }).partial(), req.body);
  const c = await loadCoverage(req, req.params.id);
  const changes = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, { from: (c as unknown as Record<string, unknown>)[k], to: v }]));
  c.set(body);
  coverageHistory(c, req, 'updated', changes);
  await c.save();
  await audit(req, { action: 'insurance.coverage_update', resource: 'insurance_coverage', resourceId: String(c._id), newValue: changes });
  res.json({ success: true, data: c });
}));

router.post('/coverages/:id/deactivate', requirePermission('insurance.eligibility'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
  const c = await loadCoverage(req, req.params.id);
  c.isActive = false;
  coverageHistory(c, req, 'deactivated', { reason });
  await c.save();
  res.json({ success: true, data: c });
}));

function applyEligibility(c: Coverage, r: EligibilityResult) {
  c.set({
    lastEligibilityCheck: new Date(),
    eligibilityStatus: r.eligible === true ? 'eligible' : r.eligible === false ? 'not_eligible' : 'unknown',
    beneficiaryId: r.member.beneficiaryId ?? c.beneficiaryId,
    schemeName: r.cover.schemeName ?? c.schemeName,
    schemeCode: r.cover.schemeCode ?? c.schemeCode,
    policyNumber: r.cover.policyNumber ?? c.policyNumber,
    policyEffectiveDate: r.cover.policyEffectiveDate ?? c.policyEffectiveDate,
    validFrom: r.cover.validFrom ? new Date(r.cover.validFrom) : c.validFrom,
    validTo: r.cover.validTo ? new Date(r.cover.validTo) : c.validTo,
    benefits: r.benefits,
    copay: r.benefits.filter((b) => b.copay !== undefined).map((b) => ({ benefit: b.code ?? b.name, copay: b.copay })),
    panelStatus: r.panelStatus,
    contacts: r.contacts,
    restrictions: r.restrictions,
    rawEligibilityReference: r.rawReference,
  });
}

router.post('/coverages/:id/eligibility', requirePermission('insurance.eligibility'), h(async (req, res) => {
  const c = await loadCoverage(req, req.params.id);
  if (!c.payerSladeCode && c.providerType === 'SLADE360') throw badRequest('This cover has no Slade360 payer code');
  const adapter = getAdapter(c.providerType);
  try {
    const r = await adapter.checkEligibility(ctx(req), { payerCode: c.payerSladeCode ?? '', memberNumber: c.memberNumber });
    applyEligibility(c, r);
    coverageHistory(c, req, 'eligibility_checked', { status: c.eligibilityStatus });
    await c.save();
    await req.tenant!.models.InsurancePayer.updateOne({ _id: c.payerId }, { lastActivityAt: new Date() });
    await audit(req, { action: 'insurance.eligibility', resource: 'insurance_coverage', resourceId: String(c._id), newValue: { status: c.eligibilityStatus } });
    const { rawReference: _r, ...out } = r;
    res.json({ success: true, data: { coverage: c, result: out } });
  } catch (err) {
    c.eligibilityStatus = 'error';
    c.lastEligibilityCheck = new Date();
    await c.save();
    throw err;
  }
}));

/** Ad-hoc eligibility (e.g. during registration, before a cover is saved). */
router.get(['/eligibility', '/slade360/eligibility'], requirePermission('insurance.eligibility'), h(async (req, res) => {
  const q = parse(z.object({ payerSladeCode: z.string().min(1).max(20), memberNumber: z.string().min(2).max(60) }), req.query);
  const payer = await req.tenant!.models.InsurancePayer.findOne({ providerType: 'SLADE360', sladeCode: q.payerSladeCode }).lean();
  if (!payer?.enabled || !payer.supported) throw new AppError(422, 'PAYER_NOT_AVAILABLE', 'This payer is not enabled for this facility');
  const r = await getAdapter('SLADE360').checkEligibility(ctx(req), { payerCode: q.payerSladeCode, memberNumber: q.memberNumber });
  await audit(req, { action: 'insurance.eligibility', resource: 'insurance_payer', resourceId: String(payer._id), newValue: { memberNumber: q.memberNumber, eligible: r.eligible } });
  const { rawReference: _r, ...out } = r;
  res.json({ success: true, data: out });
}));

router.post(['/coverages/:id/request-otp'], requirePermission('insurance.eligibility'), h(async (req, res) => {
  const { contactId } = parse(z.object({ contactId: z.string().min(1).max(80) }), req.body);
  const c = await loadCoverage(req, req.params.id);
  if (!c.contacts?.some((x) => x.id === contactId)) throw badRequest('Choose one of the contacts returned by the eligibility check');
  await getAdapter(c.providerType).requestOtp(ctx(req), { contactId });
  coverageHistory(c, req, 'otp_requested');
  await c.save();
  await audit(req, { action: 'insurance.otp_requested', resource: 'insurance_coverage', resourceId: String(c._id) });
  res.json({ success: true, data: { sent: true } });
}));

/* ------------------------------------------------------------------ Insurance visits */
const visitHistory = (v: Visit, req: Request, action: string, note?: string) => v.history.push({ at: new Date(), action, by: req.user!.id as never, byName: req.user!.name, note });
async function loadVisit(req: Request, id: unknown, withToken = false) {
  const q = req.tenant!.models.InsuranceVisit.findById(oid(id, 'Insurance visit'));
  if (withToken) q.select('+authorizationToken');
  const v = await q;
  if (!v || !canAccessBranch(req, v.branchId)) throw notFound('Insurance visit not found');
  return v;
}

router.get('/visits', requirePermission('insurance.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = { ...branchFilter(req) };
  if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
  if (req.query.status) filter.status = String(req.query.status);
  res.json({ success: true, data: await req.tenant!.models.InsuranceVisit.find(filter).populate('patientId', 'patientNumber firstName lastName').sort({ createdAt: -1 }).limit(200).lean() });
}));
router.get('/visits/:id', requirePermission('insurance.view'), h(async (req, res) => {
  const v = await req.tenant!.models.InsuranceVisit.findById(oid(req.params.id, 'Insurance visit')).populate('patientId', 'patientNumber firstName lastName phone').populate('coverageId').lean();
  if (!v || !canAccessBranch(req, v.branchId)) throw notFound('Insurance visit not found');
  res.json({ success: true, data: v });
}));

router.post(['/visits', '/slade360/start-visit'], requirePermission('insurance.eligibility'), requireBranch, h(async (req, res) => {
  const body = parse(z.object({ coverageId: z.string(), localVisitId: z.string().optional(), method: z.enum(['otp', 'fingerprint', 'guardian']), otp: z.string().regex(/^\d{4,8}$/).optional(), contactId: z.string().max(80).optional(), benefitCode: z.string().max(60).optional(), benefitType: z.string().max(60).optional(), visitType: z.string().max(40).optional() }), req.body);
  const m = req.tenant!.models;
  const c = await loadCoverage(req, body.coverageId);
  if (!c.isActive) throw conflict('This cover is not active', undefined, 'COVERAGE_INACTIVE');
  if (c.eligibilityStatus !== 'eligible' || !c.lastEligibilityCheck || Date.now() - c.lastEligibilityCheck.getTime() > 24 * 3600_000) throw new AppError(422, 'INSURANCE_ELIGIBILITY_REQUIRED', 'Check eligibility (within the last 24 hours) before starting an insurance visit.');
  if (!c.beneficiaryId) throw new AppError(422, 'BENEFICIARY_UNKNOWN', 'The eligibility response did not identify the beneficiary');
  const cfg = await sladeConfig(req.tenant!.id);
  const factor = { otp: cfg.settings.factorOtp, fingerprint: cfg.settings.factorFingerprint, guardian: cfg.settings.factorGuardian }[body.method];
  if (!factor) throw new AppError(422, 'SLADE_FACTOR_NOT_CONFIGURED', body.method === 'otp' ? 'The Slade360 OTP factor value has not been configured (Admin → Integrations → Slade360, from the official documentation).' : `${body.method} authentication is not available at this facility.`);
  if (body.method === 'otp' && (!body.otp || !body.contactId)) throw badRequest('OTP and the contact used are required');
  const seq = await nextSequence(m, 'insurance_visit');
  const v = await m.InsuranceVisit.create({
    reference: `INS-VST-${String(seq).padStart(6, '0')}`, branchId: req.branch!.id, patientId: c.patientId, coverageId: c._id, localVisitId: body.localVisitId ? oid(body.localVisitId, 'Visit') : undefined,
    providerType: c.providerType, payer: c.payerName, payerSladeCode: c.payerSladeCode, memberNumber: c.memberNumber, beneficiaryId: c.beneficiaryId,
    scheme: { name: c.schemeName, code: c.schemeCode }, benefit: { code: body.benefitCode, type: body.benefitType }, authenticationMethod: body.method, visitType: body.visitType,
    status: 'AUTHENTICATING', history: [{ at: new Date(), action: 'created', by: req.user!.id, byName: req.user!.name }], createdBy: req.user!.id,
  });
  try {
    const r = await getAdapter(c.providerType).startVisit(ctx(req), { beneficiaryId: c.beneficiaryId, factors: [factor], benefitType: body.benefitType, benefitCode: body.benefitCode, policyNumber: c.policyNumber ?? undefined, policyEffectiveDate: c.policyEffectiveDate ?? undefined, otp: body.otp, beneficiaryContact: body.contactId, schemeName: c.schemeName ?? undefined, schemeCode: c.schemeCode ?? undefined });
    v.set({ authorizationId: r.authorizationId, ediAuthGuid: r.ediAuthGuid, visitNumber: r.visitNumber, visitStart: r.visitStart, authorizationStatus: r.status, authorizationTokenReference: r.authorizationToken ? `…${r.authorizationToken.slice(-4)}` : undefined, lastResponse: r.raw, status: 'VISIT_STARTED' });
    if (r.authorizationToken) v.authorizationToken = IntegrationSecretService.encrypt(r.authorizationToken) as never;
    visitHistory(v, req, 'visit_started', r.visitNumber);
    await v.save();
  } catch (err) {
    v.status = 'REJECTED';
    visitHistory(v, req, 'start_failed', (err as Error).message.slice(0, 200));
    await v.save();
    throw err;
  }
  await audit(req, { action: 'insurance.visit_start', resource: 'insurance_visit', resourceId: String(v._id), newValue: { payer: v.payer, visitNumber: v.visitNumber, method: body.method } });
  const out = v.toObject() as unknown as Record<string, unknown>;
  delete out.authorizationToken;
  res.status(201).json({ success: true, data: out });
}));

router.post('/visits/:id/validate-authorization', requirePermission('insurance.eligibility'), h(async (req, res) => {
  const v = await loadVisit(req, req.params.id, true);
  const p = await req.tenant!.models.Patient.findById(v.patientId).select('firstName lastName middleName').lean();
  if (!v.authorizationToken?.ciphertext) throw conflict('No authorization token for this visit', undefined, 'NO_AUTH_TOKEN');
  const data = await getAdapter(v.providerType).validateAuthorization(ctx(req), { first_name: p?.firstName, last_name: p?.lastName, other_names: p?.middleName ?? undefined, member_number: v.memberNumber ?? undefined, auth_token: IntegrationSecretService.decrypt(v.authorizationToken.ciphertext), visit_type: v.visitType ?? undefined, scheme_code: v.scheme?.code ?? undefined, scheme_name: v.scheme?.name ?? undefined, payer_code: v.payerSladeCode ?? undefined });
  v.status = v.status === 'VISIT_STARTED' ? 'AUTHORIZED' : v.status;
  visitHistory(v, req, 'authorization_validated');
  await v.save();
  res.json({ success: true, data: { status: v.status, response: data } });
}));

router.post('/visits/:id/reserve', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ invoiceId: z.string(), amount: z.number().positive().max(100_000_000) }), req.body);
  const m = req.tenant!.models;
  const inv = await loadScoped(req, m.Invoice, body.invoiceId, 'Invoice');
  const v = await loadVisit(req, req.params.id);
  if (String(inv.patientId) !== String(v.patientId)) throw badRequest('Invoice belongs to another patient');
  if (!v.authorizationId) throw conflict('Start the visit first', undefined, 'NO_AUTHORIZATION');
  // A unique lock document makes the reservation one-shot even under concurrent clicks.
  const lockKey = `reserve:${v._id}`;
  try {
    await m.OperationLock.create({ key: lockKey, by: req.user!.id });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('A benefit reservation already exists for this visit', undefined, 'RESERVATION_EXISTS');
    throw err;
  }
  await m.InsuranceVisit.updateOne({ _id: v._id }, { $set: { reservation: { status: 'pending', amount: round2(body.amount), invoiceNumber: inv.invoiceNumber, authorization: v.authorizationId, createdAt: new Date(), by: req.user!.id } } });
  try {
    const r = await getAdapter(v.providerType).reserveBenefit(ctx(req), { authorization: v.authorizationId, invoiceNumber: inv.invoiceNumber, amount: round2(body.amount) });
    await m.InsuranceVisit.updateOne({ _id: v._id }, { $set: { 'reservation.status': 'reserved', 'reservation.reservationId': r.reservationId, status: 'RESERVED', lastResponse: r.raw }, $addToSet: { invoiceIds: inv._id }, $push: { history: { at: new Date(), action: 'benefit_reserved', by: req.user!.id, byName: req.user!.name, note: `KES ${body.amount}` } } });
  } catch (err) {
    await m.InsuranceVisit.updateOne({ _id: v._id }, { $set: { 'reservation.status': 'failed' } });
    await m.OperationLock.deleteOne({ key: lockKey }); // allow a retry after a failed reservation
    throw err;
  }
  await audit(req, { action: 'insurance.reserve', resource: 'insurance_visit', resourceId: String(v._id), newValue: { amount: body.amount, invoice: inv.invoiceNumber } });
  res.json({ success: true, data: await m.InsuranceVisit.findById(v._id).lean() });
}));

/* ------------------------------------------------------------------ Claims */
const claimHistory = (c: Claim, status: Claim['status'], source: string, note?: string) => {
  c.status = status;
  c.statusHistory.push({ status, at: new Date(), source, note });
};
async function loadClaim(req: Request, id: unknown) {
  const c = await req.tenant!.models.InsuranceClaim.findById(oid(id, 'Claim'));
  if (!c || !canAccessBranch(req, c.branchId)) throw notFound('Claim not found');
  return c;
}

/** Diagnoses for the claim in ICD-10, via documented mappings only. */
async function icd10For(m: M, visitIds: unknown[]) {
  const consults = await m.Consultation.find({ visitId: { $in: visitIds.filter(Boolean) }, status: 'final' } as Record<string, unknown>).select('diagnoses').lean();
  const dx = consults.flatMap((c) => c.diagnoses);
  const out: Array<{ code: string; codingSystem: string; description: string; primary: boolean }> = [];
  const unmapped: string[] = [];
  for (const [i, d] of dx.entries()) {
    const sys = d.system ?? 'ICD-11';
    let code: string | undefined;
    if (/icd-?10/i.test(sys) && d.code) code = d.code;
    else if (d.code) code = (await m.DiagnosisCodeMap.findOne({ sourceSystem: sys, sourceCode: d.code, targetSystem: 'ICD-10' }).lean())?.targetCode;
    if (!code) unmapped.push(`${d.code ?? '?'} ${d.display}`);
    else if (!out.some((o) => o.code === code)) out.push({ code, codingSystem: 'ICD-10', description: d.display, primary: i === 0 || d.type === 'primary' });
  }
  return { diagnoses: out, unmapped };
}

router.get('/claims', requirePermission('insurance.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = { ...branchFilter(req) };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.payer) filter['payer.sladeCode'] = String(req.query.payer);
  if (req.query.q) filter.$or = [{ reference: new RegExp(escapeRegex(String(req.query.q)), 'i') }, { memberNumber: String(req.query.q) }];
  res.json({ success: true, data: await req.tenant!.models.InsuranceClaim.find(filter).select('-lastResponse').populate('patientId', 'patientNumber firstName lastName').populate('visitId', 'visitNumber reference').sort({ updatedAt: -1 }).limit(300).lean() });
}));
router.get('/claims/:id', requirePermission('insurance.view'), h(async (req, res) => {
  const c = await req.tenant!.models.InsuranceClaim.findById(oid(req.params.id, 'Claim')).populate('patientId', 'patientNumber firstName lastName').populate('visitId').populate('remittances').lean();
  if (!c || !canAccessBranch(req, c.branchId)) throw notFound('Claim not found');
  res.json({ success: true, data: c });
}));

router.post('/visits/:id/claim', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ invoiceId: z.string() }), req.body);
  const m = req.tenant!.models;
  const v = await loadVisit(req, req.params.id);
  if (v.claimId) throw conflict('A claim already exists for this visit', { id: v.claimId }, 'CLAIM_EXISTS');
  if (!['VISIT_STARTED', 'AUTHORIZED', 'RESERVED', 'IN_PROGRESS', 'READY_FOR_CLAIM'].includes(v.status)) throw conflict(`Visit is ${v.status}`, undefined, 'INVALID_TRANSITION');
  const inv = await loadScoped(req, m.Invoice, body.invoiceId, 'Invoice');
  if (String(inv.patientId) !== String(v.patientId)) throw badRequest('Invoice belongs to another patient');
  if (inv.status === 'void') throw conflict('Invoice is void', undefined, 'INVOICE_VOID');
  const { diagnoses, unmapped } = await icd10For(m, [v.localVisitId, inv.visitId]);
  if (unmapped.length) throw new AppError(422, 'DIAGNOSIS_NOT_MAPPED', 'Some diagnoses have no documented ICD-10 mapping. Add the mapping (Insurance → Code mappings) or record the ICD-10 code.', unmapped);
  if (!diagnoses.length) throw new AppError(422, 'DIAGNOSIS_REQUIRED', 'Finalize a consultation with at least one diagnosis first');
  const patient = await m.Patient.findById(v.patientId).select('firstName middleName lastName').lean();
  const seq = await nextSequence(m, 'insurance_claim');
  const claim = await m.InsuranceClaim.create({
    reference: `INS-CLM-${String(seq).padStart(6, '0')}`, branchId: v.branchId, patientId: v.patientId, visitId: v._id, coverageId: v.coverageId, invoiceId: inv._id, providerType: v.providerType,
    payer: { name: v.payer, sladeCode: v.payerSladeCode }, memberNumber: v.memberNumber, scheme: v.scheme, diagnoses, status: 'DRAFT',
    statusHistory: [{ status: 'DRAFT', at: new Date(), source: 'user' }], createdBy: req.user!.id,
  });
  try {
    const r = await getAdapter(v.providerType).createClaim(ctx(req), { payerCode: v.payerSladeCode ?? undefined, payerName: v.payer ?? undefined, patientName: [patient?.firstName, patient?.middleName, patient?.lastName].filter(Boolean).join(' '), memberNumber: v.memberNumber ?? '', schemeName: v.scheme?.name ?? undefined, schemeCode: v.scheme?.code ?? undefined, visitNumber: v.visitNumber ?? undefined, visitStart: v.visitStart ?? undefined, visitEnd: new Date().toISOString(), icd10Codes: diagnoses.map((d) => d.code) });
    claim.set({ sladeClaimId: r.claimId, claimReference: r.reference, externalStatus: r.status, lastResponse: r.raw });
    claimHistory(claim, 'READY', 'slade360', 'Claim created at Slade360');
    await claim.save();
  } catch (err) {
    claim.lastResponse = { error: (err as Error).message } as never;
    await claim.save();
    throw err;
  }
  v.claimId = claim._id as never;
  v.status = 'CLAIM_CREATED';
  visitHistory(v, req, 'claim_created', claim.reference);
  await v.save();
  await audit(req, { action: 'insurance.claim_create', resource: 'insurance_claim', resourceId: String(claim._id), newValue: { sladeClaimId: claim.sladeClaimId, icd10: diagnoses.map((d) => d.code) } });
  res.status(201).json({ success: true, data: claim });
}));

router.post('/claims/:id/invoice', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ copay: z.number().min(0).default(0) }), req.body ?? {});
  const m = req.tenant!.models;
  const claim = await loadClaim(req, req.params.id);
  if (!claim.sladeClaimId) throw conflict('The claim has not been created at the payer', undefined, 'CLAIM_NOT_CREATED');
  if (claim.sladeInvoiceId) throw conflict('An invoice was already sent for this claim. Use a credit note to correct it.', undefined, 'INVOICE_EXISTS');
  const inv = await m.Invoice.findById(claim.invoiceId);
  if (!inv) throw notFound('Invoice not found');
  await recalcInvoice(m, inv);
  // All amounts are computed here from the invoice; nothing from the browser is trusted except the copay, which is bounded.
  const lines = inv.lines.filter((l) => !l.voided && l.amount > 0).map((l) => ({ code: l.serviceCode, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: round2(l.amount) }));
  if (!lines.length) throw badRequest('The invoice has no billable lines');
  const gross = round2(inv.totals?.net ?? lines.reduce((s, l) => s + l.amount, 0));
  if (body.copay > gross) throw badRequest('Copay cannot exceed the invoice amount');
  const copay = round2(body.copay);
  const amounts = { gross, copay, insurance: round2(gross - copay), patient: copay, net: round2(gross - copay) };
  const r = await getAdapter(claim.providerType).createInvoice(ctx(req), { claim: claim.sladeClaimId, invoiceNumber: inv.invoiceNumber, invoiceDate: new Date().toISOString().slice(0, 10), copays: copay, lines });
  claim.set({ sladeInvoiceId: r.invoiceId, invoiceNumber: inv.invoiceNumber, amounts, lastResponse: r.raw, submittedAt: new Date() });
  claimHistory(claim, 'SUBMITTED', 'slade360', 'Invoice accepted by Slade360');
  await claim.save();
  await m.InsuranceVisit.updateOne({ _id: claim.visitId }, { status: 'SUBMITTED' });
  await audit(req, { action: 'insurance.invoice_create', resource: 'insurance_claim', resourceId: String(claim._id), newValue: amounts });
  res.json({ success: true, data: claim });
}));

router.post('/claims/:id/attachments', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ documentId: z.string(), attachmentType: z.enum(['CLAIM_FORM', 'PREAUTH_FORM', 'PRESCRIPTION', 'LAB_ORDER', 'IMAGING_ORDER', 'OTHER']), target: z.enum(['claim', 'invoice']) }), req.body);
  const m = req.tenant!.models;
  const claim = await loadClaim(req, req.params.id);
  const d = await m.Document.findOne({ _id: oid(body.documentId, 'Document'), patientId: claim.patientId, deletedAt: null }).select('+storageKey').lean();
  if (!d) throw badRequest('Document not found for this patient');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(d.mimeType ?? '')) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF, PNG and JPEG documents can be attached to insurance claims');
  const targetId = body.target === 'claim' ? claim.sladeClaimId : claim.sladeInvoiceId;
  if (!targetId) throw conflict(`Create the ${body.target} at the payer first`, undefined, 'TARGET_NOT_CREATED');
  const file = { buffer: await localStorageDriver.read(d.storageKey), fileName: d.fileName ?? 'document', mimeType: d.mimeType! };
  const adapter = getAdapter(claim.providerType);
  const r = body.target === 'claim' ? await adapter.uploadClaimAttachment(ctx(req), { claimId: targetId, attachmentType: body.attachmentType, file }) : await adapter.uploadInvoiceAttachment(ctx(req), { invoiceId: targetId, attachmentType: body.attachmentType, file });
  claim.attachments.push({ target: body.target, documentId: d._id, attachmentId: r.attachmentId, attachmentType: body.attachmentType, fileName: d.fileName, uploadedBy: req.user!.id as never, uploadedAt: new Date() } as never);
  await claim.save();
  await audit(req, { action: 'insurance.attachment_upload', resource: 'insurance_claim', resourceId: String(claim._id), newValue: { target: body.target, type: body.attachmentType, document: String(d._id) } });
  res.json({ success: true, data: claim.attachments.at(-1) });
}));

router.post('/claims/:id/credit-notes', requirePermission('insurance.manage'), h(async (req, res) => {
  const body = parse(z.object({ amount: z.number().positive(), reason: z.string().min(5).max(300) }), req.body);
  const claim = await loadClaim(req, req.params.id);
  if (!claim.sladeInvoiceId) throw conflict('No submitted invoice to correct', undefined, 'INVOICE_NOT_SUBMITTED');
  if (body.amount > (claim.amounts?.insurance ?? 0)) throw badRequest('Credit note cannot exceed the invoiced insurance amount');
  const r = await getAdapter(claim.providerType).createCreditNote(ctx(req), { invoiceId: claim.sladeInvoiceId, amount: body.amount, reason: body.reason });
  claim.creditNotes.push({ externalId: r.id, amount: body.amount, reason: body.reason, authorizedBy: req.user!.id as never, authorizedByName: req.user!.name, at: new Date() } as never);
  await claim.save();
  await audit(req, { action: 'insurance.credit_note', resource: 'insurance_claim', resourceId: String(claim._id), newValue: body });
  res.json({ success: true, data: claim });
}));

/** Refresh the payer's status. Only clear, justified mappings change the normalized status; PAID needs remittance evidence. */
router.post('/claims/:id/refresh-status', requirePermission('insurance.view'), h(async (req, res) => {
  const claim = await loadClaim(req, req.params.id);
  if (!claim.sladeClaimId) throw conflict('The claim has not been created at the payer', undefined, 'CLAIM_NOT_CREATED');
  const r = await getAdapter(claim.providerType).getClaimStatus(ctx(req), claim.sladeClaimId);
  claim.externalStatus = r.externalStatus ?? claim.externalStatus;
  const s = (r.externalStatus ?? '').toLowerCase();
  const next = /partial/.test(s) ? 'PARTIALLY_APPROVED' : /reject|declin/.test(s) ? 'REJECTED' : /approv/.test(s) ? 'APPROVED' : /process|review|pending|received/.test(s) ? 'PROCESSING' : null;
  if (next && next !== claim.status && !['PAID', 'CLOSED'].includes(claim.status)) claimHistory(claim, next as Claim['status'], 'slade360', `External status: ${r.externalStatus}`);
  await claim.save();
  res.json({ success: true, data: claim });
}));

/* ------------------------------------------------------------------ Remittances & reconciliation */
async function upsertRemittances(m: M, providerType: string, recs: RemittanceRecord[]) {
  let upserted = 0;
  for (const r of recs) {
    const claim = r.claimExternalId ? await m.InsuranceClaim.findOne({ sladeClaimId: r.claimExternalId }).select('_id').lean() : null;
    const doc = await m.InsuranceRemittance.findOneAndUpdate(
      { providerType, externalId: r.externalId } as Record<string, unknown>,
      { $set: { payerName: r.payerName, sladeClaimId: r.claimExternalId, claimId: claim?._id, invoiceNumber: r.invoiceNumber, amountSubmitted: r.amountSubmitted, amountApproved: r.amountApproved, amountPaid: r.amountPaid, adjustment: r.adjustment, date: r.date ? new Date(r.date) : undefined, externalStatus: r.status, raw: r.raw } },
      { upsert: true, returnDocument: 'after' },
    );
    if (claim && doc) await m.InsuranceClaim.updateOne({ _id: claim._id }, { $addToSet: { remittances: (doc as unknown as { _id: unknown })._id } });
    upserted += 1;
  }
  return upserted;
}

router.post('/remittances/sync', requirePermission('insurance.manage'), h(async (req, res) => {
  const q = parse(z.object({ page: z.coerce.number().int().min(1).optional() }), req.body ?? {});
  const recs = await getAdapter('SLADE360').getRemittances(ctx(req), { page: q.page ? String(q.page) : undefined });
  const n = await upsertRemittances(req.tenant!.models, 'SLADE360', recs);
  await audit(req, { action: 'insurance.remittances_sync', resource: 'insurance_remittance', resourceId: 'slade360', newValue: { count: n } });
  res.json({ success: true, data: { synced: n } });
}));

router.get('/remittances', requirePermission('insurance.view'), h(async (req, res) => {
  res.json({ success: true, data: await req.tenant!.models.InsuranceRemittance.find({}).select('-raw').populate('claimId', 'reference invoiceNumber status').sort({ date: -1, createdAt: -1 }).limit(300).lean() });
}));

router.post('/claims/:id/remittance', requirePermission('insurance.manage'), h(async (req, res) => {
  const claim = await loadClaim(req, req.params.id);
  if (!claim.sladeClaimId) throw conflict('The claim has not been created at the payer', undefined, 'CLAIM_NOT_CREATED');
  const recs = await getAdapter(claim.providerType).getClaimRemittance(ctx(req), claim.sladeClaimId);
  await upsertRemittances(req.tenant!.models, claim.providerType, recs.map((r) => ({ ...r, claimExternalId: r.claimExternalId ?? claim.sladeClaimId ?? undefined })));
  res.json({ success: true, data: await req.tenant!.models.InsuranceRemittance.find({ claimId: claim._id }).select('-raw').lean() });
}));

router.post('/claims/:id/reconcile', requirePermission('insurance.manage'), h(async (req, res) => {
  const { remittanceId } = parse(z.object({ remittanceId: z.string() }), req.body);
  const m = req.tenant!.models;
  const claim = await loadClaim(req, req.params.id);
  const rem = await m.InsuranceRemittance.findById(oid(remittanceId, 'Remittance'));
  if (!rem || String(rem.claimId) !== String(claim._id)) throw badRequest('This remittance does not belong to the claim');
  if (!(rem.amountPaid && rem.amountPaid > 0)) throw new AppError(422, 'NO_PAYMENT_EVIDENCE', 'The remittance shows no paid amount. A claim is never marked paid on approval alone.');
  const inv = await m.Invoice.findById(claim.invoiceId);
  if (!inv) throw notFound('Invoice not found');
  const idempotencyKey = `ins-rem:${rem._id}`;
  let payment = await m.Payment.findOne({ idempotencyKey });
  if (!payment) {
    await recalcInvoice(m, inv);
    const amount = round2(Math.min(rem.amountPaid, Math.max(0, inv.totals?.balance ?? 0)));
    if (amount > 0) {
      payment = await m.Payment.create({ invoiceId: inv._id, patientId: claim.patientId, branchId: claim.branchId, method: 'insurance', amount, reference: rem.externalId, idempotencyKey, status: 'pending', receivedBy: req.user!.id, receivedByName: req.user!.name, notes: `${claim.payer?.name ?? 'Insurer'} remittance ${rem.externalId} for ${claim.reference}` });
      await completePayment(m, payment);
    }
    rem.reconciledAt = new Date();
    await rem.save();
  }
  const rems = await m.InsuranceRemittance.find({ claimId: claim._id, reconciledAt: { $ne: null } }).lean();
  const paid = round2(rems.reduce((s, r) => s + (r.amountPaid ?? 0), 0));
  const approved = round2(rems.reduce((s, r) => s + (r.amountApproved ?? r.amountPaid ?? 0), 0));
  const submitted = claim.amounts?.insurance ?? 0;
  const variance = round2(submitted - paid);
  claim.set('reconciliation', { status: Math.abs(variance) < 0.01 ? 'matched' : 'variance', submitted, approved, paid, copay: claim.amounts?.copay ?? 0, variance, paymentIds: [...new Set([...(claim.reconciliation?.paymentIds ?? []).map(String), ...(payment ? [String(payment._id)] : [])])], at: new Date(), by: req.user!.id });
  if (paid > 0 && paid >= approved - 0.01) claimHistory(claim, 'PAID', 'reconciliation', `Remittance ${rem.externalId}`);
  await claim.save();
  if (claim.status === 'PAID') await m.InsuranceVisit.updateOne({ _id: claim.visitId }, { status: 'PAID' });
  await audit(req, { action: 'insurance.reconcile', resource: 'insurance_claim', resourceId: String(claim._id), newValue: claim.reconciliation });
  res.json({ success: true, data: claim });
}));

/* ------------------------------------------------------------------ Dashboard */
router.get('/dashboard', requirePermission('insurance.view'), h(async (req, res) => {
  const m = req.tenant!.models;
  const bf = branchFilter(req);
  const since = new Date(Date.now() - 365 * 86400_000);
  const [activeInsured, checks, authorized, claims, shaPreauths] = await Promise.all([
    m.InsuranceCoverage.distinct('patientId', { isActive: true, eligibilityStatus: 'eligible' }),
    m.InsuranceCoverage.countDocuments({ lastEligibilityCheck: { $gte: new Date(Date.now() - 30 * 86400_000) } }),
    m.InsuranceVisit.countDocuments({ ...bf, status: { $in: ['AUTHORIZED', 'VISIT_STARTED', 'RESERVED', 'IN_PROGRESS'] } }),
    m.InsuranceClaim.find({ ...bf, createdAt: { $gte: since } }).select('status payer amounts reconciliation createdAt').lean(),
    m.ShaVisit.countDocuments({ ...bf, status: 'preauth_pending' }),
  ]);
  const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
  const byStatus: Record<string, number> = {};
  const byPayer: Record<string, { claims: number; submitted: number; paid: number }> = {};
  const monthly: Record<string, number> = {};
  for (const c of claims) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const p = c.payer?.name ?? 'Unknown';
    byPayer[p] ??= { claims: 0, submitted: 0, paid: 0 };
    byPayer[p].claims += 1;
    byPayer[p].submitted = round2(byPayer[p].submitted + (c.amounts?.insurance ?? 0));
    byPayer[p].paid = round2(byPayer[p].paid + (c.reconciliation?.paid ?? 0));
    const k = new Date(c.createdAt!).toISOString().slice(0, 7);
    monthly[k] = round2((monthly[k] ?? 0) + (c.reconciliation?.paid ?? 0));
  }
  const submitted = sum(claims.map((c) => c.amounts?.insurance ?? 0));
  const approved = sum(claims.map((c) => c.reconciliation?.approved ?? 0));
  const paid = sum(claims.map((c) => c.reconciliation?.paid ?? 0));
  res.json({
    success: true,
    data: {
      activeInsuredPatients: activeInsured.length,
      eligibilityChecks30d: checks,
      authorizedVisits: authorized,
      pendingPreauthorizations: shaPreauths,
      claimsSubmitted: claims.filter((c) => !['DRAFT', 'READY'].includes(c.status)).length,
      claimsProcessing: byStatus.PROCESSING ?? 0,
      claimsApproved: (byStatus.APPROVED ?? 0) + (byStatus.PARTIALLY_APPROVED ?? 0),
      claimsRejected: byStatus.REJECTED ?? 0,
      amountSubmitted: submitted,
      amountApproved: approved,
      amountPaid: paid,
      outstandingReceivables: round2(submitted - paid),
      byStatus,
      byPayer,
      monthlyRevenue: monthly,
    },
  });
}));

export default router;
