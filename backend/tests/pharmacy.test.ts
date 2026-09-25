import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { getTenantModels } from '../src/db/tenantManager';
import { env } from '../src/config/env';

const S = 'rxfac';
let admin: string;
let doctor: string;
let pharmacist: string;
let pharmMgr: string;
let procOfficer: string;
let visitId: string;
let patientId: string;
let pharmacyLoc: string;
let storeLoc: string;
let amox: string;

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  doctor = await createUser(S, admin, { email: 'doc@rx.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  pharmacist = await createUser(S, admin, { email: 'ph@rx.test', roleKey: 'pharmacist', branchAccess: 'specific', branchIds: b });
  pharmMgr = await createUser(S, admin, { email: 'pm@rx.test', roleKey: 'pharmacy_manager', branchAccess: 'specific', branchIds: b });
  procOfficer = await createUser(S, admin, { email: 'po@rx.test', roleKey: 'procurement_officer', branchAccess: 'all', branchIds: [] });
  const locs = await t(S, pharmMgr).get('/api/v1/pharmacy/locations');
  pharmacyLoc = locs.body.data.find((l: { type: string }) => l.type === 'pharmacy')._id;
  storeLoc = locs.body.data.find((l: { type: string }) => l.type === 'store')._id;
  const item = await t(S, pharmMgr).post('/api/v1/pharmacy/items').send({ code: 'AMOX500', name: 'Amoxicillin 500mg caps', genericName: 'Amoxicillin', form: 'capsule', strength: '500mg', unit: 'caps', reorderLevel: 50 });
  amox = item.body.data._id;
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'RX-AMOX500', name: 'Amoxicillin 500mg', category: 'pharmacy', prices: [{ priceList: 'cash', amount: 10 }] });
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Rx', lastName: 'Patient', gender: 'male', allergies: [{ substance: 'Penicillin', severity: 'severe' }] });
  patientId = p.body.data._id;
  const v = await t(S, admin).post('/api/v1/visits').send({ patientId, firstStage: 'consultation' });
  visitId = v.body.data.visit._id;
});
afterAll(teardown);

describe('stock', () => {
  it('receives batches and never accepts expired stock', async () => {
    const soon = new Date(Date.now() + 30 * 86400_000);
    const later = new Date(Date.now() + 400 * 86400_000);
    const r = await t(S, pharmMgr).post('/api/v1/pharmacy/stock/receive').send({ locationId: pharmacyLoc, lines: [{ itemId: amox, batchNumber: 'B-LATE', expiryDate: later, quantity: 100, unitCost: 4 }, { itemId: amox, batchNumber: 'B-SOON', expiryDate: soon, quantity: 20, unitCost: 4 }] });
    expect(r.status).toBe(201);
    expect((await t(S, pharmMgr).post('/api/v1/pharmacy/stock/receive').send({ locationId: pharmacyLoc, lines: [{ itemId: amox, batchNumber: 'OLD', expiryDate: new Date(Date.now() - 86400_000), quantity: 5 }] })).status).toBe(400);
    // An expired batch already on the shelf (inserted directly) must never be dispensed.
    const m = getTenantModels(`${env.TENANT_DB_PREFIX}${S}`);
    const loc = await m.StockLocation.findById(pharmacyLoc).lean();
    await m.Batch.create({ itemId: amox, locationId: pharmacyLoc, branchId: loc!.branchId, batchNumber: 'B-EXPIRED', expiryDate: new Date(Date.now() - 5 * 86400_000), quantity: 50 });
    const sum = await t(S, pharmacist).get(`/api/v1/pharmacy/stock/summary?locationId=${pharmacyLoc}`);
    const row = sum.body.data.find((x: { code: string }) => x.code === 'AMOX500');
    expect(row).toEqual(expect.objectContaining({ onHand: 170, usable: 120, expired: 50 }));
    const exp = await t(S, pharmacist).get('/api/v1/pharmacy/stock/expiring?days=60');
    expect(exp.body.data.map((b: { batchNumber: string }) => b.batchNumber)).toEqual(['B-EXPIRED', 'B-SOON']);
  });

  it('transfers FEFO between locations', async () => {
    const r = await t(S, pharmMgr).post('/api/v1/pharmacy/stock/transfer').send({ fromLocationId: pharmacyLoc, toLocationId: storeLoc, itemId: amox, quantity: 5 });
    expect(r.body.data.allocations[0].batchNumber).toBe('B-SOON');
    const store = await t(S, pharmMgr).get(`/api/v1/pharmacy/stock?locationId=${storeLoc}`);
    expect(store.body.data[0]).toEqual(expect.objectContaining({ batchNumber: 'B-SOON', quantity: 5 }));
  });
});

describe('prescribing and dispensing', () => {
  let rxId: string;
  let rxItem: string;
  it('blocks prescriptions that conflict with recorded allergies (incl. drug class) unless overridden with a reason', async () => {
    const body = { visitId, items: [{ itemId: amox, drugName: 'Amoxicillin 500mg caps', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 30 }] };
    const blocked = await t(S, doctor).post('/api/v1/pharmacy/prescriptions').send(body);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('ALLERGY_ALERT');
    expect(blocked.body.error.message).toContain('Penicillin');
    const ok = await t(S, doctor).post('/api/v1/pharmacy/prescriptions').send({ ...body, overrideAllergy: { reason: 'Tolerated amoxicillin previously, allergy disputed' } });
    expect(ok.status).toBe(201);
    rxId = ok.body.data._id;
    rxItem = ok.body.data.items[0]._id;
    expect(ok.body.data.rxNumber).toMatch(/^RX-/);
    expect((await t(S, pharmacist).get('/api/v1/queues?stage=pharmacy')).body.data).toHaveLength(1);
  });

  it('dispenses partially with FEFO (skipping expired batches) and charges per dispense', async () => {
    expect((await t(S, doctor).post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rxItem, itemId: amox, quantity: 1 }] })).status).toBe(403);
    expect((await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rxItem, itemId: amox, quantity: 31 }] })).body.error.code).toBe('OVER_DISPENSE');
    const d1 = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rxItem, itemId: amox, quantity: 20 }] });
    expect(d1.status).toBe(200);
    expect(d1.body.data.status).toBe('partially_dispensed');
    const batches = d1.body.data.dispenses[0].lines.map((l: { batchNumber: string; quantity: number }) => `${l.batchNumber}:${l.quantity}`);
    expect(batches).toEqual(['B-SOON:15', 'B-LATE:5']);
    const d2 = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rxItem, itemId: amox, quantity: 10 }] });
    expect(d2.body.data.status).toBe('dispensed');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
    expect(inv.body.data[0].totals.gross).toBe(300);
  });

  it('refuses to dispense more than usable stock', async () => {
    const rx = await t(S, doctor).post('/api/v1/pharmacy/prescriptions').send({ visitId, overrideAllergy: { reason: 'Allergy disputed after review' }, items: [{ itemId: amox, drugName: 'Amoxicillin', quantity: 200 }] });
    const r = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rx.body.data._id}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rx.body.data.items[0]._id, itemId: amox, quantity: 200 }] });
    expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(r.body.error.details.available).toBe(85);
  });

  it('returns restock the batch, reduce the charge and write to the ledger', async () => {
    const rx = await t(S, pharmacist).get(`/api/v1/pharmacy/prescriptions/${rxId}`);
    const late = rx.body.data.dispenses.flatMap((d: { lines: Array<{ batchNumber: string; batchId: string }> }) => d.lines).find((l: { batchNumber: string }) => l.batchNumber === 'B-LATE');
    const r = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rxId}/return`).send({ rxItemId: rxItem, batchId: late.batchId, quantity: 5, reason: 'Patient returned unopened pack' });
    expect(r.body.data.status).toBe('partially_dispensed');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
    expect(inv.body.data[0].totals.gross).toBe(250);
    const mv = await t(S, pharmMgr).get('/api/v1/pharmacy/stock/movements?type=return');
    expect(mv.body.data[0].quantity).toBe(5);
  });
});

describe('procurement', () => {
  it('PO requires a different approver; GRN creates batches and cannot over-receive', async () => {
    const sup = await t(S, procOfficer).post('/api/v1/procurement/suppliers').send({ name: 'Kenya Pharma Supplies', phone: '0700111222' });
    const po = await t(S, procOfficer).post('/api/v1/procurement/purchase-orders').send({ supplierId: sup.body.data._id, locationId: storeLoc, items: [{ itemId: amox, quantity: 100, unitCost: 3.5 }] });
    expect(po.status).toBe(201);
    expect(po.body.data.total).toBe(350);
    expect((await t(S, procOfficer).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/approve`)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await t(S, admin).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/receive`).send({ lines: [{ itemId: amox, batchNumber: 'P1', expiryDate: new Date(Date.now() + 500 * 86400_000), quantity: 10 }] })).status).toBe(409);
    await t(S, admin).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/approve`);
    const exp = new Date(Date.now() + 500 * 86400_000);
    const g1 = await t(S, pharmMgr).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/receive`).send({ deliveryNote: 'DN-1', lines: [{ itemId: amox, batchNumber: 'P1', expiryDate: exp, quantity: 60 }] });
    expect(g1.body.data.status).toBe('partially_received');
    expect((await t(S, pharmMgr).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/receive`).send({ lines: [{ itemId: amox, batchNumber: 'P2', expiryDate: exp, quantity: 50 }] })).status).toBe(400);
    const g2 = await t(S, pharmMgr).post(`/api/v1/procurement/purchase-orders/${po.body.data._id}/receive`).send({ lines: [{ itemId: amox, batchNumber: 'P2', expiryDate: exp, quantity: 40 }] });
    expect(g2.body.data.status).toBe('received');
    const store = await t(S, pharmMgr).get(`/api/v1/pharmacy/stock?locationId=${storeLoc}`);
    expect(store.body.data.reduce((s: number, b: { quantity: number }) => s + b.quantity, 0)).toBe(105);
  });
});

describe('item selling prices (cash / SHA / insurance / foreigner)', () => {
  let pcm: string;
  it('sets prices from the item (billing.prices only), shows stock and prices in the item list', async () => {
    const body = { code: 'PCM500', name: 'Paracetamol', strength: '500mg', unit: 'tablet', prices: { cash: 5, sha: 4, insurance: 6, foreigner: 10 } };
    const denied = await t(S, pharmMgr).post('/api/v1/pharmacy/items').send(body);
    expect(denied.status).toBe(403);
    expect((await t(S, admin).get('/api/v1/pharmacy/items').query({ q: 'PCM500', all: 'true' })).body.data).toHaveLength(0); // nothing half-created
    expect((await t(S, admin).post('/api/v1/pharmacy/items').send({ ...body, code: 'NOCASH', prices: { sha: 4 } })).status).toBe(400);
    const ok = await t(S, admin).post('/api/v1/pharmacy/items').send(body);
    expect(ok.status).toBe(201);
    pcm = ok.body.data._id;
    await t(S, pharmMgr).post('/api/v1/pharmacy/stock/receive').send({ locationId: pharmacyLoc, lines: [{ itemId: pcm, batchNumber: 'P1', expiryDate: new Date(Date.now() + 400 * 86400_000), quantity: 100, unitCost: 1 }] });
    const list = await t(S, pharmacist).get('/api/v1/pharmacy/items').query({ q: 'PCM500' });
    expect(list.body.data[0]).toMatchObject({ billingCode: 'RX-PCM500', prices: { cash: 5, sha: 4, insurance: 6, foreigner: 10 }, stock: { usable: 100 } });
    // Clearing one list removes it (it then bills at cash); the service catalogue is the same record.
    await t(S, admin).patch(`/api/v1/pharmacy/items/${pcm}`).send({ prices: { insurance: null } });
    const svc = await t(S, admin).get('/api/v1/billing/services').query({ q: 'RX-PCM500', active: 'all' });
    expect(Object.fromEntries(svc.body.data[0].prices.map((p: { priceList: string; amount: number }) => [p.priceList, p.amount]))).toEqual({ cash: 5, sha: 4, foreigner: 10 });
  });

  it('bills a cash-paying non-Kenyan at the foreigner price and a Kenyan at the cash price', async () => {
    const charge = async (nationality: string) => {
      const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Price', lastName: nationality, gender: 'female', nationality });
      const v = await t(S, admin).post('/api/v1/visits').send({ patientId: p.body.data._id, firstStage: 'consultation' });
      const vid = v.body.data.visit._id;
      const rx = await t(S, doctor).post('/api/v1/pharmacy/prescriptions').send({ visitId: vid, items: [{ itemId: pcm, drugName: 'Paracetamol 500mg', dose: '1g', frequency: 'TDS', quantity: 3 }] });
      expect(rx.status).toBe(201);
      const d = await t(S, pharmacist).post(`/api/v1/pharmacy/prescriptions/${rx.body.data._id}/dispense`).send({ locationId: pharmacyLoc, lines: [{ rxItemId: rx.body.data.items[0]._id, itemId: pcm, quantity: 3 }] });
      expect(d.body.error).toBeUndefined();
      const invs = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${vid}`);
      const inv = invs.body.data[0];
      return { list: inv.payer.priceList, amount: inv.totals.gross };
    };
    expect(await charge('Somali')).toEqual({ list: 'foreigner', amount: 30 });
    expect(await charge('Kenyan')).toEqual({ list: 'cash', amount: 15 });
  });
});
