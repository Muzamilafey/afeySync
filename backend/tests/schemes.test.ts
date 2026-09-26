import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'schemefac';
let admin = '';
let reception = '';
let branch = '';
let capId = '';
let ffsId = '';
const patients: string[] = [];

const visitInvoice = async (visitId: string) => (await t(S, admin).get('/api/v1/billing/invoices').query({ visitId })).body.data[0];
const newVisit = (patientId: string, payer: Record<string, unknown>) => t(S, admin).post('/api/v1/visits').set('X-Branch-Id', branch).send({ patientId, payer, chargeServiceCodes: ['SCH-CONS'] });

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  branch = F.branches[0].id;
  admin = (await tenantLogin(S, F.admin.email)).token;
  reception = await createUser(S, admin, { email: 'rec@scheme.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [branch] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'SCH-CONS', name: 'Consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 1000 }, { priceList: 'insurance', amount: 800 }, { priceList: 'acme', amount: 600 }] });
  for (const n of ['One', 'Two', 'Three']) patients.push((await t(S, admin).post('/api/v1/patients').send({ firstName: 'Scheme', lastName: n, gender: 'female' })).body.data._id);
});
afterAll(teardown);

describe('corporate and insurance schemes', () => {
  it('lets price managers set up schemes and reception only list them', async () => {
    const cap = await t(S, admin).post('/api/v1/billing/schemes').send({ code: 'ACME', name: 'Acme Ltd staff', kind: 'corporate', priceList: 'acme', coverage: 'capitation', copay: { type: 'fixed', value: 200 }, capitationRate: 1500 });
    expect(cap.status).toBe(201);
    capId = cap.body.data._id;
    ffsId = (await t(S, admin).post('/api/v1/billing/schemes').send({ code: 'JUB-GOLD', name: 'Jubilee Gold', kind: 'insurance', priceList: 'jubilee-gold', copay: { type: 'percent', value: 10 } })).body.data._id;
    expect((await t(S, admin).post('/api/v1/billing/schemes').send({ code: 'BAD', name: 'Bad', kind: 'insurance', copay: { type: 'percent', value: 150 } })).status).toBe(400);
    expect((await t(S, reception).post('/api/v1/billing/schemes').send({ code: 'X', name: 'X', kind: 'corporate' })).status).toBe(403);
    const list = await t(S, reception).get('/api/v1/billing/schemes');
    expect(list.body.data.map((s: { code: string }) => s.code)).toEqual(['ACME', 'JUB-GOLD']);
  });

  it('checks the scheme matches the payer and has a member number', async () => {
    expect((await newVisit(patients[0], { type: 'insurance', schemeId: capId, memberNumber: 'A1' })).status).toBe(400);
    expect((await newVisit(patients[0], { type: 'corporate', schemeId: capId })).status).toBe(400);
  });

  it('capitation: bills the scheme price list, and the patient owes only the copay', async () => {
    const v = await newVisit(patients[0], { type: 'corporate', schemeId: capId, memberNumber: 'ACME-001' });
    expect(v.status).toBe(201);
    expect(v.body.data.visit.payer.scheme).toBe('Acme Ltd staff');
    const inv = await visitInvoice(v.body.data.visit._id);
    expect(inv.payer).toMatchObject({ priceList: 'acme', coverage: 'capitation' });
    expect(inv.totals).toMatchObject({ gross: 600, patientShare: 200, payerShare: 0, capitation: 400, net: 200, balance: 200 });
  });

  it('fee for service: a scheme list without a price falls back to insurance, split by the percentage copay', async () => {
    const v = await newVisit(patients[1], { type: 'insurance', schemeId: ffsId, memberNumber: 'JG-77' });
    const inv = await visitInvoice(v.body.data.visit._id);
    expect(inv.totals).toMatchObject({ gross: 800, patientShare: 80, payerShare: 720, capitation: 0, net: 800, balance: 800 });
  });

  it('keeps old bills on the terms they were opened with', async () => {
    expect((await t(S, admin).patch(`/api/v1/billing/schemes/${capId}`).send({ copay: { type: 'none', value: 0 } })).body.data.copay.type).toBe('none');
    const v = await newVisit(patients[2], { type: 'corporate', schemeId: capId, memberNumber: 'ACME-002' });
    const inv = await visitInvoice(v.body.data.visit._id);
    expect(inv.totals).toMatchObject({ net: 0, capitation: 600 });
    expect(inv.status).toBe('paid');
    const u = await t(S, admin).get(`/api/v1/billing/schemes/${capId}/utilisation`);
    expect(u.body.data).toMatchObject({ visits: 2, patients: 2, valueOfCare: 1200, copayDue: 200, coveredByCapitation: 1000 });
  });
});
