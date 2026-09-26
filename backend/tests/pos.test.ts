import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'posfac';
let admin = '';
let pharmacist = '';
let loc = '';
let para = '';
let unpricedItem = '';
let saleId = '';
let lineId = '';

const stockOf = async (itemId: string) => {
  const r = await t(S, admin).get('/api/v1/pharmacy/items').query({ q: 'POS' });
  return r.body.data.find((i: { _id: string }) => i._id === itemId).stock.usable as number;
};

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  pharmacist = await createUser(S, admin, { email: 'ph@pos.test', roleKey: 'pharmacist', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  loc = (await t(S, admin).get('/api/v1/pharmacy/locations')).body.data.find((l: { type: string }) => l.type === 'pharmacy')._id;
  para = (await t(S, admin).post('/api/v1/pharmacy/items').send({ code: 'POSPARA', name: 'POS Paracetamol 500mg', brand: 'Panadol', manufacturer: 'GSK', packUnit: 'box', packSize: 100, barcode: '5000158062610', unit: 'tab', prices: { cash: 5, foreigner: 8 } })).body.data._id;
  unpricedItem = (await t(S, admin).post('/api/v1/pharmacy/items').send({ code: 'POSNOPRICE', name: 'POS No price syrup', unit: 'bottle' })).body.data._id;
  const later = new Date(Date.now() + 400 * 86400_000);
  await t(S, admin).post('/api/v1/pharmacy/stock/receive').send({ locationId: loc, lines: [{ itemId: para, batchNumber: 'P1', expiryDate: later, quantity: 100, unitCost: 2 }, { itemId: unpricedItem, batchNumber: 'N1', expiryDate: later, quantity: 10 }] });
});
afterAll(teardown);

describe('pharmacy point of sale', () => {
  it('finds items by brand and barcode', async () => {
    const r = await t(S, admin).get('/api/v1/pharmacy/items').query({ q: '5000158062610' });
    expect(r.body.data[0]).toMatchObject({ code: 'POSPARA', brand: 'Panadol', packSize: 100 });
  });

  it('sells to a walk-in customer, priced on the server, and takes payment', async () => {
    const r = await t(S, admin).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Jane Walkin', customerPhone: '0700000001', externalPrescription: { prescriber: 'Dr Outside', facility: 'Town Clinic' }, lines: [{ itemId: para, quantity: 20 }], payment: { method: 'cash', idempotencyKey: 'pos-sale-00001' } });
    expect(r.status).toBe(201);
    expect(r.body.data.sale).toMatchObject({ status: 'paid', total: 100, walkIn: true, customerName: 'Jane Walkin' });
    expect(r.body.data.receiptNumber).toMatch(/^RCT-/);
    saleId = r.body.data.sale._id;
    lineId = r.body.data.sale.lines[0]._id;
    expect(await stockOf(para)).toBe(80);
  });

  it('lets a pharmacist sell, but payment goes to the cashier', async () => {
    const r = await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Otieno', lines: [{ itemId: para, quantity: 2 }] });
    expect(r.status).toBe(201);
    expect(r.body.data.sale.status).toBe('awaiting_payment');
    expect((await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Otieno', lines: [{ itemId: para, quantity: 1 }], payment: { method: 'cash', idempotencyKey: 'pos-sale-00002' } })).status).toBe(403);
  });

  it('refuses items without a price or without enough stock, leaving stock untouched', async () => {
    const noPrice = await t(S, admin).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'X', lines: [{ itemId: unpricedItem, quantity: 1 }] });
    expect(noPrice.body.error.code).toBe('PRICE_NOT_SET');
    const before = await stockOf(para);
    const short = await t(S, admin).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'X', lines: [{ itemId: para, quantity: 5000 }] });
    expect(short.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(para)).toBe(before);
    expect((await t(S, admin).post('/api/v1/pharmacy/sales').send({ locationId: loc, lines: [{ itemId: para, quantity: 1 }] })).status).toBe(400);
  });

  it('takes returns back into stock and shows the refund due', async () => {
    const before = await stockOf(para);
    const r = await t(S, pharmacist).post(`/api/v1/pharmacy/sales/${saleId}/return`).send({ reason: 'Customer changed mind', lines: [{ lineId, quantity: 5 }] });
    expect(r.status).toBe(200);
    expect(r.body.data.refundDue).toBe(25);
    expect(await stockOf(para)).toBe(before + 5);
    expect((await t(S, pharmacist).post(`/api/v1/pharmacy/sales/${saleId}/return`).send({ reason: 'Too many back', lines: [{ lineId, quantity: 16 }] })).body.error.code).toBe('RETURN_EXCEEDS_SOLD');
  });

  it('keeps the walk-in account out of patient searches and totals the day in the Z-report', async () => {
    const p = await t(S, admin).get('/api/v1/patients').query({ q: 'Walk-in' });
    expect(p.body.data).toHaveLength(0);
    const z = await t(S, admin).get('/api/v1/pharmacy/z-report');
    expect(z.status).toBe(200);
    expect(z.body.data.sales).toMatchObject({ count: 2, gross: 110, awaitingPayment: 1, returnsValue: 25 });
    expect(z.body.data.collections.byMethod.cash).toBe(100);
    expect(z.body.data.itemsSold[0]).toMatchObject({ quantity: 17 });
  });
});
