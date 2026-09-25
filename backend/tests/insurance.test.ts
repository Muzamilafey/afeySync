import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { getTenantBaseConn } from '../src/db/connections';
import { env } from '../src/config/env';

/* Test double for the Slade360 provider EDI API (tests only). */
type Call = { method: string; path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders; body: string };
const calls: Call[] = [];
const state = { tokenCalls: 0, fail401Once: false, remPaid: 0 };
let invoiceGross = 0;
const stub = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    calls.push({ method: req.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const json = (s: number, d: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/oauth2/token/') {
      state.tokenCalls += 1;
      const f = new URLSearchParams(body);
      if (f.get('client_secret') !== 'slade-secret' || f.get('grant_type') !== 'password' || f.get('username') !== 'api-user') return json(401, { error: 'invalid_client' });
      return json(200, { access_token: `slade-tok-${state.tokenCalls}`, expires_in: 3600 });
    }
    if (state.fail401Once) {
      state.fail401Once = false;
      return json(401, { detail: 'expired' });
    }
    const p = url.pathname.replace(/^\/v1/, '');
    if (p === '/beneficiaries/member_eligibility/') {
      if (url.searchParams.get('member_number') !== 'JUB/123456') return json(404, { detail: 'Member not found' });
      return json(200, { id: 'BEN-1', member_number: 'JUB/123456', beneficiary_name: 'JANE WANJIKU', status: 'ACTIVE', scheme_name: 'Corporate Medical Cover', scheme_code: 'CMC', policy_number: 'POL-9', policy_effective_date: '2026-01-01', valid_from: '2026-01-01', valid_to: '2026-12-31', panel_status: 'IN PANEL', beneficiary_contacts: [{ id: 'c9', phone_number: '0712345688' }], benefits: [{ benefit_code: 'OUTPATIENT', benefit_name: 'Outpatient', available_balance: 50000, copay: 200, status: 'ACTIVE' }] });
    }
    if (p === '/beneficiaries/beneficiary_contacts/c9/send_otp/') return json(200, { detail: 'OTP sent' });
    if (p === '/authorizations/start_visit/') {
      const b = JSON.parse(body);
      if (b.otp !== '4321') return json(400, { otp: ['Invalid OTP'] });
      return json(201, { id: 'AUTH-1', auth_token: 'SLADE-AUTH-TOKEN-XYZ', edi_auth_guid: 'EDI-AUTH-1', visit_number: 'VN-1', visit_start: '2026-09-25T08:00:00Z', status: 'AUTHORIZED' });
    }
    if (p === '/authorizations/validate_authorization_token/') return json(200, { valid: true });
    if (p === '/balances/reservations/reserve_from_authorization/') return json(201, { id: 'RES-1' });
    if (p === '/claims/' && req.method === 'POST') return json(201, { id: 'SCLM-1', claim_number: 'CLM-2026-1', status: 'OPEN' });
    if (p === '/invoices/') return json(201, { id: 'SINV-1' });
    if (p === '/claim_attachments/upload_attachment/' || p === '/invoice_attachments/upload_attachment/') return json(201, { id: 'ATT-1' });
    if (p === '/remittances/') return json(200, { results: [{ id: 'REM-1', claim: 'SCLM-1', invoice_number: 'x', amount_submitted: invoiceGross - 200, amount_approved: state.remPaid, amount_paid: state.remPaid, adjustment: 0, payment_date: '2026-09-30' }, { id: 'REM-0', claim: 'SCLM-1', amount_submitted: 10, amount_approved: 10, amount_paid: 0 }] });
    json(404, { detail: 'no route' });
  });
});

const S = 'insfac';
let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let reception: string;
let officer: string;
let doctor: string;
let patientId: string;
let coverageId: string;
let visitId: string;
let claimId: string;
let invoiceId: string;
let localVisitId: string;
const last = (suffix: string) => calls.filter((c) => c.path.endsWith(suffix)).at(-1)!;

beforeAll(async () => {
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  await setupApp();
  owner = await ownerToken();
  const o = await api().put('/api/v1/owner/integrations/slade360').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ environment: 'sandbox', enabled: true, allowTenantCredentials: true });
  expect(o.status).toBe(200);
  F = await createFacility(owner, S);
  await api().put(`/api/v1/owner/tenants/${F.id}/integrations`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ slade360: true });
  admin = (await tenantLogin(S, F.admin.email)).token;
  const cfg = await t(S, admin).put('/api/v1/admin/integrations/slade360').send({ enabled: true, useTenantConfig: true, environment: 'sandbox', settings: { baseUrl: `${base}/v1`, authUrl: `${base}/oauth2/token/`, grantType: 'password', factorOtp: 'OTP', locationCode: 'LOC-1', locationName: 'Main' }, secrets: { clientId: 'slade-client', clientSecret: 'slade-secret', username: 'api-user', password: 'api-pass' } });
  expect(cfg.status).toBe(200);
  const b = [F.branches[0].id];
  reception = await createUser(S, admin, { email: 'rec@ins.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: b });
  officer = await createUser(S, admin, { email: 'ins@ins.test', roleKey: 'insurance_officer', branchAccess: 'all', branchIds: [] });
  doctor = await createUser(S, admin, { email: 'doc@ins.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  patientId = (await t(S, reception).post('/api/v1/patients').send({ firstName: 'Jane', lastName: 'Wanjiku', gender: 'female' })).body.data._id;
});
afterAll(async () => {
  stub.close();
  await teardown();
});

describe('connection and payers', () => {
  it('connects with the facility credentials and never returns secrets', async () => {
    const r = await t(S, admin).post('/api/v1/insurance/slade360/test-connection');
    expect(r.body.data.status).toBe('CONNECTED');
    const tok = new URLSearchParams(last('/oauth2/token/').body);
    expect(tok.get('grant_type')).toBe('password');
    const list = await t(S, admin).get('/api/v1/admin/integrations');
    expect(JSON.stringify(list.body)).not.toMatch(/slade-secret|api-pass/);
    expect((await t(S, reception).post('/api/v1/insurance/slade360/test-connection')).status).toBe(403);
  });

  it('payers are usable only when enabled and supported', async () => {
    expect((await t(S, admin).post('/api/v1/insurance/payers/sandbox-examples')).body.data.added).toBe(7);
    const payers = await t(S, officer).get('/api/v1/insurance/payers');
    const jub = payers.body.data.find((p: { sladeCode: string }) => p.sladeCode === '457');
    expect(jub.enabled).toBe(false);
    const c = await t(S, reception).post('/api/v1/insurance/coverages').send({ patientId, payerId: jub._id, memberNumber: 'JUB/123456' });
    expect(c.body.error.code).toBe('PAYER_NOT_AVAILABLE');
    await t(S, admin).patch(`/api/v1/insurance/payers/${jub._id}`).send({ enabled: true, supported: true });
    const ok = await t(S, reception).post('/api/v1/insurance/coverages').send({ patientId, payerId: jub._id, memberNumber: 'JUB/123456', relationship: 'principal' });
    expect(ok.status).toBe(201);
    coverageId = ok.body.data._id;
    expect(ok.body.data.payerSladeCode).toBe('457');
  });
});

describe('eligibility and member authentication', () => {
  it('checks eligibility via the backend, stores a normalized result and masks contacts', async () => {
    state.fail401Once = true; // expired token: refreshed and retried exactly once
    const before = state.tokenCalls;
    const r = await t(S, reception).post(`/api/v1/insurance/coverages/${coverageId}/eligibility`);
    expect(r.status).toBe(200);
    expect(state.tokenCalls).toBe(before + 1);
    expect(last('/member_eligibility/').query).toEqual({ member_number: 'JUB/123456', payer_slade_code: '457' });
    expect(r.body.data.result).toEqual(expect.objectContaining({ eligible: true, panelStatus: 'IN PANEL' }));
    expect(r.body.data.result.benefits[0]).toEqual(expect.objectContaining({ code: 'OUTPATIENT', balance: 50000, copay: 200 }));
    expect(r.body.data.coverage.contacts).toEqual([{ id: 'c9', masked: '07******88' }]);
    expect(JSON.stringify(r.body)).not.toContain('0712345688');
    const db = getTenantBaseConn().useDb(`${env.TENANT_DB_PREFIX}${S}`);
    expect(JSON.stringify(await db.collection('insurancecoverages').findOne({}))).not.toContain('0712345688');
  });

  it('sends the OTP only to a contact returned by eligibility', async () => {
    expect((await t(S, reception).post(`/api/v1/insurance/coverages/${coverageId}/request-otp`).send({ contactId: 'other' })).status).toBe(400);
    expect((await t(S, reception).post(`/api/v1/insurance/coverages/${coverageId}/request-otp`).send({ contactId: 'c9' })).status).toBe(200);
    expect(last('/send_otp/').path).toBe('/v1/beneficiaries/beneficiary_contacts/c9/send_otp/');
  });

  it('starts the visit with the configured factor and keeps the authorization token private', async () => {
    const lv = await t(S, reception).post('/api/v1/visits').send({ patientId, payer: { type: 'insurance', scheme: 'Jubilee', memberNumber: 'JUB/123456' } });
    localVisitId = lv.body.data.visit._id;
    const bad = await t(S, reception).post('/api/v1/insurance/visits').set('X-Branch-Id', F.branches[0].id).send({ coverageId, method: 'otp', otp: '0000', contactId: 'c9', localVisitId });
    expect(bad.body.error.code).toBe('SLADE_VALIDATION_ERROR');
    expect(bad.body.error.message).toContain('Invalid OTP');
    expect((await t(S, reception).post('/api/v1/insurance/visits').set('X-Branch-Id', F.branches[0].id).send({ coverageId, method: 'fingerprint' })).body.error.code).toBe('SLADE_FACTOR_NOT_CONFIGURED');
    const v = await t(S, reception).post('/api/v1/insurance/visits').set('X-Branch-Id', F.branches[0].id).send({ coverageId, method: 'otp', otp: '4321', contactId: 'c9', benefitCode: 'OUTPATIENT', localVisitId });
    expect(v.status).toBe(201);
    visitId = v.body.data._id;
    expect(v.body.data).toEqual(expect.objectContaining({ status: 'VISIT_STARTED', visitNumber: 'VN-1', ediAuthGuid: 'EDI-AUTH-1', authorizationId: 'AUTH-1', authorizationTokenReference: '…-XYZ' }));
    expect(JSON.parse(last('/start_visit/').body)).toEqual(expect.objectContaining({ beneficiary_id: 'BEN-1', factors: ['OTP'], benefit_code: 'OUTPATIENT', policy_number: 'POL-9', otp: '4321', beneficiary_contact: 'c9', scheme_code: 'CMC' }));
    expect(JSON.stringify(v.body)).not.toContain('SLADE-AUTH-TOKEN-XYZ');
    const db = getTenantBaseConn().useDb(`${env.TENANT_DB_PREFIX}${S}`);
    const raw = JSON.stringify(await db.collection('insurancevisits').findOne({}));
    expect(raw).not.toContain('SLADE-AUTH-TOKEN-XYZ');
    expect(raw).not.toContain('4321');
    const val = await t(S, reception).post(`/api/v1/insurance/visits/${visitId}/validate-authorization`);
    expect(JSON.parse(last('/validate_authorization_token/').body)).toEqual(expect.objectContaining({ auth_token: 'SLADE-AUTH-TOKEN-XYZ', member_number: 'JUB/123456', first_name: 'Jane', last_name: 'Wanjiku', payer_code: '457' }));
    expect(val.body.data.status).toBe('AUTHORIZED');
  });
});

describe('reservation, claim and invoice', () => {
  it('reserves a benefit once even if the button is clicked twice', async () => {
    await t(S, admin).post('/api/v1/billing/services').send({ code: 'CONS', name: 'Consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 2500 }, { priceList: 'insurance', amount: 3000 }] });
    const inv = await t(S, admin).post('/api/v1/billing/invoices').send({ patientId, visitId: localVisitId, lines: [{ serviceCode: 'CONS', quantity: 2 }] });
    invoiceId = inv.body.data._id;
    invoiceGross = inv.body.data.totals.net;
    expect((await t(S, reception).post(`/api/v1/insurance/visits/${visitId}/reserve`).send({ invoiceId, amount: 6000 })).status).toBe(403);
    const [a, b] = await Promise.all([
      t(S, officer).post(`/api/v1/insurance/visits/${visitId}/reserve`).send({ invoiceId, amount: 6000 }),
      t(S, officer).post(`/api/v1/insurance/visits/${visitId}/reserve`).send({ invoiceId, amount: 6000 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(calls.filter((c) => c.path.endsWith('/reserve_from_authorization/'))).toHaveLength(1);
    expect(JSON.parse(last('/reserve_from_authorization/').body)).toEqual({ authorization: 'AUTH-1', invoice_number: inv.body.data.invoiceNumber, amount: 6000 });
  });

  it('requires documented ICD-10 codes (no silent conversion) and creates the claim', async () => {
    const c = await t(S, doctor).post('/api/v1/consultations').send({ visitId: localVisitId, chiefComplaint: 'Fever for three days' });
    await t(S, doctor).patch(`/api/v1/consultations/${c.body.data._id}`).send({ examination: 'Febrile', diagnoses: [{ code: '1F40', display: 'Malaria', system: 'ICD-11' }], plan: 'ACT' });
    await t(S, doctor).post(`/api/v1/consultations/${c.body.data._id}/finalize`);
    const unmapped = await t(S, officer).post(`/api/v1/insurance/visits/${visitId}/claim`).send({ invoiceId });
    expect(unmapped.body.error.code).toBe('DIAGNOSIS_NOT_MAPPED');
    expect(unmapped.body.error.details).toEqual(['1F40 Malaria']);
    expect((await t(S, officer).post('/api/v1/insurance/code-maps').send({ sourceSystem: 'ICD-11', sourceCode: '1F40', targetSystem: 'ICD-10', targetCode: 'b54' })).status).toBe(400);
    await t(S, officer).post('/api/v1/insurance/code-maps').send({ sourceSystem: 'ICD-11', sourceCode: '1F40', targetSystem: 'ICD-10', targetCode: 'B54', reference: 'WHO ICD-11/10 mapping table' });
    const r = await t(S, officer).post(`/api/v1/insurance/visits/${visitId}/claim`).send({ invoiceId });
    expect(r.status).toBe(201);
    claimId = r.body.data._id;
    expect(r.body.data).toEqual(expect.objectContaining({ sladeClaimId: 'SCLM-1', claimReference: 'CLM-2026-1', status: 'READY' }));
    expect(JSON.parse(last('/claims/').body)).toEqual(expect.objectContaining({ payer_code: '457', patient_name: 'Jane Wanjiku', member_number: 'JUB/123456', visit_number: 'VN-1', icd10_codes: ['B54'], location_code: 'LOC-1', scheme_code: 'CMC' }));
    expect((await t(S, officer).post(`/api/v1/insurance/visits/${visitId}/claim`).send({ invoiceId })).body.error.code).toBe('CLAIM_EXISTS');
  });

  it('computes invoice amounts on the server and uploads attachments', async () => {
    expect((await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/invoice`).send({ copay: 999999 })).status).toBe(400);
    const r = await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/invoice`).send({ copay: 200, gross: 1, lines: [{ amount: 1 }] });
    expect(r.body.data.amounts).toEqual({ gross: invoiceGross, copay: 200, insurance: invoiceGross - 200, patient: 200, net: invoiceGross - 200 });
    expect(r.body.data.status).toBe('SUBMITTED');
    const sent = JSON.parse(last('/invoices/').body);
    expect(sent).toEqual(expect.objectContaining({ claim: 'SCLM-1', copays: 200 }));
    expect(sent.lines).toEqual([expect.objectContaining({ code: 'CONS', quantity: 2, amount: invoiceGross })]);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80, 0x20), Buffer.from('\n%%EOF')]);
    const doc = await t(S, officer, F.branches[0].id).post('/api/v1/documents').field('category', 'insurance').field('title', 'Claim form').field('patientId', patientId).attach('file', pdf, 'claim-form.pdf');
    const a = await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/attachments`).send({ documentId: doc.body.data._id, attachmentType: 'CLAIM_FORM', target: 'claim' });
    expect(a.body.data).toEqual(expect.objectContaining({ attachmentId: 'ATT-1', attachmentType: 'CLAIM_FORM' }));
    const up = last('/claim_attachments/upload_attachment/');
    expect(up.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(up.body).toContain('filename="claim-form.pdf"');
    expect((await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/credit-notes`).send({ amount: 100, reason: 'Duplicate line' })).body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
  });
});

describe('remittances and reconciliation', () => {
  it('never marks a claim paid without payment evidence; reconciles idempotently', async () => {
    state.remPaid = 0;
    await t(S, officer).post('/api/v1/insurance/remittances/sync');
    const rems = await t(S, officer).get('/api/v1/insurance/remittances');
    const zero = rems.body.data.find((r: { externalId: string }) => r.externalId === 'REM-0');
    expect((await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/reconcile`).send({ remittanceId: zero._id })).body.error.code).toBe('NO_PAYMENT_EVIDENCE');
    state.remPaid = invoiceGross - 200 - 300; // payer paid less than submitted
    await t(S, officer).post('/api/v1/insurance/remittances/sync');
    const rem = (await t(S, officer).get('/api/v1/insurance/remittances')).body.data.find((r: { externalId: string }) => r.externalId === 'REM-1');
    const r = await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/reconcile`).send({ remittanceId: rem._id });
    expect(r.body.data.status).toBe('PAID');
    expect(r.body.data.reconciliation).toEqual(expect.objectContaining({ status: 'variance', submitted: invoiceGross - 200, paid: state.remPaid, variance: 300 }));
    await t(S, officer).post(`/api/v1/insurance/claims/${claimId}/reconcile`).send({ remittanceId: rem._id });
    const inv = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    const insPayments = (inv.body.data.payments ?? []).filter((p: { method: string }) => p.method === 'insurance');
    expect(insPayments).toHaveLength(1);
    expect(insPayments[0].amount).toBe(state.remPaid);
  });

  it('summarises the insurance dashboard without rankings', async () => {
    const d = await t(S, officer).get('/api/v1/insurance/dashboard');
    expect(d.body.data).toEqual(expect.objectContaining({ activeInsuredPatients: 1, claimsSubmitted: 1, amountPaid: state.remPaid, outstandingReceivables: 300 }));
    expect(d.body.data.byPayer['Jubilee Health Insurance Limited'].claims).toBe(1);
  });
});
