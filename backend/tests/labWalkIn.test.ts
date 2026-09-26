import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'labwalk';
let admin = '';
let tech = '';
let patientId = '';

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  tech = await createUser(S, admin, { email: 'tech@labwalk.test', roleKey: 'lab_technologist', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-FBC', name: 'Full blood count', category: 'laboratory', prices: [{ priceList: 'cash', amount: 800 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-HIV', name: 'HIV test', category: 'laboratory', prices: [{ priceList: 'cash', amount: 500 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-VDRL', name: 'VDRL', category: 'laboratory', prices: [{ priceList: 'cash', amount: 400 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-RBS', name: 'Random blood sugar', category: 'laboratory', prices: [{ priceList: 'cash', amount: 200 }] });
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Wanjiru', lastName: 'Kamau', gender: 'female', dateOfBirth: '1995-06-01' });
  patientId = p.body.data._id;
});
afterAll(teardown);

describe('lab packages and walk-in requests', () => {
  it('creates a package with its own price and shows the saving', async () => {
    const r = await t(S, admin).post('/api/v1/laboratory/packages').send({ code: 'anc', name: 'Antenatal profile', testCodes: ['FBC', 'HIV', 'VDRL'], prices: { cash: 1500 } });
    expect(r.status).toBe(201);
    const list = await t(S, tech).get('/api/v1/laboratory/packages');
    expect(list.body.data[0]).toMatchObject({ code: 'ANC', prices: { cash: 1500 }, priceIfSeparate: 1700 });
    expect((await t(S, admin).post('/api/v1/laboratory/packages').send({ code: 'bad', name: 'Bad', testCodes: ['FBC', 'NOPE'] })).status).toBe(400);
  });

  it('lets the lab register a walk-in request from an outside doctor, charging the package once', async () => {
    const r = await t(S, tech).post('/api/v1/laboratory/walk-in').send({ patientId, packages: ['ANC'], tests: ['RBS', 'FBC'], externalRequester: { name: 'Dr Mwangi', facility: 'Kiambu Clinic', reference: 'REF-22' } });
    expect(r.status).toBe(201);
    const o = r.body.data.order;
    expect(o).toMatchObject({ source: 'external', externalRequester: { name: 'Dr Mwangi', facility: 'Kiambu Clinic' } });
    expect(o.items.map((i: { testCode: string }) => i.testCode).sort()).toEqual(['FBC', 'HIV', 'RBS', 'VDRL']);
    expect(o.items.filter((i: { packageCode?: string }) => i.packageCode === 'ANC')).toHaveLength(3);
    const inv = await t(S, admin).get('/api/v1/billing/invoices').query({ patientId });
    const invoice = inv.body.data[0];
    const full = await t(S, admin).get(`/api/v1/billing/invoices/${invoice._id}`);
    const lines = full.body.data.lines.filter((l: { voided?: boolean }) => !l.voided);
    expect(lines.map((l: { amount: number }) => l.amount).sort((a: number, b: number) => a - b)).toEqual([200, 1500]);
    // A second walk-in request the same day reuses the open lab visit.
    const again = await t(S, tech).post('/api/v1/laboratory/walk-in').send({ patientId, tests: ['RBS'] });
    expect(again.body.data.visit._id).toBe(r.body.data.visit._id);
    expect(again.body.data.order.source).toBe('walk_in');
  });

  it('keeps walk-in requests to users allowed to register them', async () => {
    const nurse = await createUser(S, admin, { email: 'nurse@labwalk.test', roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    expect((await t(S, nurse).post('/api/v1/laboratory/walk-in').send({ patientId, tests: ['RBS'] })).status).toBe(403);
  });
});
