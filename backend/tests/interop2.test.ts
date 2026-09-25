import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { api, configureHie, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, startHieStub, t, teardown, tenantLogin } from './helpers';

const S = 'erxfac';
let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let doctor: string;
let pharmacist: string;
let shaOfficer: string;
let cashier: string;
let accountant: string;
let hie: Awaited<ReturnType<typeof startHieStub>>;
let patientId: string;
let visitId: string;

/* Daraja test double: OAuth + B2C. It decrypts the SecurityCredential with the test private key. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b2cCalls: Array<Record<string, string>> = [];
const daraja = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'daraja-token', expires_in: '3599' }));
    if (req.url === '/mpesa/b2c/v3/paymentrequest') {
      const b = JSON.parse(body);
      const pw = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(b.SecurityCredential, 'base64')).toString();
      b2cCalls.push({ ...b, decryptedPassword: pw });
      return res.end(JSON.stringify({ ConversationID: 'AG_2026_1', OriginatorConversationID: b.OriginatorConversationID, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});

async function setOp(provider: 'sha' | 'dha', key: string, path: string | null, method = 'POST') {
  const c = await api().get(`/api/v1/owner/contracts/${provider}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
  const r = await api().patch(`/api/v1/owner/contracts/${provider}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ contractVersion: c.body.data.contractVersion, operations: [{ key, path, method }] });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  await setupApp();
  hie = await startHieStub();
  await new Promise<void>((r) => daraja.listen(0, '127.0.0.1', () => r()));
  owner = await ownerToken();
  await configureHie(owner, hie.baseUrl);
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  doctor = await createUser(S, admin, { email: 'doc@erx.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  pharmacist = await createUser(S, admin, { email: 'ph@erx.test', roleKey: 'pharmacist', branchAccess: 'specific', branchIds: b });
  shaOfficer = await createUser(S, admin, { email: 'sha@erx.test', roleKey: 'sha_officer', branchAccess: 'all', branchIds: [] });
  cashier = await createUser(S, admin, { email: 'cash@erx.test', roleKey: 'cashier', branchAccess: 'specific', branchIds: b });
  accountant = await createUser(S, admin, { email: 'acc@erx.test', roleKey: 'accountant', branchAccess: 'all', branchIds: [] });
  patientId = (await t(S, admin).post('/api/v1/patients').send({ firstName: 'Erx', lastName: 'Patient', gender: 'female', clientRegistryId: 'CR5550001112', phone: '0712000999' })).body.data._id;
  visitId = (await t(S, admin).post('/api/v1/visits').send({ patientId })).body.data.visit._id;
});
afterAll(async () => {
  await hie.close();
  daraja.close();
  await teardown();
});

describe('ePrescription', () => {
  let rxId: string;
  let rxItem: string;
  let itemId: string;
  it('builds a valid FHIR MedicationRequest bundle and refuses to send until configured', async () => {
    const pm = await createUser(S, admin, { email: 'pm@erx.test', roleKey: 'pharmacy_manager', branchAccess: 'specific', branchIds: [F.branches[0].id] });
    itemId = (await t(S, pm).post('/api/v1/pharmacy/items').send({ code: 'PCM500', name: 'Paracetamol 500mg', form: 'tablet', unit: 'tabs' })).body.data._id;
    const locs = await t(S, pm).get('/api/v1/pharmacy/locations');
    const loc = locs.body.data.find((l: { type: string }) => l.type === 'pharmacy')._id;
    await t(S, pm).post('/api/v1/pharmacy/stock/receive').send({ locationId: loc, lines: [{ itemId, batchNumber: 'P1', expiryDate: new Date(Date.now() + 400 * 86400_000), quantity: 100, unitCost: 1 }] });
    const rx = await t(S, doctor).post('/api/v1/pharmacy/prescriptions').send({ visitId, items: [{ itemId, drugName: 'Paracetamol 500mg', dose: '1 tab', frequency: 'TDS', route: 'oral', durationDays: 5, quantity: 15 }] });
    expect(rx.status).toBe(201);
    rxId = rx.body.data._id;
    rxItem = rx.body.data.items[0]._id;
    const b = await t(S, doctor).get(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription/bundle`);
    expect(b.body.data.validation).toEqual([]);
    const mr = b.body.data.resource.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'MedicationRequest').resource;
    expect(mr).toEqual(expect.objectContaining({ status: 'active', intent: 'order' }));
    expect(mr.dosageInstruction[0].text).toBe('1 tab TDS oral for 5 days');
    const calls = hie.state.calls.length;
    const send = await t(S, doctor).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription`);
    expect(send.body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
    expect(hie.state.calls.length).toBe(calls);
    expect((await t(S, doctor).get(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription/bundle`)).body.data.state?.status).toBeUndefined();
    // store the location for dispensing
    (globalThis as Record<string, unknown>).erxLoc = loc;
  });

  it('sends once configured and reports the dispense', async () => {
    await setOp('dha', 'eprescription.create', '/__test__/eprescriptions');
    await setOp('dha', 'eprescription.dispense', '/__test__/dispenses');
    const send = await t(S, doctor).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription`);
    expect(send.status).toBe(200);
    expect(send.body.data.status).toBe('sent');
    expect(send.body.data.externalId).toMatch(/^EXT-/);
    expect(hie.state.calls.at(-1)!.path).toBe('/api/v1/__test__/eprescriptions');
    expect((await t(S, doctor).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription`)).body.error.code).toBe('EPRESCRIPTION_ALREADY_SENT');
    expect((await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription/dispense`)).body.error.code).toBe('NOTHING_DISPENSED');
    await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`).send({ locationId: (globalThis as Record<string, unknown>).erxLoc, lines: [{ rxItemId: rxItem, itemId, quantity: 15 }] });
    expect((await t(S, doctor).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription/dispense`)).status).toBe(403);
    const d = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/eprescription/dispense`);
    expect(d.body.data.status).toBe('dispense_reported');
  });
});

describe('emergency claims', () => {
  let txId: string;
  it('manages protocols and attending doctors after submission', async () => {
    const tx = await t(S, shaOfficer).post('/api/v1/sha/transactions').set('X-Branch-Id', F.branches[0].id).send({ kind: 'emergency_claim', patientId, diagnoses: [{ code: 'NA00', display: 'Head injury' }], lines: [{ serviceCode: 'ER', description: 'Emergency care', quantity: 1, unitPrice: 5000 }] });
    txId = tx.body.data._id;
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/emergency/protocols`).send({ code: 'P1' })).body.error.code).toBe('SHA_TX_NOT_SUBMITTED');
    await setOp('sha', 'sha.emergency.claim.create', '/__test__/emergency');
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/submit`)).body.data.status).toBe('submitted');
    expect((await t(S, shaOfficer).get('/api/v1/sha/emergency/protocols')).body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
    await setOp('sha', 'sha.emergency.protocols.list', '/__test__/protocols', 'GET');
    await setOp('sha', 'sha.emergency.protocol.add', '/__test__/protocol');
    await setOp('sha', 'sha.emergency.doctor.add', '/__test__/doctor');
    await setOp('sha', 'sha.emergency.doctor.remove', '/__test__/doctor-remove', 'DELETE');
    expect((await t(S, shaOfficer).get('/api/v1/sha/emergency/protocols')).status).toBe(200);
    const p = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/emergency/protocols`).send({ code: 'EMR-TRAUMA', name: 'Trauma protocol' });
    expect(p.body.data.emergency.protocols).toHaveLength(1);
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/emergency/protocols`).send({ code: 'EMR-TRAUMA' })).status).toBe(409);
    const users = await t(S, admin).get('/api/v1/users?q=doc@erx');
    const docId = users.body.data[0]._id;
    expect((await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/emergency/doctors`).send({ userId: docId })).status).toBe(400);
    await t(S, admin).patch(`/api/v1/users/${docId}`).send({ practitioner: { cadre: 'Medical Officer', licenseNumber: 'KMPDC-A1234' } });
    const d = await t(S, shaOfficer).post(`/api/v1/sha/transactions/${txId}/emergency/doctors`).send({ userId: docId });
    expect(d.body.data.emergency.doctors[0].registrationNumber).toBe('KMPDC-A1234');
    const rm = await t(S, shaOfficer).del(`/api/v1/sha/transactions/${txId}/emergency/doctors/KMPDC-A1234`);
    expect(rm.body.data.emergency.doctors).toHaveLength(0);
  });
});

describe('M-Pesa B2C refund payouts', () => {
  let cnId: string;
  it('is unavailable until the owner enables B2C', async () => {
    await api().put('/api/v1/owner/integrations/mpesa').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`)
      .send({ environment: 'sandbox', settings: { shortcode: '174379', baseUrl: `http://127.0.0.1:${(daraja.address() as AddressInfo).port}` }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    await api().put(`/api/v1/owner/tenants/${F.id}/integrations`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ mpesa: true });
    await t(S, admin).post('/api/v1/billing/services').send({ code: 'CONS', name: 'Consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 1000 }] });
    const inv = await t(S, cashier).post('/api/v1/billing/invoices').send({ patientId, lines: [{ serviceCode: 'CONS', quantity: 1 }] });
    const pay = await t(S, cashier).post('/api/v1/billing/payments').send({ invoiceId: inv.body.data._id, method: 'mpesa', amount: 1000, reference: 'QRF0000001', idempotencyKey: 'b2c-pay-0001' });
    const refund = await t(S, admin).post(`/api/v1/billing/payments/${pay.body.data._id}/refund`).send({ amount: 400, reason: 'Service not rendered', method: 'mpesa' });
    expect(refund.status).toBe(201);
    cnId = refund.body.data._id;
    expect((await t(S, accountant).post(`/api/v1/payments/mpesa/refunds/${cnId}/payout`).send({ phone: '0712000999' })).body.error.code).toBe('MPESA_B2C_NOT_CONFIGURED');
    expect(b2cCalls).toHaveLength(0);
  });

  it('pays out with an encrypted security credential and applies the result once', async () => {
    await api().put('/api/v1/owner/integrations/mpesa').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`)
      .send({ settings: { b2cEnabled: 'true', b2cShortcode: '600000', b2cInitiatorName: 'afsapi' }, secrets: { b2cInitiatorPassword: 'Initiator#Pass1', b2cCertificate: publicKey.export({ type: 'spki', format: 'pem' }).toString() } });
    // the refund approver cannot also start the payout
    expect((await t(S, admin).post(`/api/v1/payments/mpesa/refunds/${cnId}/payout`).send({ phone: '0712000999' })).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    const r = await t(S, accountant).post(`/api/v1/payments/mpesa/refunds/${cnId}/payout`).send({ phone: '0712 000 999' });
    expect(r.status).toBe(202);
    expect(r.body.data.payout.status).toBe('submitted');
    expect(b2cCalls[0]).toEqual(expect.objectContaining({ CommandID: 'BusinessPayment', Amount: 400, PartyA: '600000', PartyB: '254712000999', InitiatorName: 'afsapi', decryptedPassword: 'Initiator#Pass1' }));
    expect(b2cCalls[0].ResultURL).toMatch(/\/api\/v1\/payments\/mpesa\/b2c\/[A-Za-z0-9_-]+\/result$/);
    expect((await t(S, accountant).post(`/api/v1/payments/mpesa/refunds/${cnId}/payout`).send({ phone: '0712000999' })).body.error.code).toBe('PAYOUT_EXISTS');
    const token = b2cCalls[0].ResultURL.split('/b2c/')[1].split('/')[0];
    const result = { Result: { ResultType: 0, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', OriginatorConversationID: b2cCalls[0].OriginatorConversationID, ConversationID: 'AG_2026_1', TransactionID: 'RB2C123ABC', ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: 400 }, { Key: 'ReceiverPartyPublicName', Value: '254712000999 - Erx Patient' }] } } };
    expect((await api().post('/api/v1/payments/mpesa/b2c/not_a_real_token_123456789/result').send(result)).status).toBe(404);
    expect((await api().post(`/api/v1/payments/mpesa/b2c/${token}/result`).send(result)).body.ResultCode).toBe(0);
    await api().post(`/api/v1/payments/mpesa/b2c/${token}/timeout`).send(result); // late/duplicate delivery is ignored
    const audit = await t(S, admin).get('/api/v1/admin/audit?action=billing.mpesa_payout_completed');
    expect(audit.body.data).toHaveLength(1);
  });
});
