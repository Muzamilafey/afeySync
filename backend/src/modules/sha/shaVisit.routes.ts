import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, oid } from '../common/helpers';
import { nextSequence, type TenantModels } from '../../models/tenant';
import { meta } from '../../models/meta';
import { env } from '../../config/env';
import { hieRequest, fetchToken, tokenStatus } from '../../integrations/hie/hieClient';
import { resolveIntegration } from '../integrations/integrationConfigService';
import { IntegrationSecretService } from '../integrations/secretService';
import { localStorageDriver } from '../documents/storage';
import { pick } from '../../integrations/hie/normalize';
import { assertShaTransactable, decideWorkflow, interventionFlags, type InterventionFlags } from './shaWorkflow';

/**
 * SHA eClaims visit workflow (DHA HIE): consent (OTP / biometrics) → authorization → start visit (virtual claim) →
 * interventions → preauthorization → diagnoses / billable items / documents → preview → submit (OP/emergency) or
 * discharge (IP) → close / corrections. Every call goes through the owner-configured HIE contract.
 */
const router = Router();
router.use(authenticateTenant);

type Visit = NonNullable<Awaited<ReturnType<TenantModels['ShaVisit']['findOne']>>>;
type Obj = Record<string, unknown>;
const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const body0 = (d: unknown): Obj => (isObj(d) ? (isObj(d.data) ? (d.data as Obj) : d) : {});
const num = (v: string | undefined) => (v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : undefined);
/** Extra documented fields the UI may pass through (primitives / arrays of primitives only). */
const extraSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,60}$/), z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.union([z.string().max(200), z.number()])).max(50)])).optional();

/** Consent tokens, OTPs and access tokens never reach the database, even inside stored DHA responses. */
const SECRET_KEYS = /^(token|consent_token|consentToken|access_token|accessToken|otp|client_secret|refresh_token)$/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 8) return '[…]';
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[REDACTED]' : redact(x, depth + 1)]));
  return v;
}

function history(v: Visit, req: Request, action: string, note?: string) {
  v.history.push({ at: new Date(), action, by: req.user!.id as never, byName: req.user!.name, note });
}

/** Calls DHA and keeps the exchange on the visit for audit. */
async function call(req: Request, v: Visit, operation: string, input: { query?: Record<string, string | undefined>; body?: unknown; pathParams?: Record<string, string>; idempotencyKey?: string }) {
  try {
    const r = await hieRequest('sha', ctx(req), { operation, ...input });
    v.responses.push({ at: new Date(), operation, ok: true, code: String(r.status), data: redact(r.data) as never });
    v.lastDhaError = undefined;
    return r.data;
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'ERROR';
    v.responses.push({ at: new Date(), operation, ok: false, code, data: { message: (err as Error).message } as never });
    v.lastDhaError = `${operation}: ${code}: ${(err as Error).message}`.slice(0, 400);
    throw err;
  } finally {
    if (v.responses.length > 40) v.set('responses', v.responses.slice(-40));
    await v.save();
  }
}

async function loadVisit(req: Request, withToken = false) {
  const q = req.tenant!.models.ShaVisit.findById(oid(req.params.id, 'SHA visit'));
  if (withToken) q.select('+consentToken');
  const v = await q;
  if (!v) throw notFound('SHA visit not found');
  if (!canAccessAnyBranch(req, [v.branchId])) throw forbidden('This SHA visit belongs to another branch', 'BRANCH_FORBIDDEN');
  const patient = await req.tenant!.models.Patient.findById(v.patientId).select('sha deceasedAt').lean();
  assertShaTransactable(patient);
  return v;
}
const consentToken = (v: Visit) => {
  if (!v.consentToken?.ciphertext) throw conflict('Patient consent has not been obtained for this visit', undefined, 'SHA_CONSENT_REQUIRED');
  return IntegrationSecretService.decrypt(v.consentToken.ciphertext);
};

/* ------------------------------------------------------------------ Facility DHA connection (no secrets) */
router.get('/connection', requireAnyPermission('sha.view', 'admin.integrations'), h(async (req, res) => {
  const t = await meta().Tenant.findById(req.tenant!.id).select('dhaRegistry hie integrations').lean();
  let cfg = null;
  try {
    cfg = await resolveIntegration('sha', req.tenant!.id);
  } catch (err) {
    return res.json({ success: true, data: { enabled: false, status: 'NOT_CONFIGURED', message: (err as Error).message, frCode: t?.dhaRegistry?.facilityRegistryCode ?? null } });
  }
  const frCode = t?.dhaRegistry?.facilityRegistryCode ?? cfg.settings.facilityRegistryCode ?? null;
  const status = !frCode ? 'PENDING' : t?.hie?.lastErrorAt && (!t.hie.lastSuccessfulConnectionAt || t.hie.lastErrorAt > t.hie.lastSuccessfulConnectionAt) ? 'ERROR' : t?.hie?.lastSuccessfulConnectionAt ? 'CONNECTED' : 'PENDING';
  res.json({ success: true, data: { enabled: true, environment: cfg.environment, frCode, frCodeType: 'fr-code', credentialsSource: cfg.source, status, token: tokenStatus(cfg), lastSuccessfulConnectionAt: t?.hie?.lastSuccessfulConnectionAt ?? null, lastError: t?.hie?.lastError ?? null, callbacksEnabled: env.DHA_ENABLE_CALLBACKS === 'true' } });
}));

router.post('/connection/test', requirePermission('admin.integrations'), h(async (req, res) => {
  const cfg = await resolveIntegration('sha', req.tenant!.id);
  try {
    await fetchToken('sha', cfg, ctx(req), true);
    await meta().Tenant.updateOne({ _id: req.tenant!.id }, { 'hie.lastSuccessfulConnectionAt': new Date(), $unset: { 'hie.lastError': 1 } });
    res.json({ success: true, data: { status: 'CONNECTED' } });
  } catch (err) {
    await meta().Tenant.updateOne({ _id: req.tenant!.id }, { 'hie.lastError': (err as Error).message.slice(0, 300), 'hie.lastErrorAt': new Date() });
    throw err;
  }
}));

/* ------------------------------------------------------------------ Coverage lookups (by patient) */
async function patientForSha(req: Request, patientId: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(patientId, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  assertShaTransactable(p);
  if (!p.clientRegistryId) throw new AppError(422, 'CR_ID_REQUIRED', 'This patient has no Client Registry ID. Search/import the patient from the DHA Client Registry first.');
  return p;
}

router.get('/sub-benefits', requirePermission('sha.eligibility'), h(async (req, res) => {
  const p = await patientForSha(req, req.query.patientId);
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.subBenefits', query: { patient_id: p.clientRegistryId!, benefit_code: req.query.benefitCode ? String(req.query.benefitCode) : undefined } });
  res.json({ success: true, data: r.data });
}));

router.get('/pomsf-balances', requirePermission('sha.eligibility'), h(async (req, res) => {
  const p = await patientForSha(req, req.query.patientId);
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.pomsf.balances', query: { patient_id: p.clientRegistryId! } });
  res.json({ success: true, data: r.data });
}));

/** Workflow decision for candidate interventions, always from DHA's own intervention flags. */
async function fetchInterventions(req: Request, crId: string, codes: string[]) {
  const out: InterventionFlags[] = [];
  for (const code of codes) {
    const r = await hieRequest('sha', ctx(req), { operation: 'sha.interventions', query: { patient_id: crId, code } });
    const d = r.data as unknown;
    const list = Array.isArray(d) ? d : isObj(d) && Array.isArray(d.data) ? (d.data as unknown[]) : isObj(d) && Array.isArray(d.results) ? (d.results as unknown[]) : [];
    const hit = list.filter(isObj).find((x) => String(x.code ?? x.interventionCode ?? x.intervention_code) === code);
    if (!hit) throw new AppError(422, 'SHA_INTERVENTION_NOT_COVERED', `Intervention ${code} was not returned by SHA for this patient`);
    out.push(interventionFlags(hit));
  }
  return out;
}

router.post('/workflow', requirePermission('sha.eligibility'), h(async (req, res) => {
  const body = parse(z.object({ patientId: z.string(), interventionCodes: z.array(z.string().regex(/^[A-Za-z0-9\-_.]{2,40}$/)).min(1).max(20), emergency: z.boolean().optional() }), req.body);
  const p = await patientForSha(req, body.patientId);
  const flags = await fetchInterventions(req, p.clientRegistryId!, body.interventionCodes);
  res.json({ success: true, data: { interventions: flags.map(({ raw: _r, ...f }) => f), decision: decideWorkflow(flags, { emergency: body.emergency }) } });
}));

/* ------------------------------------------------------------------ Visits */
router.get('/visits', requirePermission('sha.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
  if (req.query.status) filter.status = String(req.query.status);
  if (req.user!.branchAccess !== 'all') filter.branchId = { $in: req.user!.branchIds };
  const items = await req.tenant!.models.ShaVisit.find(filter).select('-responses').populate('patientId', 'patientNumber firstName lastName clientRegistryId').sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: items });
}));

router.get('/visits/:id', requirePermission('sha.view'), h(async (req, res) => {
  const v = await req.tenant!.models.ShaVisit.findById(oid(req.params.id, 'SHA visit')).populate('patientId', 'patientNumber firstName lastName clientRegistryId gender dateOfBirth sha phone').lean();
  if (!v || !canAccessAnyBranch(req, [v.branchId])) throw notFound('SHA visit not found');
  res.json({ success: true, data: v });
}));

router.post('/visits', requirePermission('sha.authorization'), requireBranch, h(async (req, res) => {
  const body = parse(z.object({ patientId: z.string(), visitId: z.string().optional(), admissionId: z.string().optional(), interventionCodes: z.array(z.string().regex(/^[A-Za-z0-9\-_.]{2,40}$/)).min(1).max(20), emergency: z.boolean().optional(), serviceType: z.enum(['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CAPITATION']).optional() }), req.body);
  const m = req.tenant!.models;
  const p = await patientForSha(req, body.patientId);
  if (p.sha?.status !== 'eligible' || !p.sha.lastCheckedAt || Date.now() - new Date(p.sha.lastCheckedAt).getTime() > 24 * 3600_000) {
    throw new AppError(422, 'SHA_ELIGIBILITY_REQUIRED', 'Check SHA eligibility (within the last 24 hours) before starting an SHA visit.');
  }
  const flags = await fetchInterventions(req, p.clientRegistryId!, body.interventionCodes);
  const decision = decideWorkflow(flags, { emergency: body.emergency });
  const seq = await nextSequence(m, 'sha_visit');
  const v = await m.ShaVisit.create({
    reference: `SHA-VST-${String(seq).padStart(6, '0')}`,
    patientId: p._id,
    branchId: req.branch!.id,
    visitId: body.visitId ? oid(body.visitId, 'Visit') : undefined,
    admissionId: body.admissionId ? oid(body.admissionId, 'Admission') : undefined,
    patientCrId: p.clientRegistryId!,
    serviceType: body.serviceType ?? decision.serviceType,
    interventions: flags.map((f) => ({ ...f, raw: f.raw })),
    decision,
    eligibility: { checkId: p.sha?.lastCheckId, schemes: p.sha?.schemes, whitelistedForOTP: p.sha?.whitelistedForOTP ?? undefined, facilityBiometricsEnforced: p.sha?.facilityBiometricsEnforced ?? undefined, pomsf: p.sha?.pomsf },
    history: [{ at: new Date(), action: 'created', by: req.user!.id, byName: req.user!.name, note: decision.steps.join(' → ') }],
    createdBy: req.user!.id,
  } as never) as unknown as Visit;
  await audit(req, { action: 'sha.visit.create', resource: 'sha_visit', resourceId: String(v._id), newValue: { interventions: body.interventionCodes, serviceType: v.serviceType } });
  res.status(201).json({ success: true, data: v });
}));

/* ---- Consent */
router.get('/visits/:id/contacts', requirePermission('sha.authorization'), h(async (req, res) => {
  const v = await loadVisit(req);
  res.json({ success: true, data: await call(req, v, 'sha.contacts', { query: { patient_id: v.patientCrId } }) });
}));

router.post('/visits/:id/otp', requirePermission('sha.authorization'), h(async (req, res) => {
  const { beneficiaryContactId } = parse(z.object({ beneficiaryContactId: z.string().max(80).optional() }), req.body ?? {});
  const v = await loadVisit(req);
  if (v.eligibility?.facilityBiometricsEnforced === true && v.eligibility.whitelistedForOTP !== true) throw new AppError(422, 'SHA_BIOMETRICS_REQUIRED', 'SHA requires biometric verification for this beneficiary at this facility (not whitelisted for OTP).');
  const data = await call(req, v, 'sha.otp.send', { body: { patient_id: v.patientCrId, ...(beneficiaryContactId ? { beneficiary_contact_id: beneficiaryContactId } : {}) } });
  v.set('consent.method', 'otp');
  v.set('consent.beneficiaryContactId', beneficiaryContactId);
  history(v, req, 'otp_sent');
  await v.save();
  await audit(req, { action: 'sha.consent.otp_sent', resource: 'sha_visit', resourceId: String(v._id) });
  res.json({ success: true, data: { sent: true, response: redact(data) } });
}));

const mapAuth = (d: unknown) => {
  const o = body0(d);
  return {
    authCode: pick(o, 'authCode', 'auth_code'),
    guid: pick(o, 'guid'),
    token: pick(o, 'token', 'consent_token'),
    status: pick(o, 'status'),
    expiry: pick(o, 'expiry', 'expires_at'),
    shaGuid: pick(o, 'shaGuid', 'sha_guid'),
    verificationRequestId: pick(o, 'shaVerificationRequestId', 'sha_verification_request_id'),
    verificationUrl: pick(o, 'shaVerificationRequest', 'sha_verification_request', 'shaVerificationRequest.url', 'shaVerificationRequest.iframe_url', 'ekyc_url'),
  };
};

router.post('/visits/:id/authorize', requirePermission('sha.authorization'), h(async (req, res) => {
  const body = parse(z.discriminatedUnion('method', [
    z.object({ method: z.literal('otp'), otp: z.string().regex(/^\d{4,8}$/) }),
    z.object({ method: z.literal('biometric'), agentId: z.string().max(80).optional(), deviceOs: z.enum(['windows', 'android']), ekycProviderId: z.string().max(80).optional(), workStationId: z.string().max(80).optional(), isDischargeAuthorization: z.boolean().default(false) }),
    z.object({ method: z.literal('minor_biometric'), matchId: z.string().min(4).max(100) }),
  ]), req.body);
  const v = await loadVisit(req, true);
  if (body.method === 'otp' && v.eligibility?.facilityBiometricsEnforced === true && v.eligibility.whitelistedForOTP !== true) throw new AppError(422, 'SHA_BIOMETRICS_REQUIRED', 'SHA requires biometric verification for this beneficiary at this facility.');
  if (body.method === 'minor_biometric') {
    const s = await req.tenant!.models.FacilitySetting.findOne({ key: 'sha.minorBiometrics' }).lean();
    if (s?.value !== true) throw forbidden('The minors fingerprint workflow is not enabled for this facility (requires DHA-approved hardware).', 'SHA_MINOR_BIOMETRICS_DISABLED');
  }
  const t = await meta().Tenant.findById(req.tenant!.id).select('dhaRegistry').lean();
  const interventions = v.interventions.filter((i) => i.state === 'active').map((i) => i.code);
  const authServiceType = v.serviceType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
  const payload = body.method === 'otp'
    ? { patient_id: v.patientCrId, service_type: authServiceType, otp: body.otp, interventions }
    : body.method === 'biometric'
      ? { agent_id: body.agentId, authorizing_device_os: body.deviceOs, ekyc_provider_id: body.ekycProviderId, factors: ['SHA'], interventions, is_biometrics_discharge_authorization: body.isDischargeAuthorization, is_emergency: v.serviceType === 'EMERGENCY', is_integration: true, patient_id: v.patientCrId, provider: t?.dhaRegistry?.facilityRegistryCode, service_type: authServiceType, work_station_id: body.workStationId }
      : { match_id: body.matchId, patient_id: v.patientCrId, service_type: authServiceType, interventions };
  const data = await call(req, v, 'sha.authorization.create', { body: payload });
  const a = mapAuth(data);
  if (a.token) v.consentToken = IntegrationSecretService.encrypt(a.token) as never;
  v.set('consent', { ...v.consent, method: body.method, status: a.status, authCode: a.authCode, authGuid: a.guid, shaGuid: a.shaGuid, expiry: a.expiry ? new Date(a.expiry) : undefined, verificationRequestId: a.verificationRequestId, verificationUrl: a.verificationUrl, authorizedAt: a.token ? new Date() : undefined, authorizedBy: req.user!.id });
  // Biometric eKYC completes on DHA's side; never assume success locally.
  v.status = a.token ? 'authorized' : body.method === 'biometric' ? 'biometric_pending' : v.status;
  history(v, req, `authorize_${body.method}`, a.status);
  await v.save();
  await audit(req, { action: 'sha.consent.authorize', resource: 'sha_visit', resourceId: String(v._id), newValue: { method: body.method, status: a.status, authCode: a.authCode } });
  res.json({ success: true, data: { status: v.status, consent: v.consent, verificationUrl: a.verificationUrl } });
}));

/* ---- Minor fingerprint matching (only with DHA-approved hardware) */
router.post('/biometrics/matches', requirePermission('sha.authorization'), h(async (req, res) => {
  const s = await req.tenant!.models.FacilitySetting.findOne({ key: 'sha.minorBiometrics' }).lean();
  if (s?.value !== true) throw forbidden('The minors fingerprint workflow is not enabled for this facility.', 'SHA_MINOR_BIOMETRICS_DISABLED');
  const body = parse(z.record(z.string(), z.unknown()), req.body);
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.biometrics.match.create', body });
  await audit(req, { action: 'sha.biometrics.match', resource: 'patient', resourceId: String(body.health_id ?? '') });
  res.json({ success: true, data: r.data });
}));
router.get('/biometrics/matches/:matchId', requirePermission('sha.authorization'), h(async (req, res) => {
  const r = await hieRequest('sha', ctx(req), { operation: 'sha.biometrics.match.get', pathParams: { match_id: String(req.params.matchId) } });
  res.json({ success: true, data: r.data });
}));

/* ---- Start visit / virtual claim */
router.post('/visits/:id/start', requirePermission('sha.authorization'), h(async (req, res) => {
  const body = parse(z.object({ otp: z.string().regex(/^\d{4,8}$/).optional(), practitionerIdentificationType: z.string().min(2).max(60), practitionerIdentificationNumber: z.string().min(2).max(60), practitionerRegulationBody: z.string().min(2).max(60), practitionerUserId: z.string().optional() }), req.body);
  const v = await loadVisit(req, true);
  if (!['authorized', 'biometric_pending', 'consent_pending'].includes(v.status)) throw conflict(`Visit is already ${v.status.replace('_', ' ')}`, undefined, 'INVALID_SHA_TRANSITION');
  const auth: Obj = body.otp ? { otp: body.otp } : v.consent?.authGuid ? { auth_guid: v.consent.authGuid } : {};
  if (!Object.keys(auth).length) throw conflict('Obtain patient consent (OTP or biometrics) first', undefined, 'SHA_CONSENT_REQUIRED');
  const data = await call(req, v, 'sha.visit.consent.start', {
    body: { intervention_codes: v.interventions.filter((i) => i.state === 'active').map((i) => i.code), patient_id: v.patientCrId, service_type: v.serviceType, ...auth, practitioner_identification_type: body.practitionerIdentificationType, practitioner_identification_number: body.practitionerIdentificationNumber, practitioner_regulation_body: body.practitionerRegulationBody },
    idempotencyKey: `shavisit:${v._id}:start`,
  });
  const o = body0(data);
  const g = (...k: string[]) => pick(o, ...k);
  v.set('dha', {
    claimId: g('claim_id', 'claimId', 'id'), ediClaimGuid: g('edi_claim_guid', 'ediClaimGuid'), authorizationCode: g('authorization_code', 'authorizationCode'), authorizationGuid: g('authorization_guid', 'authorizationGuid'),
    beneficiaryGuid: g('beneficiary_guid', 'beneficiaryGuid'), invoiceId: g('invoice_id', 'invoiceId'), invoiceNumber: g('invoice_number', 'invoiceNumber'), patientNumber: g('patient_number', 'patientNumber'),
    memberNumber: g('member_number', 'memberNumber'), payerCode: g('payer_code', 'payerCode'), payerName: g('payer_name', 'payerName'), payerSladeCode: g('payer_slade_code', 'payerSladeCode'),
    providerName: g('provider_name', 'providerName'), providerSladeCode: g('provider_slade_code', 'providerSladeCode'), providerFid: g('provider_fid', 'providerFid'), schemeCode: g('scheme_code', 'schemeCode'), schemeName: g('scheme_name', 'schemeName'),
    visitNumber: g('visit_number', 'visitNumber'), visitStart: g('visit_start', 'visitStart'), workflowState: g('workflow_state', 'workflowState'),
    totalClaimAmount: num(g('total_claim_amount')), totalClaimNetAmount: num(g('total_claim_net_amount')), totalClaimCopay: num(g('total_claim_copay')),
  });
  const token = g('consent_token', 'token');
  if (token && !v.consentToken?.ciphertext) v.consentToken = IntegrationSecretService.encrypt(token) as never;
  const practitioner = body.practitionerUserId ? await req.tenant!.models.User.findById(oid(body.practitionerUserId, 'User')).select('name').lean() : null;
  v.set('practitioner', { identificationType: body.practitionerIdentificationType, identificationNumber: body.practitionerIdentificationNumber, regulationBody: body.practitionerRegulationBody, userId: practitioner?._id, name: practitioner?.name });
  v.status = (v.decision as { needsPreauth?: boolean } | undefined)?.needsPreauth ? 'preauth_pending' : 'visit_started';
  history(v, req, 'visit_started', v.dha?.claimId ? `claim ${v.dha.claimId}` : undefined);
  await v.save();
  await audit(req, { action: 'sha.visit.start', resource: 'sha_visit', resourceId: String(v._id), newValue: { claimId: v.dha?.claimId, visitNumber: v.dha?.visitNumber } });
  res.json({ success: true, data: v });
}));

/* ---- Interventions on the claim (add / restore / retire / switch are distinct DHA operations) */
router.post('/visits/:id/interventions/:op', requirePermission('sha.claim'), h(async (req, res) => {
  const op = z.enum(['add', 'restore', 'retire', 'switch']).parse(req.params.op);
  const body = parse(z.object({ interventionCode: z.string().regex(/^[A-Za-z0-9\-_.]{2,40}$/), extra: extraSchema }), req.body);
  const v = await loadVisit(req, true);
  if (!v.dha?.claimId) throw conflict('Start the visit first', undefined, 'SHA_VISIT_NOT_STARTED');
  const data = await call(req, v, `sha.intervention.${op}`, { body: { ...(body.extra ?? {}), consent_token: consentToken(v), claim_id: v.dha.claimId, intervention_code: body.interventionCode }, idempotencyKey: `shavisit:${v._id}:int:${op}:${body.interventionCode}:${v.history.length}` });
  if (op === 'add' && !v.interventions.some((i) => i.code === body.interventionCode)) {
    const [f] = await fetchInterventions(req, v.patientCrId, [body.interventionCode]);
    v.interventions.push({ ...f, raw: f.raw } as never);
  }
  const it = v.interventions.find((i) => i.code === body.interventionCode);
  if (it && op === 'retire') it.state = 'retired';
  if (it && op === 'restore') it.state = 'active';
  history(v, req, `intervention_${op}`, body.interventionCode);
  await v.save();
  await audit(req, { action: `sha.intervention.${op}`, resource: 'sha_visit', resourceId: String(v._id), newValue: { interventionCode: body.interventionCode } });
  res.json({ success: true, data: { visit: v, response: redact(data) } });
}));

/* ---- Preauthorization */
router.post('/visits/:id/preauths', requirePermission('sha.preauthorization'), h(async (req, res) => {
  const body = parse(z.object({
    interventionCode: z.string().regex(/^[A-Za-z0-9\-_.]{2,40}$/),
    serviceStart: z.string().min(8).max(30),
    serviceEnd: z.string().min(8).max(30),
    items: z.array(z.object({ code: z.string().max(60).optional(), description: z.string().max(200), quantity: z.number().positive(), unitPrice: z.number().min(0) })).min(1).max(100),
    diagnoses: z.array(z.object({ code: z.string().max(30), description: z.string().max(200).optional() })).min(1).max(20),
    doctors: z.array(z.object({ identificationType: z.string().max(60), identificationNumber: z.string().max(60), regulationBody: z.string().max(60).optional(), name: z.string().max(120).optional() })).max(10).default([]),
    documentIds: z.array(z.string()).max(20).default([]),
    providerNotificationEmail: z.string().email().optional(),
  }), req.body);
  const m = req.tenant!.models;
  const v = await loadVisit(req, true);
  const intervention = v.interventions.find((i) => i.code === body.interventionCode && i.state === 'active');
  if (!intervention) throw badRequest('Intervention is not on this visit');
  if (intervention.needsPreauth !== true) throw conflict('SHA does not require preauthorization for this intervention', undefined, 'SHA_PREAUTH_NOT_REQUIRED');
  const existing = v.preauths.find((p) => p.interventionCode === body.interventionCode && !p.cancelledAt);
  if (existing) throw conflict('A preauthorization already exists for this intervention', undefined, 'SHA_PREAUTH_EXISTS');
  const docs = await m.Document.find({ _id: { $in: body.documentIds.map((d) => oid(d, 'Document')) }, patientId: v.patientId, deletedAt: null }).select('+storageKey').lean();
  if (docs.length !== body.documentIds.length) throw badRequest('Some documents were not found for this patient');
  const form = new FormData();
  form.set('consent_token', consentToken(v));
  form.set('intervention_code', body.interventionCode);
  form.set('service_start', body.serviceStart);
  form.set('service_end', body.serviceEnd);
  form.set('items', JSON.stringify(body.items.map((i) => ({ code: i.code, description: i.description, quantity: i.quantity, unit_price: i.unitPrice, amount: Math.round(i.quantity * i.unitPrice * 100) / 100 }))));
  form.set('diagnoses', JSON.stringify(body.diagnoses.map((d) => ({ code: d.code, description: d.description }))));
  form.set('doctors', JSON.stringify(body.doctors.map((d) => ({ identification_type: d.identificationType, identification_number: d.identificationNumber, regulation_body: d.regulationBody, name: d.name }))));
  if (body.providerNotificationEmail) form.set('provider_notification_email', body.providerNotificationEmail);
  for (const d of docs) form.append('attachments', new Blob([new Uint8Array(await localStorageDriver.read(d.storageKey))], { type: d.mimeType ?? 'application/octet-stream' }), d.fileName ?? 'document');
  const data = await call(req, v, 'sha.preauth.create', { body: form, idempotencyKey: `shavisit:${v._id}:preauth:${body.interventionCode}` });
  const o = body0(data);
  v.preauths.push({ interventionCode: body.interventionCode, status: pick(o, 'status'), preauthType: pick(o, 'preauthType', 'preauth_type'), totalEstimated: body.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), documentIds: docs.map((d) => d._id), submittedAt: new Date(), submittedBy: req.user!.id as never, lastResponse: redact(data) as never } as never);
  history(v, req, 'preauth_submitted', body.interventionCode);
  await v.save();
  await audit(req, { action: 'sha.preauth.create', resource: 'sha_visit', resourceId: String(v._id), newValue: { interventionCode: body.interventionCode, documents: docs.length } });
  res.status(201).json({ success: true, data: v.preauths.at(-1) });
}));

router.get('/visits/:id/preauths/:code', requirePermission('sha.view'), h(async (req, res) => {
  const v = await loadVisit(req, true);
  const pa = v.preauths.find((p) => p.interventionCode === req.params.code);
  if (!pa) throw notFound('No preauthorization for this intervention');
  const data = await call(req, v, 'sha.preauth.get', { query: { consent_token: consentToken(v), intervention_code: String(req.params.code) } });
  const o = body0(data);
  Object.assign(pa, {
    status: pick(o, 'status') ?? pa.status, preauthType: pick(o, 'preauthType', 'preauth_type') ?? pa.preauthType,
    totalEstimated: num(pick(o, 'totalEstimatedAmountForPreauth')) ?? pa.totalEstimated, interimApproved: num(pick(o, 'totalInterimApprovedAmountForPreauth')), finalApproved: num(pick(o, 'finalApprovedAmount')),
    doctorApproved: o.doctorApproved, doctorReviewStatus: pick(o, 'doctorReviewStatus'), lastFetchedAt: new Date(), lastResponse: redact(data),
  });
  v.markModified('preauths');
  await v.save();
  res.json({ success: true, data: pa });
}));

router.post('/visits/:id/preauths/:code/cancel', requirePermission('sha.preauthorization'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
  const v = await loadVisit(req, true);
  const pa = v.preauths.find((p) => p.interventionCode === req.params.code && !p.cancelledAt);
  if (!pa) throw notFound('No active preauthorization for this intervention');
  const data = await call(req, v, 'sha.preauth.cancel', { body: { consent_token: consentToken(v), intervention_code: String(req.params.code) } });
  Object.assign(pa, { cancelledAt: new Date(), cancelledBy: req.user!.id, cancelReason: reason, lastResponse: redact(data), status: pick(body0(data), 'status') ?? 'cancelled' });
  v.markModified('preauths');
  history(v, req, 'preauth_cancelled', `${req.params.code}: ${reason}`);
  await v.save();
  await audit(req, { action: 'sha.preauth.cancel', resource: 'sha_visit', resourceId: String(v._id), newValue: { interventionCode: req.params.code, reason } });
  res.json({ success: true, data: pa });
}));

router.delete('/visits/:id/preauths/:code/:what', requirePermission('sha.preauthorization'), h(async (req, res) => {
  const what = z.enum(['diagnoses', 'doctors']).parse(req.params.what);
  const body = parse(z.object({ codes: z.array(z.string().max(60)).min(1).max(20), extra: extraSchema }), req.body);
  const v = await loadVisit(req, true);
  const data = await call(req, v, `sha.preauth.${what}.delete`, { body: { ...(body.extra ?? {}), consent_token: consentToken(v), intervention_code: String(req.params.code), [what]: body.codes } });
  history(v, req, `preauth_${what}_removed`, body.codes.join(', '));
  await v.save();
  await audit(req, { action: `sha.preauth.${what}_remove`, resource: 'sha_visit', resourceId: String(v._id), newValue: body.codes });
  res.json({ success: true, data });
}));

/* ---- POMSF effective coverage (principal CR ID may differ from the patient's CR ID) */
router.post('/visits/:id/effective-coverage', requirePermission('sha.claim'), h(async (req, res) => {
  const body = parse(z.object({ policyNumber: z.string().min(2).max(80), principalCrId: z.string().min(4).max(40) }), req.body);
  const v = await loadVisit(req, true);
  const data = await call(req, v, 'sha.coverage.effective', { body: { consent_token: consentToken(v), policy_number: body.policyNumber, principal_cr_id: body.principalCrId } });
  v.set('effectiveCoverage', { ...body, response: redact(data), at: new Date() });
  await v.save();
  res.json({ success: true, data });
}));

/* ---- Claim steps on the virtual claim. These operations' paths are entered by the owner from the docs. */
const STEP_OP: Record<string, string> = {
  diagnoses: 'sha.claim.diagnoses.add',
  'billable-items': 'sha.billing.lineItems',
  preview: 'sha.claim.preview.provider',
  submit: 'sha.virtualClaim.submit',
  discharge: 'sha.claim.discharge',
  close: 'sha.virtualClaim.close',
  'lines-edit': 'sha.claim.lines.edit',
  'lines-resubmit': 'sha.claim.lines.resubmit',
};

router.post('/visits/:id/claim-steps/:step', requirePermission('sha.claim'), h(async (req, res) => {
  const step = String(req.params.step);
  const m = req.tenant!.models;
  const v = await loadVisit(req, true);
  if (!v.dha?.claimId) throw conflict('Start the visit first', undefined, 'SHA_VISIT_NOT_STARTED');
  const tx = v.claimTransactionId ? await m.ShaTransaction.findById(v.claimTransactionId) : null;
  const token = consentToken(v);
  const base = { consent_token: token, claim_id: v.dha.claimId };
  const openPreauth = v.preauths.filter((p) => !p.cancelledAt && !/approved/i.test(p.status ?? ''));
  let data: unknown;
  switch (step) {
    case 'diagnoses': {
      if (!tx?.diagnoses.length) throw badRequest('Record diagnoses on the linked claim first');
      data = await call(req, v, STEP_OP[step], { body: { ...base, diagnoses: tx.diagnoses.map((d) => ({ code: d.code, description: d.display })) }, idempotencyKey: `shavisit:${v._id}:dx:${tx.diagnoses.length}` });
      break;
    }
    case 'billable-items': {
      if (!tx?.lines.length) throw badRequest('Add billable items on the linked claim first');
      data = await call(req, v, STEP_OP[step], { body: { ...base, items: tx.lines.map((l) => ({ code: l.serviceCode, description: l.description, quantity: l.quantity, unit_price: l.unitPrice, amount: l.amount })) }, idempotencyKey: `shavisit:${v._id}:items:${tx.lines.length}` });
      break;
    }
    case 'attachments': {
      const { documentId, documentType } = parse(z.object({ documentId: z.string(), documentType: z.string().min(2).max(80) }), req.body);
      const d = await m.Document.findOne({ _id: oid(documentId, 'Document'), patientId: v.patientId, deletedAt: null }).select('+storageKey').lean();
      if (!d) throw badRequest('Document not found for this patient');
      const form = new FormData();
      form.set('consent_token', token);
      form.set('claim_id', v.dha.claimId);
      form.set('document_type', documentType);
      form.append('file', new Blob([new Uint8Array(await localStorageDriver.read(d.storageKey))], { type: d.mimeType ?? 'application/octet-stream' }), d.fileName ?? 'document');
      data = await call(req, v, 'sha.claim.attachments.add', { body: form, idempotencyKey: `shavisit:${v._id}:att:${documentId}` });
      if (tx) await m.ShaTransaction.updateOne({ _id: tx._id }, { $addToSet: { attachmentIds: d._id } });
      break;
    }
    case 'preview':
      data = await call(req, v, STEP_OP[step], { query: { claim_id: v.dha.claimId } });
      break;
    case 'submit':
    case 'discharge': {
      if (step === 'submit' && v.serviceType === 'INPATIENT') throw conflict('Inpatient claims are dispatched by discharging the patient', undefined, 'SHA_USE_DISCHARGE');
      if (step === 'discharge' && v.serviceType !== 'INPATIENT') throw conflict('Only inpatient visits are discharged; submit outpatient/emergency claims', undefined, 'SHA_USE_SUBMIT');
      if (openPreauth.length) throw conflict(`Preauthorization is not approved for ${openPreauth.map((p) => p.interventionCode).join(', ')}`, undefined, 'SHA_PREAUTH_PENDING');
      data = await call(req, v, STEP_OP[step], { body: base, idempotencyKey: `shavisit:${v._id}:${step}` });
      v.status = step === 'submit' ? 'submitted' : 'discharged';
      if (tx && ['draft', 'failed'].includes(tx.status)) {
        tx.status = 'submitted';
        tx.statusHistory.push({ status: 'submitted', at: new Date(), source: 'sha', note: step });
        tx.submittedAt = new Date();
        tx.lastResponse = redact(data) as never;
        await tx.save();
      }
      break;
    }
    case 'close':
      data = await call(req, v, STEP_OP[step], { body: base, idempotencyKey: `shavisit:${v._id}:close` });
      v.status = 'closed';
      break;
    case 'lines-edit':
    case 'lines-resubmit': {
      const { items, extra } = parse(z.object({ items: z.array(z.record(z.string(), z.union([z.string().max(200), z.number()]))).min(1).max(100), extra: extraSchema }), req.body);
      data = await call(req, v, STEP_OP[step], { body: { ...(extra ?? {}), ...base, items } });
      break;
    }
    default:
      throw notFound('Unknown claim step');
  }
  v.claimSteps.push({ step, at: new Date(), by: req.user!.id as never, ok: true });
  history(v, req, `claim_${step}`);
  await v.save();
  await audit(req, { action: `sha.visit.${step}`, resource: 'sha_visit', resourceId: String(v._id), newValue: { claimId: v.dha.claimId } });
  res.json({ success: true, data: { visit: v, response: redact(data) } });
}));

/** Link an AfeySync claim (built from the SHA invoice) to the virtual claim. */
router.post('/visits/:id/link-claim', requirePermission('sha.claim'), h(async (req, res) => {
  const { transactionId } = parse(z.object({ transactionId: z.string() }), req.body);
  const v = await loadVisit(req);
  const tx = await loadScoped(req, req.tenant!.models.ShaTransaction, transactionId, 'Transaction');
  if (String(tx.patientId) !== String(v.patientId)) throw badRequest('Claim belongs to another patient');
  tx.shaVisitId = v._id as never;
  if (v.dha?.claimId) tx.externalReference = v.dha.claimId;
  tx.accessPoint = v.serviceType === 'INPATIENT' ? 'IP' : 'OP';
  if (!tx.interventionCode) tx.interventionCode = v.interventions.find((i) => i.state === 'active')?.code;
  await tx.save();
  v.claimTransactionId = tx._id as never;
  if (v.status === 'visit_started') v.status = 'in_progress';
  history(v, req, 'claim_linked', tx.reference);
  await v.save();
  res.json({ success: true, data: v });
}));

export default router;
