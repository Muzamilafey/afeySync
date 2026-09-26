import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';

const S = 'billfac';
let admin: string;
let cashier: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let patientId: string;
let daraja: { close: () => Promise<void>; url: string; stk: number };

async function startDaraja() {
  const state = { stk: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'daraja-token', expires_in: '3599' }));
      if (req.url === '/mpesa/stkpush/v1/processrequest') {
        state.stk += 1;
        const b = JSON.parse(body);
        if (!b.Password || !b.CallBackURL.includes('/api/v1/payments/mpesa/callback/')) return res.end(JSON.stringify({ errorMessage: 'bad' }));
        return res.end(JSON.stringify({ MerchantRequestID: `m-${state.stk}`, CheckoutRequestID: `ws_CO_${state.stk}`, ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { get stk() { return state.stk; }, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

beforeAll(async () => {
  await setupApp();
  daraja = await startDaraja();
  const owner = await ownerToken();
  await api().put('/api/v1/owner/integrations/mpesa').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`)
    .send({ environment: 'sandbox', settings: { accountType: 'paybill', shortcode: '174379', baseUrl: daraja.url }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
  F = await createFacility(owner, S);
  await api().put(`/api/v1/owner/tenants/${F.id}/integrations`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ mpesa: true });
  admin = (await tenantLogin(S, F.admin.email)).token;
  cashier = await createUser(S, admin, { email: 'cashier@billfac.test', roleKey: 'cashier', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'CONS-GEN', name: 'General consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 1000 }, { priceList: 'sha', amount: 800 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-FBC', name: 'Full blood count', category: 'laboratory', prices: [{ priceList: 'cash', amount: 600 }] });
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Bill', lastName: 'Payer', gender: 'male', phone: '0711000111' });
  patientId = p.body.data._id;
});
afterAll(async () => {
  await daraja.close();
  await teardown();
});

describe('billing engine', () => {
  let invoiceId: string;
  it('creates an invoice from catalog prices; unknown services are flagged not blocked', async () => {
    const res = await t(S, cashier).post('/api/v1/billing/invoices').send({ patientId, lines: [{ serviceCode: 'CONS-GEN', quantity: 1 }, { serviceCode: 'LAB-FBC', quantity: 2 }, { serviceCode: 'NOPE', quantity: 1 }] });
    expect(res.status).toBe(201);
    invoiceId = res.body.data._id;
    expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(res.body.data.totals).toEqual(expect.objectContaining({ gross: 2200, net: 2200, balance: 2200 }));
    expect(res.body.data.lines.find((l: { serviceCode: string }) => l.serviceCode === 'NOPE').description).toContain('[PRICE NOT SET]');
  });

  it('cashier cannot waive or change prices', async () => {
    expect((await t(S, cashier).post(`/api/v1/billing/invoices/${invoiceId}/adjustments`).send({ type: 'waiver', amount: 100, reason: 'Needy patient' })).status).toBe(403);
    expect((await t(S, cashier).post('/api/v1/billing/services').send({ code: 'X1', name: 'X', category: 'other', prices: [{ priceList: 'cash', amount: 1 }] })).status).toBe(403);
  });

  it('applies approved discounts and idempotent payments with receipts', async () => {
    const d = await t(S, admin).post(`/api/v1/billing/invoices/${invoiceId}/adjustments`).send({ type: 'discount', amount: 200, reason: 'Staff dependant discount' });
    expect(d.body.data.totals.net).toBe(2000);
    const pay = { invoiceId, method: 'cash', amount: 500, idempotencyKey: 'pay-key-00001' };
    const p1 = await t(S, cashier).post('/api/v1/billing/payments').send(pay);
    expect(p1.status).toBe(201);
    expect(p1.body.data.receiptNumber).toMatch(/^RCT-\d{6}$/);
    const p2 = await t(S, cashier).post('/api/v1/billing/payments').send(pay);
    expect(p2.status).toBe(200);
    expect(p2.body.idempotentReplay).toBe(true);
    const inv = await t(S, cashier).get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(inv.body.data.totals).toEqual(expect.objectContaining({ paid: 500, balance: 1500 }));
    expect(inv.body.data.status).toBe('partially_paid');
    expect(inv.body.data.payments).toHaveLength(1);
  });

  it('rejects overpayment and duplicate M-Pesa receipts', async () => {
    expect((await t(S, cashier).post('/api/v1/billing/payments').send({ invoiceId, method: 'cash', amount: 99999, idempotencyKey: 'pay-key-00002' })).body.error.code).toBe('OVERPAYMENT');
    await t(S, cashier).post('/api/v1/billing/payments').send({ invoiceId, method: 'mpesa', amount: 100, reference: 'QAB1234567', idempotencyKey: 'pay-key-00003' });
    const dup = await t(S, cashier).post('/api/v1/billing/payments').send({ invoiceId, method: 'mpesa', amount: 100, reference: 'qab1234567', idempotencyKey: 'pay-key-00004' });
    expect(dup.body.error.code).toBe('DUPLICATE_RECEIPT');
  });

  it('refunds require a different approver and flow into the balance', async () => {
    const payments = await t(S, cashier).get(`/api/v1/billing/payments?invoiceId=${invoiceId}`);
    const cash = payments.body.data.find((p: { method: string }) => p.method === 'cash');
    expect((await t(S, cashier).post(`/api/v1/billing/payments/${cash._id}/refund`).send({ amount: 100, reason: 'Service not rendered', method: 'cash' })).status).toBe(403);
    const r = await t(S, admin).post(`/api/v1/billing/payments/${cash._id}/refund`).send({ amount: 100, reason: 'Service not rendered', method: 'cash' });
    expect(r.status).toBe(201);
    const inv = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(inv.body.data.totals.paid).toBe(500);
    expect(inv.body.data.creditNotes).toHaveLength(1);
  });

  it('M-Pesa STK push → verified callback completes payment exactly once', async () => {
    const stk = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId, phone: '0712345678', amount: 300, idempotencyKey: 'stk-key-00001' });
    expect(stk.status).toBe(201);
    expect(stk.body.data.status).toBe('pending');
    const again = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId, phone: '0712345678', amount: 300, idempotencyKey: 'stk-key-00002' });
    expect(again.body.error.code).toBe('STK_IN_PROGRESS');
    const ep = await meta().CallbackEndpoint.findOne({ provider: 'mpesa', tenantId: F.id }).lean();
    const token = IntegrationSecretService.decrypt(ep!.tokenEncrypted!.ciphertext!);
    const cb = { Body: { stkCallback: { MerchantRequestID: 'm-1', CheckoutRequestID: stk.body.data.mpesa.checkoutRequestId, ResultCode: 0, ResultDesc: 'OK', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 300 }, { Name: 'MpesaReceiptNumber', Value: 'QKX9ABCDEF' }, { Name: 'TransactionDate', Value: 20260924120000 }, { Name: 'PhoneNumber', Value: 254712345678 }] } } } };
    expect((await api().post('/api/v1/payments/mpesa/callback/wrongtoken_wrongtoken_1234').send(cb)).status).toBe(404);
    expect((await api().post(`/api/v1/payments/mpesa/callback/${token}`).send(cb)).body.ResultCode).toBe(0);
    await api().post(`/api/v1/payments/mpesa/callback/${token}`).send(cb); // duplicate delivery
    const payments = await t(S, admin).get(`/api/v1/billing/payments?q=QKX9ABCDEF`);
    expect(payments.body.data).toHaveLength(1);
    expect(payments.body.data[0].status).toBe('completed');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(inv.body.data.totals.paid).toBe(800);
  });

  it('C2B confirmations allocate by invoice number or go to reconciliation', async () => {
    const ep = await meta().CallbackEndpoint.findOne({ provider: 'mpesa', tenantId: F.id }).lean();
    const token = IntegrationSecretService.decrypt(ep!.tokenEncrypted!.ciphertext!);
    const inv = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    await api().post(`/api/v1/payments/mpesa/c2b/${token}/confirmation`).send({ TransID: 'RC2B000001', TransAmount: '100', BillRefNumber: inv.body.data.invoiceNumber, MSISDN: '254700000000' });
    await api().post(`/api/v1/payments/mpesa/c2b/${token}/confirmation`).send({ TransID: 'RC2B000001', TransAmount: '100', BillRefNumber: inv.body.data.invoiceNumber });
    await api().post(`/api/v1/payments/mpesa/c2b/${token}/confirmation`).send({ TransID: 'RC2B000002', TransAmount: '50', BillRefNumber: 'UNKNOWN' });
    const after = await t(S, admin).get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(after.body.data.totals.paid).toBe(900);
    const un = await t(S, admin).get('/api/v1/billing/payments?status=unallocated');
    expect(un.body.data).toHaveLength(1);
    const alloc = await t(S, admin).post(`/api/v1/billing/payments/${un.body.data[0]._id}/allocate`).send({ invoiceId });
    expect(alloc.status).toBe(200);
    const summary = await t(S, admin).get('/api/v1/billing/summary');
    expect(summary.body.data.byMethod.find((m: { _id: string }) => m._id === 'mpesa').total).toBeGreaterThan(0);
  });
});
