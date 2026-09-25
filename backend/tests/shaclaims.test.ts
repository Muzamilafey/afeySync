import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, configureHie, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, startHieStub, t, teardown, tenantLogin } from './helpers';

const S = 'shaclm';
let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let reception: string;
let doctor: string;
let shaOfficer: string;
let accountant: string;
let stub: Awaited<ReturnType<typeof startHieStub>>;
let invoiceId: string;
let claimId: string;

async function setOp(key: string, path: string | null, method = 'POST') {
  const c = await api().get('/api/v1/owner/contracts/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
  const r = await api().patch('/api/v1/owner/contracts/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ contractVersion: c.body.data.contractVersion, operations: [{ key, path, method }] });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  await setupApp();
  stub = await startHieStub();
  owner = await ownerToken();
  await configureHie(owner, stub.baseUrl);
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  reception = await createUser(S, admin, { email: 'rec@clm.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: b });
  doctor = await createUser(S, admin, { email: 'doc@clm.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  shaOfficer = await createUser(S, admin, { email: 'sha@clm.test', roleKey: 'sha_officer', branchAccess: 'all', branchIds: [] });
  accountant = await createUser(S, admin, { email: 'acc@clm.test', roleKey: 'accountant', branchAccess: 'all', branchIds: [] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'CONS', name: 'Consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 1000 }, { priceList: 'sha', amount: 800 }] });
  const p = await t(S, reception).post('/api/v1/patients').send({ firstName: 'John', lastName: 'Doe', gender: 'male', nationalId: '12345678', clientRegistryId: 'CR1234567890' });
  const pid = p.body.data._id;
  expect((await t(S, reception).post('/api/v1/sha/eligibility').send({ patientId: pid })).body.data.status).toBe('eligible');
  const v = await t(S, reception).post('/api/v1/visits').send({ patientId: pid, payer: { type: 'sha' }, chargeServiceCodes: ['CONS'] });
  expect(v.status).toBe(201);
  const visitId = v.body.data.visit._id;
  const c = await t(S, doctor).post('/api/v1/consultations').send({ visitId, chiefComplaint: 'Fever for three days' });
  await t(S, doctor).patch(`/api/v1/consultations/${c.body.data._id}`).send({ examination: 'Febrile', diagnoses: [{ code: '1F40', display: 'Malaria', system: 'ICD-11' }], plan: 'ACT' });
  await t(S, doctor).post(`/api/v1/consultations/${c.body.data._id}/finalize`);
  const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
  invoiceId = inv.body.data[0]._id;
  expect(inv.body.data[0].totals.net).toBe(800);
});
afterAll(async () => {
  await stub.close();
  await teardown();
});

describe('SHA claims', () => {
  it('builds a claim from an SHA invoice with lines and finalized diagnoses', async () => {
    expect((await t(S, reception).post('/api/v1/sha/transactions/from-invoice').send({ invoiceId })).status).toBe(403);
    const r = await t(S, shaOfficer).post('/api/v1/sha/transactions/from-invoice').send({ invoiceId });
    expect(r.status).toBe(201);
    claimId = r.body.data._id;
    expect(r.body.data.reference).toMatch(/^SHA-CLM-\d{6}$/);
    expect(r.body.data.amounts.claimed).toBe(800);
    expect(r.body.data.diagnoses).toEqual([expect.objectContaining({ code: '1F40', display: 'Malaria' })]);
    expect(r.body.data.accessPoint).toBe('OP');
    expect((await t(S, shaOfficer).post('/api/v1/sha/transactions/from-invoice').send({ invoiceId })).body.error.code).toBe('CLAIM_EXISTS');
  });

  it('previews a valid FHIR Claim and refuses incomplete submissions', async () => {
    const f = await t(S, shaOfficer).get(`/api/v1/sha/transactions/${claimId}/fhir`);
    expect(f.body.data.resource.resourceType).toBe('Claim');
    expect(f.body.data.resource.patient.identifier.value).toBe('CR1234567890');
    expect(f.body.data.validation).toEqual([]);
    const s = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/submit`);
    expect(s.body.error.code).toBe('SHA_TX_INCOMPLETE');
    expect(s.body.error.details).toContain('SHA intervention code is required');
    expect((await t(S, shaOfficer).patch(`/api/v1/sha/transactions/${claimId}`).send({ interventionCode: 'SHA-01-001' })).status).toBe(200);
  });

  it('does not submit or change status when the operation is not configured', async () => {
    const calls = stub.state.calls.length;
    const s = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/submit`);
    expect(s.status).toBe(501);
    expect(s.body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
    expect(stub.state.calls.length).toBe(calls);
    expect((await t(S, shaOfficer).get(`/api/v1/sha/transactions/${claimId}`)).body.data.status).toBe('draft');
  });

  it('submits through the configured operation and locks the claim', async () => {
    await setOp('sha.claim.discharge', '/__test__/claims');
    const s = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/submit`);
    expect(s.status).toBe(200);
    expect(s.body.data.status).toBe('submitted');
    expect(s.body.data.externalReference).toMatch(/^EXT-/);
    const call = stub.state.calls.at(-1)!;
    expect(call.path).toBe('/api/v1/__test__/claims');
    expect(call.headers['idempotency-key'] ?? call.headers['x-idempotency-key']).toBeDefined();
    expect((await t(S, shaOfficer).patch(`/api/v1/sha/transactions/${claimId}`).send({ benefitCode: 'X' })).body.error.code).toBe('SHA_TX_LOCKED');
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/submit`)).status).toBe(409);
  });

  it('records decisions, reconciles remittances idempotently and closes the invoice', async () => {
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/decision`).send({ status: 'approved', note: 'Approved on portal' })).status).toBe(400);
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/decision`).send({ status: 'approved', approvedAmount: 900, note: 'Approved on portal' })).status).toBe(400);
    const d = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${claimId}/decision`).send({ status: 'approved', approvedAmount: 800, note: 'Approved on SHA portal' });
    expect(d.body.data.status).toBe('approved');

    expect((await t(S, doctor).post(`/api/v1/sha/transactions/${claimId}/reconcile`).send({ amount: 500, reference: 'RA-001' })).status).toBe(403);
    expect((await t(S, accountant).post(`/api/v1/sha/transactions/${claimId}/reconcile`).send({ amount: 900, reference: 'RA-000' })).body.error.code).toBe('OVERPAYMENT');
    const r1 = await t(S, accountant).post(`/api/v1/sha/transactions/${claimId}/reconcile`).send({ amount: 500, reference: 'RA-001' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.payment.method).toBe('sha');
    expect(r1.body.data.transaction.status).toBe('approved');
    const replay = await t(S, accountant).post(`/api/v1/sha/transactions/${claimId}/reconcile`).send({ amount: 500, reference: 'ra-001' });
    expect(replay.body.idempotentReplay).toBe(true);
    const r2 = await t(S, accountant).post(`/api/v1/sha/transactions/${claimId}/reconcile`).send({ amount: 300, reference: 'RA-002' });
    expect(r2.body.data.transaction.status).toBe('paid');
    expect(r2.body.data.transaction.amounts.paid).toBe(800);
    const inv = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(inv.body.data.status ?? inv.body.data.invoice?.status).toBe('paid');
  });

  it('marks exchange failures as failed and allows correction and resubmission', async () => {
    const inv2 = await t(S, shaOfficer).post('/api/v1/sha/transactions').send({ kind: 'preauthorization', patientId: (await t(S, shaOfficer).get(`/api/v1/sha/transactions/${claimId}`)).body.data.patientId._id, interventionCode: 'SHA-02-001', diagnoses: [{ code: '1F40', display: 'Malaria' }], lines: [{ serviceCode: 'CONS', description: 'FORCE_REJECT', quantity: 1, unitPrice: 800 }] }).set('X-Branch-Id', F.branches[0].id);
    expect(inv2.status).toBe(201);
    await setOp('sha.preauth.create', '/__test__/preauth');
    const s = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${inv2.body.data._id}/submit`);
    expect(s.status).toBeGreaterThanOrEqual(400);
    const after = await t(S, shaOfficer).get(`/api/v1/sha/transactions/${inv2.body.data._id}`);
    expect(after.body.data.status).toBe('failed');
    await t(S, shaOfficer).patch(`/api/v1/sha/transactions/${inv2.body.data._id}`).send({ lines: [{ serviceCode: 'CONS', description: 'Consultation', quantity: 1, unitPrice: 800 }] });
    const ok = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${inv2.body.data._id}/submit`);
    expect(ok.body.data.status).toBe('submitted');
    await t(S, shaOfficer).post(`/api/v1/sha/transactions/${inv2.body.data._id}/decision`).send({ status: 'rejected', note: 'Missing documents' });
    const re = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${inv2.body.data._id}/resubmit`).send({ reason: 'Attach referral letter' });
    expect(re.body.data.status).toBe('draft');
    const hist = re.body.data.statusHistory.map((h: { status: string }) => h.status);
    expect(hist).toEqual(['draft', 'failed', 'submitted', 'rejected', 'draft']);
  });
});
