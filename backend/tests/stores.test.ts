import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'storesfac';
let admin = '';
let manager = '';
let nurse = '';
let store = '';
let ward = '';
let item = '';
let reqId = '';
let takeId = '';

const qtyAt = async (locationId: string) => {
  const r = await t(S, admin).get('/api/v1/pharmacy/items').query({ q: 'STORES', locationId });
  return r.body.data.find((i: { _id: string }) => i._id === item).stock.usable as number;
};

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  const branch = F.branches[0].id;
  admin = (await tenantLogin(S, F.admin.email)).token;
  manager = await createUser(S, admin, { email: 'pm@stores.test', roleKey: 'pharmacy_manager', branchAccess: 'specific', branchIds: [branch] });
  nurse = await createUser(S, admin, { email: 'nurse@stores.test', roleKey: 'nurse', branchAccess: 'specific', branchIds: [branch] });
  store = (await t(S, admin).post('/api/v1/pharmacy/locations').set('X-Branch-Id', branch).send({ name: 'Main store', type: 'store' })).body.data._id;
  ward = (await t(S, admin).post('/api/v1/pharmacy/locations').set('X-Branch-Id', branch).send({ name: 'Ward A', type: 'ward' })).body.data._id;
  item = (await t(S, admin).post('/api/v1/pharmacy/items').send({ code: 'STORESGLOVE', name: 'STORES Gloves', unit: 'pair', category: 'consumable', packUnit: 'box', packSize: 50, reorderLevel: 100 })).body.data._id;
  const soon = new Date(Date.now() + 200 * 86400_000);
  const later = new Date(Date.now() + 500 * 86400_000);
  await t(S, admin).post('/api/v1/pharmacy/stock/receive').send({ locationId: store, lines: [{ itemId: item, batchNumber: 'G2', expiryDate: later, quantity: 60, unitCost: 10 }, { itemId: item, batchNumber: 'G1', expiryDate: soon, quantity: 40, unitCost: 9 }] });
});
afterAll(teardown);

describe('stores requisitions', () => {
  it('lets a ward nurse request items but not approve their own request', async () => {
    const r = await t(S, nurse).post('/api/v1/inventory/requisitions').send({ fromLocationId: store, toLocationId: ward, urgency: 'urgent', items: [{ itemId: item, quantity: 50 }] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'pending', urgency: 'urgent' });
    expect(r.body.data.reqNumber).toMatch(/^SRQ/);
    reqId = r.body.data._id;
    expect((await t(S, nurse).post(`/api/v1/inventory/requisitions/${reqId}/decide`).send({ approve: true })).status).toBe(403);
  });

  it('approves a reduced quantity and issues earliest expiry first', async () => {
    const line = (await t(S, manager).get('/api/v1/inventory/requisitions')).body.data[0].items[0]._id;
    const d = await t(S, manager).post(`/api/v1/inventory/requisitions/${reqId}/decide`).send({ approve: true, quantities: { [line]: 45 } });
    expect(d.body.data.status).toBe('approved');
    expect(d.body.data.items[0].approvedQuantity).toBe(45);
    const i = await t(S, manager).post(`/api/v1/inventory/requisitions/${reqId}/issue`).send({});
    expect(i.status).toBe(200);
    expect(i.body.data.status).toBe('issued');
    expect(i.body.data.issues[0].lines.map((l: { batchNumber: string; quantity: number }) => [l.batchNumber, l.quantity])).toEqual([['G1', 40], ['G2', 5]]);
    expect(await qtyAt(store)).toBe(55);
    expect(await qtyAt(ward)).toBe(45);
    expect((await t(S, manager).post(`/api/v1/inventory/requisitions/${reqId}/issue`).send({})).status).toBe(409);
    const rc = await t(S, nurse).post(`/api/v1/inventory/requisitions/${reqId}/receive`).send({});
    expect(rc.body.data.status).toBe('received');
  });

  it('needs a reason to reject', async () => {
    const r = await t(S, nurse).post('/api/v1/inventory/requisitions').send({ fromLocationId: store, toLocationId: ward, items: [{ itemId: item, quantity: 5 }] });
    const id = r.body.data._id;
    expect((await t(S, manager).post(`/api/v1/inventory/requisitions/${id}/decide`).send({ approve: false })).status).toBe(400);
    const rej = await t(S, manager).post(`/api/v1/inventory/requisitions/${id}/decide`).send({ approve: false, reason: 'Ward already has enough' });
    expect(rej.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'Ward already has enough' });
  });
});

describe('stock take', () => {
  it('freezes the batches on a count sheet and blocks a second count of the same location', async () => {
    const r = await t(S, manager).post('/api/v1/inventory/stock-takes').send({ locationId: store });
    expect(r.status).toBe(201);
    takeId = r.body.data._id;
    expect(r.body.data.lines).toHaveLength(1);
    expect(r.body.data.lines[0]).toMatchObject({ batchNumber: 'G2', systemQuantity: 55 });
    expect((await t(S, manager).post('/api/v1/inventory/stock-takes').send({ locationId: store })).status).toBe(409);
  });

  it('requires every line counted, and an approver other than the counter', async () => {
    const st = (await t(S, manager).get(`/api/v1/inventory/stock-takes/${takeId}`)).body.data;
    const lineId = st.lines[0]._id;
    expect((await t(S, manager).put(`/api/v1/inventory/stock-takes/${takeId}/counts`).send({ counts: [{ lineId, countedQuantity: null }], submit: true })).status).toBe(400);
    const s = await t(S, manager).put(`/api/v1/inventory/stock-takes/${takeId}/counts`).send({ counts: [{ lineId, countedQuantity: 52, note: '3 torn' }], submit: true });
    expect(s.body.data.status).toBe('submitted');
    expect((await t(S, manager).post(`/api/v1/inventory/stock-takes/${takeId}/approve`).send({})).status).toBe(403);
    const a = await t(S, admin).post(`/api/v1/inventory/stock-takes/${takeId}/approve`).send({});
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ adjustedLines: 1, varianceValue: -30 });
    expect(await qtyAt(store)).toBe(52);
  });
});

describe('stock reports', () => {
  it('reports opening, received, issued, adjusted and closing for the period', async () => {
    const r = await t(S, manager).get('/api/v1/inventory/stock/movement-report').query({ locationId: store });
    const row = r.body.data.find((x: { itemId: string }) => x.itemId === item);
    expect(row).toMatchObject({ opening: 0, received: 100, issued: 45, adjusted: -3, closing: 52 });
  });

  it('suggests a reorder in whole packs for items at or below their reorder level', async () => {
    const r = await t(S, manager).get('/api/v1/inventory/stock/reorder-suggestions');
    const row = r.body.data.find((x: { itemId: string }) => x.itemId === item);
    // 97 usable across the branch (52 store + 45 ward) against a level of 100: order 200 - 97 = 103, rounded up to 150 (3 boxes of 50).
    expect(row).toMatchObject({ usable: 97, suggestedQuantity: 150, packSize: 50 });
  });
});
