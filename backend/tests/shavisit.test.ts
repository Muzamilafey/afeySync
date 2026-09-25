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
};
const INTERVENTIONS: Record<string, Record<string, unknown>> = {
  'OP-CONS': { code: 'OP-CONS', name: 'Outpatient consultation', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: false, needsManualPreauthApproval: false, accessPoint: 'OP', fund: 'PHC', status: 'ACTIVE' },
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
    if (p === '/patients/contacts') return json(200, { data: [{ id: 'contact-1', phone: '+254714***898' }] });
    if (p === '/claims/otp') return json(200, { message: 'OTP sent' });
    if (p === '/claims/authorize') {
      const b = JSON.parse(body);
      if (b.factors) return json(200, { data: { guid: 'GUID-BIO', status: 'PENDING', shaVerificationRequest: 'https://ekyc.example/verify/123' } });
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
    expect(c.body.data.data[0].phone).toBe('+254714***898');
    expect((await t(S, officer).post(`/api/v1/sha/visits/${visitId}/otp`).send({ beneficiaryContactId: 'contact-1' })).status).toBe(200);
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ patient_id: 'CR1000000001', beneficiary_contact_id: 'contact-1' });
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

describe('biometrics', () => {
  it('never assumes biometric success; OTP refused when biometrics are enforced', async () => {
    const bio = await patient('33333333', 'CR1000000003');
    const v = await t(S, officer).post('/api/v1/sha/visits').set('X-Branch-Id', F.branches[0].id).send({ patientId: bio, interventionCodes: ['OP-CONS'] });
    expect((await t(S, officer).post(`/api/v1/sha/visits/${v.body.data._id}/otp`).send({})).body.error.code).toBe('SHA_BIOMETRICS_REQUIRED');
    const a = await t(S, officer).post(`/api/v1/sha/visits/${v.body.data._id}/authorize`).send({ method: 'biometric', deviceOs: 'windows', workStationId: 'WS-1' });
    expect(a.body.data.status).toBe('biometric_pending');
    expect(a.body.data.verificationUrl).toBe('https://ekyc.example/verify/123');
    const sent = JSON.parse(calls.filter((c) => c.path.endsWith('/claims/authorize')).at(-1)!.body);
    expect(sent).toEqual(expect.objectContaining({ factors: ['SHA'], is_integration: true, authorizing_device_os: 'windows', provider: 'FID-47-000777-9' }));
    expect((await t(S, officer).post(`/api/v1/sha/visits/${v.body.data._id}/authorize`).send({ method: 'minor_biometric', matchId: 'MATCH-1' })).body.error.code).toBe('SHA_MINOR_BIOMETRICS_DISABLED');
    void PASSWORD;
  });
});
