import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { api, configureHie, createFacility, createUser, OWNER_HOST, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';
import { decideWorkflow, interventionFlags } from '../src/modules/sha/shaWorkflow';
import { getTenantBaseConn } from '../src/db/connections';
import { env } from '../src/config/env';

/* Test double for the DHA HIE eClaims endpoints used in this workflow (tests only). */
type Call = { method: string; path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders; body: string };
const calls: Call[] = [];
const PEOPLE: Record<string, Record<string, unknown>> = {
  '11111111': { fullName: 'AMINA HASSAN', memberCrNumber: 'CR1000000001', isAlive: true, whitelistedForOTP: true, facilityBiometricsEnforced: false, statusCode: '1', statusDesc: 'Active', schemes: [{ code: 'POMSF-NPS', name: 'POMSF National Police', policy_number: 'POL-77', principal_cr_id: 'CR9000000009' }] },
  '22222222': { fullName: 'LATE MEMBER', memberCrNumber: 'CR1000000002', isAlive: false, statusDesc: 'Active', schemes: [] },
  '33333333': { fullName: 'BIO ONLY', memberCrNumber: 'CR1000000003', isAlive: true, whitelistedForOTP: false, facilityBiometricsEnforced: true, statusDesc: 'Active', schemes: [] },
  '44444444': { fullName: 'CHILD MEMBER', memberCrNumber: 'CR1000000004-2', isAlive: true, whitelistedForOTP: false, facilityBiometricsEnforced: true, statusDesc: 'Active', schemes: [], biometric_status: { use_sil_biometrics: true } },
};
/** Mutable HIE state for the consent flows. */
const hie = { authStatus: 'PENDING', verifications: 0, rejected: [] as string[], endpoints: [] as Array<Record<string, unknown>>, ops: [] as Array<Record<string, unknown>> };
const INTERVENTIONS: Record<string, Record<string, unknown>> = {
  'OP-CONS': { code: 'OP-CONS', name: 'Outpatient consultation', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: false, needsManualPreauthApproval: false, accessPoint: 'OP', fund: 'PHC', status: 'ACTIVE' },
  'IP-ADM': { code: 'IP-ADM', name: 'Inpatient admission', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: false, accessPoint: 'IP', fund: 'SHIF', status: 'ACTIVE' },
  'SURG-1': { code: 'SURG-1', name: 'Minor surgery', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: true, needsManualPreauthApproval: false, requiresSurgicalPreauth: true, accessPoint: 'OP', fund: 'SHIF', requiredPreauthDocumentTypes: ['REFERRAL_LETTER'], status: 'ACTIVE' },
};
const stub = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    calls.push({ method: req.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const json = (s: number, d: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const p = url.pathname.replace('/api/v1', '');
    const q = url.searchParams;
    if (p === '/tenants/token') return json(200, { access_token: 'tok', expires_in: 3600 });
    if (p === '/patients/eligibility') return json(200, { data: PEOPLE[q.get('identification_number') ?? ''] ?? PEOPLE[Object.keys(PEOPLE).find((k) => PEOPLE[k].memberCrNumber === q.get('identification_number'))!] });
    if (p === '/patients/benefits/interventions') return json(200, { data: INTERVENTIONS[q.get('code') ?? ''] ? [INTERVENTIONS[q.get('code')!]] : [] });
    if (p === '/patients/contacts') return json(200, { count: 1, results: [{ id: 1, contactType: 'PHONE', contactValue: '+254714***898', isConfirmed: true, active: true }] });
    if (p === '/claims/otp') return json(200, { message: 'OTP sent' });
    if (p === '/claims/otp/discharge') return json(200, { message: 'OTP sent' });
    if (p === '/claims/authorizations' && req.method === 'GET') return json(200, [{ guid: 'GUID-BIO', status: hie.authStatus, token: 'BIO-TOKEN-XYZ', authCode: hie.authStatus === 'PENDING' ? undefined : 'AUTH-BIO' }]);
    const rej = p.match(/^\/claims\/authorizations\/([^/]+)\/reject$/);
    if (rej) { hie.rejected.push(decodeURIComponent(rej[1])); return json(200, { message: 'rejected' }); }
    if (p === '/biometrics/matches' && req.method === 'POST') {
      const b = JSON.parse(body);
      if (!b.health_id || !b.workstation_id || !b.device_id || !b.agent_id) return json(400, { message: 'missing field' });
      if (b.workstation_id === 'WS-OFFLINE') return json(503, { message: 'workstation not live' });
      if (b.health_id === 'CR1000000009') return json(422, { error_code: 'subject_not_enrolled', message: 'not enrolled' });
      return json(202, { match_id: 'MATCH-1', matched: false, status: 'pending', next_action: { type: 'await_callback' } });
    }
    if (p === '/biometrics/enrollments') { const b = JSON.parse(body); return b.workstation_id === 'WS-OFFLINE' ? json(503, { message: 'workstation not live' }) : json(202, { job_id: 'JOB-E1', status: 'dispatched', next_action: 'await_callback' }); }
    if (p === '/biometrics/verifications') return json(202, { job_id: `JOB-V${++hie.verifications}`, status: 'dispatched', next_action: 'await_callback' });
    if (p === '/biometrics/enrollment-status') return json(200, { enrollment_status: 'partially_enrolled', verified: [1, 2], non_verified: [3], total: 3 });
    if (p === '/patients/otp-whitelists' && req.method === 'POST') return json(200, { guid: 'WL-1', status: 'PENDING', beneficiaryCrId: 'CR1000000004-2' });
    if (p === '/patients/otp-whitelists/callback') return json(200, { count: 1, results: [{ guid: 'WL-1', status: 'APPROVED', reason: 'x', reasonType: 'BIOMETRIC_FAILURE', reviewerResponseNotes: [{ responseNotes: 'Approved for OTP' }] }] });
    const tEp = p.match(/^\/tenants\/([^/]+)\/endpoints$/);
    if (tEp && req.method === 'GET') return json(200, hie.endpoints.map((e) => ({ ...e, operations: hie.ops.filter((o) => o.endpoint_id === e.endpoint_id) })));
    if (tEp && req.method === 'POST') { const b = JSON.parse(body); const e = { ...b, endpoint_id: `EP-${b.entity_type}`, is_active: true, tenant_id: tEp[1] }; hie.endpoints.push(e); return json(201, e); }
    const tOps = p.match(/^\/tenants\/([^/]+)\/endpoints\/([^/]+)\/operations$/);
    if (tOps && req.method === 'GET') return json(200, hie.ops.filter((o) => o.endpoint_id === tOps[2]));
    if (tOps && req.method === 'POST') { const o = { ...JSON.parse(body), endpoint_id: tOps[2], operation_id: `OP-${tOps[2]}`, is_active: true }; hie.ops.push(o); return json(201, o); }
    if (p === '/claims/authorize') {
      const b = JSON.parse(body);
      if (b.factors) return json(200, { guid: 'GUID-BIO', token: 'BIO-TOKEN-XYZ', status: 'PENDING', shaVerificationRequestId: 'REQ-1', shaVerificationRequest: { requestUrl: 'https://ekyc.example/verify/123', embedExpiry: 120, embededToken: 'EMBED-1', requestId: 'REQ-1' } });
      if (b.otp !== '123456') return json(400, { message: 'Invalid OTP' });
      return json(200, { data: { authCode: 'AUTH-1', guid: 'GUID-1', token: 'CONSENT-TOKEN-SECRET-123', status: 'AUTHORIZED', expiry: '2030-01-01T00:00:00Z' } });
    }
    if (p === '/claims/visit') return json(200, { data: { claim_id: 'CLM-900', edi_claim_guid: 'EDI-1', visit_number: 'SHA-V-1', invoice_number: 'SHA-INV-1', workflow_state: 'OPEN', total_claim_amount: 0, member_number: 'M-1', scheme_name: 'SHIF' } });
    if (p === '/preauths' && req.method === 'GET') return json(200, { data: { status: 'APPROVED', preauthType: 'SURGICAL', totalEstimatedAmountForPreauth: 12000, finalApprovedAmount: 10000, doctorReviewStatus: 'REVIEWED' } });
    if (p.startsWith('/claims/') || p.startsWith('/preauths') || p.startsWith('/patients/') || p.startsWith('/__test__/')) return json(200, { ok: true });
    json(404, { message: 'no route' });
  });
});

const S = 'shavf';
let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let officer: string;
let patientId: string;
let visitId: string;

async function setOp(key: string, path: string | null, method = 'POST') {
  const c = await api().get('/api/v1/owner/contracts/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
  const r = await api().patch('/api/v1/owner/contracts/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ contractVersion: c.body.data.contractVersion, operations: [{ key, path, method }] });
  expect(r.status).toBe(200);
}
async function patient(id: string, cr: string) {
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'P', lastName: id, gender: 'female', nationalId: id, clientRegistryId: cr });
  await t(S, officer).post('/api/v1/sha/eligibility').send({ patientId: p.body.data._id });
  return p.body.data._id as string;
}

beforeAll(async () => {
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  await setupApp();
  owner = await ownerToken();
  await configureHie(owner, `http://127.0.0.1:${(stub.address() as AddressInfo).port}/api/v1`);
  F = await createFacility(owner, S);
  await api().patch(`/api/v1/owner/tenants/${F.id}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ dhaFacilityRegistryCode: 'FID-47-000777-9' });
  admin = (await tenantLogin(S, F.admin.email)).token;
  officer = await createUser(S, admin, { email: 'sho@shav.test', roleKey: 'sha_officer', branchAccess: 'all', branchIds: [] });
  patientId = await patient('11111111', 'CR1000000001');
});
afterAll(async () => {
  stub.close();
  await teardown();
});

describe('contract and facility identity', () => {
  it('seeds the eClaims paths from the specification, flagged for verification', async () => {
    const c = await api().get('/api/v1/owner/contracts/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    const op = (k: string) => c.body.data.supportedOperations.find((o: { key: string }) => o.key === k);
    expect(op('sha.visit.consent.start')).toEqual(expect.objectContaining({ path: '/claims/visit', verification: 'spec_unverified' }));
    expect(op('sha.preauth.create')).toEqual(expect.objectContaining({ path: '/preauths', contentType: 'multipart/form-data' }));
    expect(op('sha.eligibility').verification).toBe('documented');
    expect(op('sha.virtualClaim.submit').path).toBeNull(); // not supplied: never guessed
    expect(op('sha.claim.discharge').path).toBeNull();
  });

  it("sends this facility's own FR code, not the platform default", async () => {
    const elig = calls.filter((c) => c.path.endsWith('/patients/eligibility')).at(-1)!;
    expect(elig.headers['x-facility-id']).toBe('FID-47-000777-9');
    expect(elig.headers['x-facility-id-type']).toBe('fr-code');
  });

  it('exposes connection status without secrets', async () => {
    const r = await t(S, admin).get('/api/v1/sha/connection');
    expect(r.body.data).toEqual(expect.objectContaining({ enabled: true, frCode: 'FID-47-000777-9', environment: 'uat' }));
    expect(JSON.stringify(r.body)).not.toMatch(/good-secret|clientSecret|client-1/);
    expect((await t(S, admin).post('/api/v1/sha/connection/test')).body.data.status).toBe('CONNECTED');
  });
});

describe('eligibility and deceased beneficiaries', () => {
  it('stores OTP/biometric flags and detects POMSF by prefix', async () => {
    const p = await t(S, officer).get(`/api/v1/patients/${patientId}`);
    expect(p.body.data.sha).toEqual(expect.objectContaining({ isAlive: true, whitelistedForOTP: true }));
    expect(p.body.data.sha.pomsf).toEqual({ code: 'POMSF-NPS', policyNumber: 'POL-77', principalCrId: 'CR9000000009' });
  });

  it('blocks every SHA transaction when isAlive is false', async () => {
    const dead = await patient('22222222', 'CR1000000002');
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId: dead, interventionCodes: ['OP-CONS'] });
    expect(v.body.error.code).toBe('SHA_BENEFICIARY_DECEASED');
    expect((await t(S, admin).post('/api/v1/visits').send({ patientId: dead, payer: { type: 'sha' } })).body.error.code).toBe('SHA_BENEFICIARY_DECEASED');
    expect((await t(S, officer).post('/api/v1/sha/transactions').set('X-Branch-Id', F.branches[0].id).send({ kind: 'claim', patientId: dead })).body.error.code).toBe('SHA_BENEFICIARY_DECEASED');
  });
});

describe('workflow decision engine', () => {
  it('uses only DHA flags', () => {
    const d = decideWorkflow([interventionFlags(INTERVENTIONS['OP-CONS']), interventionFlags(INTERVENTIONS['SURG-1'])]);
    expect(d).toEqual(expect.objectContaining({ serviceType: 'OUTPATIENT', needsPreauth: true, manualApproval: false, preauthInterventions: ['SURG-1'], specialPreauth: ['surgical'], requiredDocuments: ['REFERRAL_LETTER'] }));
    expect(d.steps).toContain('preauthorization');
    expect(decideWorkflow([interventionFlags({ code: 'X', accessPoint: 'IP', needsPreauth: false })]).steps.at(-1)).toBe('discharge');
    expect(decideWorkflow([interventionFlags({ code: 'X' })]).warnings[0]).toMatch(/did not return needsPreauth/);
  });

  it('fetches flags from DHA for the selected interventions', async () => {
    const r = await t(S, officer).post('/api/v1/sha/workflow').send({ patientId, interventionCodes: ['OP-CONS', 'SURG-1'] });
    expect(r.body.data.decision.preauthInterventions).toEqual(['SURG-1']);
    expect((await t(S, officer).post('/api/v1/sha/workflow').send({ patientId, interventionCodes: ['NOPE'] })).body.error.code).toBe('SHA_INTERVENTION_NOT_COVERED');
  });
});

describe('consent, authorization and visit', () => {
  it('creates the visit, lists masked contacts and sends the OTP', async () => {
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId, interventionCodes: ['OP-CONS', 'SURG-1'] });
    expect(v.status).toBe(201);
    visitId = v.body.data._id;
    expect(v.body.data.status).toBe('consent_pending');
    const c = await t(S, officer).get(`/api/v1/sha/visits/${visitId}/contacts`);
    expect(c.body.data.results[0].contactValue).toBe('+254714***898');
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/otp`).send({ contactId: 1 })).status).toBe(200);
    // Send OTP body per the Consent Services reference: patient_id, intervention_codes, contact_id.
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ patient_id: 'CR1000000001', intervention_codes: ['OP-CONS', 'SURG-1'], contact_id: 1 });
  });

  it('authorizes with OTP and keeps the consent token encrypted and private', async () => {
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/authorize`).send({ method: 'otp', otp: '000000' })).status).toBeGreaterThanOrEqual(400);
    const a = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/authorize`).send({ method: 'otp', otp: '123456' });
    expect(a.body.data.status).toBe('authorized');
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/claims/authorize')).at(-1)!.body)).toEqual({ patient_id: 'CR1000000001', service_type: 'OUTPATIENT', otp: '123456', interventions: ['OP-CONS', 'SURG-1'] });
    const g = await t(S, officer).get(`/api/v1/sha/visits/${visitId}`);
    expect(JSON.stringify(g.body)).not.toContain('CONSENT-TOKEN-SECRET-123');
    const db = getTenantBaseConn().useDb(`${env.TENANT_DB_PREFIX}${S}`);
    const raw = await db.collection('shavisits').findOne({});
    expect(JSON.stringify(raw)).not.toContain('CONSENT-TOKEN-SECRET-123');
    expect(JSON.stringify(raw)).not.toContain('123456');
  });

  it('starts the visit and stores the virtual-claim identifiers', async () => {
    const s = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/start`).send({ otp: '123456', practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: 'KMPDC-1234', practitionerRegulationBody: 'KMPDC' });
    expect(s.status).toBe(200);
    expect(s.body.data.dha).toEqual(expect.objectContaining({ claimId: 'CLM-900', ediClaimGuid: 'EDI-1', visitNumber: 'SHA-V-1', invoiceNumber: 'SHA-INV-1', workflowState: 'OPEN' }));
    expect(s.body.data.status).toBe('preauth_pending');
    const sent = JSON.parse(calls.filter((c) => c.path.endsWith('/claims/visit')).at(-1)!.body);
    expect(sent).toEqual(expect.objectContaining({ intervention_codes: ['OP-CONS', 'SURG-1'], patient_id: 'CR1000000001', service_type: 'OUTPATIENT', practitioner_regulation_body: 'KMPDC' }));
  });

  it('retire / restore are distinct operations carrying the consent token', async () => {
    await t(S, officer).post(`/api/v1/sha/visits/${visitId}/interventions/retire`).send({ interventionCode: 'OP-CONS' });
    const c = calls.at(-1)!;
    expect(c.path).toBe('/api/v1/claims/interventions/retire');
    expect(JSON.parse(c.body)).toEqual(expect.objectContaining({ consent_token: 'CONSENT-TOKEN-SECRET-123', claim_id: 'CLM-900', intervention_code: 'OP-CONS' }));
    const r = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/interventions/restore`).send({ interventionCode: 'OP-CONS' });
    expect(calls.at(-1)!.path).toBe('/api/v1/claims/interventions/restore');
    expect(r.body.data.visit.interventions.find((i: { code: string }) => i.code === 'OP-CONS').state).toBe('active');
  });
});

describe('preauthorization', () => {
  it('only when DHA requires it; multipart with documents; fetch; cancel', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x20), Buffer.from('\n%%EOF')]);
    const doc = await t(S, officer, F.branches[0].id).post('/api/v1/documents').field('category', 'referral').field('title', 'Referral letter').field('patientId', patientId).attach('file', pdf, 'referral.pdf');
    const base = { serviceStart: '2030-01-01', serviceEnd: '2030-01-02', items: [{ description: 'Excision', quantity: 1, unitPrice: 12000 }], diagnoses: [{ code: 'XA00', description: 'Lesion' }], documentIds: [doc.body.data._id] };
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/preauths`).send({ ...base, interventionCode: 'OP-CONS' })).body.error.code).toBe('SHA_PREAUTH_NOT_REQUIRED');
    const pa = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/preauths`).send({ ...base, interventionCode: 'SURG-1' });
    expect(pa.status).toBe(201);
    const c = calls.filter((x) => x.path === '/api/v1/preauths' && x.method === 'POST').at(-1)!;
    expect(c.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(c.body).toContain('name="consent_token"');
    expect(c.body).toContain('name="attachments"; filename="referral.pdf"');
    expect(c.body).toContain('%PDF-1.4');
    const g = await t(S, officer).get(`/api/v1/sha/visits/${visitId}/preauths/SURG-1`);
    expect(g.body.data).toEqual(expect.objectContaining({ status: 'APPROVED', finalApproved: 10000, preauthType: 'SURGICAL' }));
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/preauths/SURG-1/cancel`).send({ reason: 'x' })).status).toBe(400);
  });
});

describe('claim steps', () => {
  it('submits outpatient claims only once the operation is configured; discharge is for inpatients', async () => {
    const s = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/claim-steps/submit`);
    expect(s.body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/claim-steps/discharge`)).body.error.code).toBe('SHA_USE_SUBMIT');
    await setOp('sha.virtualClaim.submit', '/__test__/submit');
    const ok = await t(S, officer).post(`/api/v1/sha/visits/${visitId}/claim-steps/submit`);
    expect(ok.body.data.visit.status).toBe('submitted');
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ consent_token: 'CONSENT-TOKEN-SECRET-123', claim_id: 'CLM-900' });
    const v = await t(S, officer).get(`/api/v1/sha/visits/${visitId}`);
    expect(v.body.data.responses.length).toBeGreaterThan(3);
  });
});

describe('biometrics (adult)', () => {
  let bioVisit = '';
  it('creates a PENDING authorization with the capture iframe; never assumes success; OTP refused when enforced', async () => {
    const bio = await patient('33333333', 'CR1000000003');
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId: bio, interventionCodes: ['OP-CONS'] });
    bioVisit = v.body.data._id;
    expect((await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/otp`).send({})).body.error.code).toBe('SHA_BIOMETRICS_REQUIRED');
    expect((await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorize`).send({ method: 'biometric', deviceOs: 'windows' })).status).toBe(400); // workstation + agent are required
    const a = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorize`).send({ method: 'biometric', deviceOs: 'windows', workStationId: 'WS-0001', agentId: '12345678' });
    expect(a.body.data).toEqual(expect.objectContaining({ status: 'biometric_pending', authorized: false }));
    expect(a.body.data.capture).toEqual(expect.objectContaining({ url: 'https://ekyc.example/verify/123', embeddedToken: 'EMBED-1' }));
    expect(new Date(a.body.data.capture.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const sent = JSON.parse(calls.filter((c) => c.path.endsWith('/claims/authorize')).at(-1)!.body);
    expect(sent).toEqual(expect.objectContaining({ factors: ['SHA'], is_integration: true, authorizing_device_os: 'windows', provider: 'FID-47-000777-9', work_station_id: 'WS-0001', agent_id: '12345678' }));
    // A second authorization while one is PENDING is refused locally (the HIE would block it too).
    expect((await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorize`).send({ method: 'biometric', deviceOs: 'windows', workStationId: 'WS-0001', agentId: '12345678' })).body.error.code).toBe('SHA_AUTHORIZATION_PENDING');
    // The consent token and the embed token are never stored or shown later.
    const g = await t(S, officer).get(`/api/v1/sha/visits/${bioVisit}`);
    expect(JSON.stringify(g.body)).not.toMatch(/BIO-TOKEN-XYZ|EMBED-1/);
    const s1 = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/start`).send({ practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: 'K-1', practitionerRegulationBody: 'KMPDC' });
    expect(s1.body.error.code).toBe('SHA_AUTHORIZATION_PENDING');
  });

  it('an expired capture stays PENDING: reject it, then create a fresh authorization', async () => {
    const r = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorization/refresh`);
    expect(r.body.data.authorized).toBe(false);
    expect(calls.filter((c) => c.path.endsWith('/claims/authorizations')).at(-1)!.query).toEqual({ guid: 'GUID-BIO' });
    const rj = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorization/reject`).send({ reason: 'Capture window expired' });
    expect(rj.body.data.status).toBe('consent_pending');
    expect(hie.rejected).toEqual(['BIO-TOKEN-XYZ']);
    const again = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorize`).send({ method: 'biometric', deviceOs: 'windows', workStationId: 'WS-0001', agentId: '12345678' });
    expect(again.body.data.status).toBe('biometric_pending');
  });

  it('confirms the match with Get Authorizations (AUTHORIZED_PENDING_VISIT counts as captured)', async () => {
    hie.authStatus = 'AUTHORIZED_PENDING_VISIT';
    const r = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorization/refresh`);
    expect(r.body.data).toEqual(expect.objectContaining({ authorized: true, status: 'authorized' }));
    expect(r.body.data.consent.status).toBe('AUTHORIZED_PENDING_VISIT');
    expect((await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/authorization/reject`).send({})).body.error.code).toBe('SHA_AUTHORIZATION_COMPLETE');
    const s1 = await t(S, officer).post(`/api/v1/sha/visits/${bioVisit}/start`).send({ practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: 'K-1', practitionerRegulationBody: 'KMPDC' });
    expect(s1.status).toBe(200);
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/claims/visit')).at(-1)!.body).auth_guid).toBe('GUID-BIO');
  });
});

let routingChild = '';
const childIdForRouting = () => routingChild;
describe('inpatient discharge authorization', () => {
  it('keeps the fingerprint discharge authorization apart from the visit consent; discharge OTP carries the consent token', async () => {
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId, interventionCodes: ['IP-ADM'] });
    const id = v.body.data._id;
    expect(v.body.data.serviceType).toBe('INPATIENT');
    await t(S, officer).post(`/api/v1/sha/visits/${id}/authorize`).send({ method: 'otp', otp: '123456' });
    const started = await t(S, officer).post(`/api/v1/sha/visits/${id}/start`).send({ otp: '123456', practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: 'K-1', practitionerRegulationBody: 'KMPDC' });
    expect(started.status).toBe(200);
    hie.authStatus = 'PENDING';
    const d = await t(S, officer).post(`/api/v1/sha/visits/${id}/authorize`).send({ method: 'biometric', deviceOs: 'windows', workStationId: 'WS-0001', agentId: '12345678', isDischargeAuthorization: true });
    expect(d.body.data.dischargeAuth).toEqual(expect.objectContaining({ status: 'PENDING', authGuid: 'GUID-BIO' }));
    expect(d.body.data.status).toBe('visit_started'); // the visit itself is untouched
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/claims/authorize')).at(-1)!.body).is_biometrics_discharge_authorization).toBe(true);
    await t(S, officer).post(`/api/v1/sha/visits/${id}/discharge-otp`);
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/claims/otp/discharge')).at(-1)!.body)).toEqual({ consent_token: 'CONSENT-TOKEN-SECRET-123', patient_id: 'CR1000000001' });
    const rj = await t(S, officer).post(`/api/v1/sha/visits/${id}/authorization/reject`).send({ discharge: true });
    expect(rj.status).toBe(200);
    expect(hie.rejected.at(-1)).toBe('BIO-TOKEN-XYZ');
  });
});

describe('minors biometrics', () => {
  let childId = '';
  let childVisit = '';
  let callbackUrl = '';
  const ws = { workstationId: 'WS-0001', deviceId: 'FP-READER-01', agentId: '12345678' };
  const post = (payload: Record<string, unknown>) => api().post(new URL(callbackUrl).pathname).send(payload);

  it('reads use_sil_biometrics from eligibility and only then offers the minors route', async () => {
    childId = await patient('44444444', 'CR1000000004-2');
    routingChild = childId;
    const p = await t(S, officer).get(`/api/v1/patients/${childId}`);
    expect(p.body.data.sha.useSilBiometrics).toBe(true);
    const adult = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId, interventionCodes: ['OP-CONS'] });
    expect((await t(S, officer).post(`/api/v1/sha/visits/${adult.body.data._id}/minor-match`).send(ws)).body.error.code).toBe('SHA_MINOR_BIOMETRICS_NOT_ELIGIBLE');
    const ep = await t(S, admin).post('/api/v1/sha/callback-endpoints').send({ provider: 'sha' });
    callbackUrl = ep.body.data.url;
  });

  it('enrols then verifies a finger, each outcome arriving by callback', async () => {
    const st = await t(S, officer).get('/api/v1/sha/biometrics/enrollment-status').query({ patientId: childId });
    expect(st.body.data).toEqual(expect.objectContaining({ beneficiaryCode: 'CR1000000004-2', enrollmentStatus: 'partially_enrolled', verified: [1, 2], nonVerified: [3], total: 3 }));
    expect((await t(S, officer).post('/api/v1/sha/biometrics/enrollments').send({ patientId: childId, position: 4, ...ws, workstationId: 'WS-OFFLINE' })).body.error.code).toBe('SHA_WORKSTATION_OFFLINE');
    const e = await t(S, officer).post('/api/v1/sha/biometrics/enrollments').send({ patientId: childId, position: 4, ...ws });
    expect(e.status).toBe(202);
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/biometrics/enrollments')).at(-1)!.body)).toEqual({ beneficiary_code: 'CR1000000004-2', workstation_id: 'WS-0001', device_id: 'FP-READER-01', agent_id: '12345678', position: 4 });
    const cb = await post({ job_id: 'JOB-E1', status: 'completed' });
    expect(cb.status).toBe(200);
    expect((await t(S, officer).get(`/api/v1/sha/biometrics/jobs/${e.body.data._id}`)).body.data).toEqual(expect.objectContaining({ status: 'succeeded', outcome: 'enrolled', resolvedBy: 'callback' }));
    const v = await t(S, officer).post('/api/v1/sha/biometrics/verifications').send({ patientId: childId, position: 4, ...ws });
    await post({ job_id: 'JOB-V1', verified: false, status: 'not_verified', attempts_remaining: 2 });
    expect((await t(S, officer).get(`/api/v1/sha/biometrics/jobs/${v.body.data._id}`)).body.data).toEqual(expect.objectContaining({ status: 'failed', outcome: 'not_verified', attemptsRemaining: 2 }));
  });

  it('dispatches a match (202), waits for the callback, then starts the visit with match_id', async () => {
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId: childId, interventionCodes: ['OP-CONS'] });
    childVisit = v.body.data._id;
    expect((await t(S, officer).post(`/api/v1/sha/visits/${childVisit}/otp`).send({})).body.error.code).toBe('SHA_BIOMETRICS_REQUIRED');
    const m = await t(S, officer).post(`/api/v1/sha/visits/${childVisit}/minor-match`).send(ws);
    expect(m.status).toBe(202);
    expect(JSON.parse(calls.filter((c) => c.path.endsWith('/biometrics/matches')).at(-1)!.body)).toEqual({ health_id: 'CR1000000004-2', workstation_id: 'WS-0001', device_id: 'FP-READER-01', agent_id: '12345678' });
    const practitioner = { practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: 'K-1', practitionerRegulationBody: 'KMPDC' };
    expect((await t(S, officer).post(`/api/v1/sha/visits/${childVisit}/start`).send(practitioner)).body.error.code).toBe('SHA_MATCH_REQUIRED');
    await post({ match_id: 'MATCH-1', status: 'matched', matched: true, expires_at: new Date(Date.now() + 500_000).toISOString() });
    const g = await t(S, officer).get(`/api/v1/sha/visits/${childVisit}`);
    expect(g.body.data.consent.match).toEqual(expect.objectContaining({ matchId: 'MATCH-1', status: 'matched' }));
    const s1 = await t(S, officer).post(`/api/v1/sha/visits/${childVisit}/start`).send(practitioner);
    expect(s1.status).toBe(200);
    const sent = JSON.parse(calls.filter((c) => c.path.endsWith('/claims/visit')).at(-1)!.body);
    expect(sent.match_id).toBe('MATCH-1');
    expect(sent.auth_guid).toBeUndefined();
  });

  it('asks for OTP whitelisting when a child cannot match, and syncs SHA\'s review', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(50, 0x20), Buffer.from('\n%%EOF')]);
    const doc = await t(S, officer, F.branches[0].id).post('/api/v1/documents').field('category', 'sha').field('title', 'Clinician note').field('patientId', childId).attach('file', pdf, 'note.pdf');
    const w = await t(S, officer).post('/api/v1/sha/otp-whitelists').send({ patientId: childId, reasonType: 'BIOMETRIC_FAILURE', reason: 'Fingerprints could not be matched after several attempts.', biometricAttempts: 3, attachments: [{ documentId: doc.body.data._id }] });
    expect(w.status).toBe(201);
    const c = calls.filter((x) => x.path.endsWith('/patients/otp-whitelists')).at(-1)!;
    expect(c.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(c.body).toContain('name="reason_type"');
    expect(c.body).toContain('"file_field_name":"attachment_1"');
    expect(c.body).toContain('name="attachment_1"; filename="note.pdf"');
    const l = await t(S, officer).get('/api/v1/sha/otp-whitelists').query({ patientId: childId });
    expect(l.body.data[0]).toEqual(expect.objectContaining({ guid: 'WL-1', status: 'APPROVED', reviewerNotes: ['Approved for OTP'] }));
  });
});

describe('status callback registration', () => {
  it('facilities on the platform connection are registered by the platform owner', async () => {
    expect((await t(S, admin).post('/api/v1/sha/hie-callbacks/register')).body.error.code).toBe('SHA_CALLBACKS_PLATFORM_MANAGED');
  });

  it('registers an endpoint and a status_changed operation per entity type, idempotently', async () => {
    const own = (path: string) => api().post(`/api/v1/owner${path}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    const r = await own('/sha-callbacks/register');
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { entityType: string }) => x.entityType)).toEqual(['claim', 'preauth', 'authorization']);
    expect(hie.endpoints.map((e) => e.entity_type)).toEqual(['claim', 'preauth', 'authorization']);
    expect(hie.endpoints[0]).toEqual(expect.objectContaining({ auth_type: 'none', environment: 'sandbox', tenant_id: 'client-1' }));
    expect(String(hie.endpoints[0].base_url)).toMatch(/\/api\/v1\/sha\/callbacks$/);
    expect(hie.ops[0]).toEqual(expect.objectContaining({ action: 'status_changed', method: 'POST' }));
    await own('/sha-callbacks/register');
    expect(hie.endpoints).toHaveLength(3);
    expect(hie.ops).toHaveLength(3);
    const st = await api().get('/api/v1/owner/sha-callbacks').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(st.body.data.states.every((x: { registered: boolean; ours: boolean }) => x.registered && x.ours)).toBe(true);
  });

  it('routes a platform callback to the facility by its FR code', async () => {
    const path = String(hie.ops[0].path);
    const v = await t(S, officer).post('/api/v1/sha/biometrics/verifications').send({ patientId: childIdForRouting(), position: 5, workstationId: 'WS-0001', deviceId: 'FP-READER-01', agentId: '12345678' });
    expect(v.body.data.externalId).toBe('JOB-V2');
    const r = await api().post(`/api/v1/sha/callbacks${path}`).send({ facility_fr_code: 'FID-47-000777-9', job_id: 'JOB-V2', verified: true, status: 'verified' });
    expect(r.status).toBe(200);
    expect((await t(S, officer).get(`/api/v1/sha/biometrics/jobs/${v.body.data._id}`)).body.data).toEqual(expect.objectContaining({ status: 'succeeded', outcome: 'verified' }));
    // Without a known FR code the platform callback cannot be attributed to a facility and is left unmatched.
    expect((await api().post(`/api/v1/sha/callbacks${path}`).send({ job_id: 'JOB-X', status: 'verified' })).status).toBe(200);
    void PASSWORD;
  });
});
