import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';

const S = 'posmpesa';
let admin = '';
let pharmacist = '';
let loc = '';
let item = '';
let owner = '';
let F: Awaited<ReturnType<typeof createFacility>>;
const sent: Array<Record<string, unknown>> = [];
let failNext = false;
let server: http.Server;
let darajaUrl = '';

beforeAll(async () => {
  await setupApp();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'daraja-token', expires_in: '3599' }));
      if (req.url === '/mpesa/stkpush/v1/processrequest') {
        const b = JSON.parse(body);
        sent.push(b);
        if (failNext) { failNext = false; res.statusCode = 500; return res.end(JSON.stringify({ errorMessage: 'System busy' })); }
        return res.end(JSON.stringify({ MerchantRequestID: `m-${sent.length}`, CheckoutRequestID: `ws_POS_${sent.length}`, ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  darajaUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = await ownerToken();
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  pharmacist = await createUser(S, admin, { email: 'ph@posmpesa.test', roleKey: 'pharmacist', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  loc = (await t(S, admin).get('/api/v1/pharmacy/locations')).body.data.find((l: { type: string }) => l.type === 'pharmacy')._id;
  item = (await t(S, admin).post('/api/v1/pharmacy/items').send({ code: 'MPPARA', name: 'MP Paracetamol', unit: 'tab', prices: { cash: 5 } })).body.data._id;
  await t(S, admin).post('/api/v1/pharmacy/stock/receive').send({ locationId: loc, lines: [{ itemId: item, batchNumber: 'M1', expiryDate: new Date(Date.now() + 400 * 86400_000), quantity: 200, unitCost: 2 }] });
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await teardown();
});

const qty = async () => (await t(S, admin).get('/api/v1/pharmacy/items').query({ q: 'MP Paracetamol' })).body.data[0].stock.usable as number;

describe('M-Pesa paybill / till setup', () => {
  it('needs the account type to enable M-Pesa, and checks the numbers', async () => {
    const put = (settings: Record<string, string>) => t(S, admin).put('/api/v1/admin/integrations/mpesa')
      .send({ environment: 'production', settings, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    const missing = await put({ shortcode: '174379' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/Customers pay into/);
    expect((await put({ accountType: 'till', shortcode: '600100', till: '12AB' })).body.error.message).toMatch(/Till number must be/);
    expect((await put({ accountType: 'bank', shortcode: '600100' })).status).toBe(400);
    // The sandbox address on a production setup is refused.
    const wrongEnv = await put({ accountType: 'till', shortcode: '600100', till: '5123456', baseUrl: 'https://sandbox.safaricom.co.ke/' });
    expect(wrongEnv.body.error.code).toBe('BASE_URL_ENVIRONMENT_MISMATCH');
    const cfg = await t(S, admin).get('/api/v1/admin/integrations');
    expect(cfg.body.data.facilityConfigs.mpesa.defaultBaseUrls).toEqual({ sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' });
    // The owner neither sees nor configures a facility's M-Pesa.
    const ownerList = await api().get('/api/v1/owner/integrations').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(ownerList.body.data.some((c: { provider: string }) => c.provider === 'mpesa' || c.provider === 'payhero')).toBe(false);
    expect((await api().put('/api/v1/owner/integrations/mpesa').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ enabled: true })).body.error.code).toBe('FACILITY_OWNED_INTEGRATION');
    // Leave it disabled for the first POS test.
    await t(S, admin).put('/api/v1/admin/integrations/mpesa').send({ enabled: false });
  });
});

describe('pharmacy POS M-Pesa prompt', () => {
  it('refuses the prompt before any stock moves when the facility has no M-Pesa set up', async () => {
    const before = await qty();
    const r = await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Amina', lines: [{ itemId: item, quantity: 2 }], mpesaPrompt: { phone: '0712345678', idempotencyKey: 'posmp-00001' } });
    expect(r.status).toBe(503);
    expect(await qty()).toBe(before);
  });

  it('sends the prompt to the facility till, and only the Safaricom callback marks the sale paid', async () => {
    await t(S, admin).put('/api/v1/admin/integrations/mpesa')
      .send({ environment: 'sandbox', settings: { accountType: 'till', shortcode: '600100', till: '5123456', baseUrl: darajaUrl }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    expect((await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Amina', lines: [{ itemId: item, quantity: 2 }], mpesaPrompt: { phone: '12345', idempotencyKey: 'posmp-00002' } })).status).toBe(400);

    const r = await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Amina', lines: [{ itemId: item, quantity: 10 }], mpesaPrompt: { phone: '0712345678', idempotencyKey: 'posmp-00003' } });
    expect(r.status).toBe(201);
    expect(r.body.data.sale.status).toBe('awaiting_payment');
    expect(r.body.data.mpesa.paymentId).toBeTruthy();
    const last = sent.at(-1)!;
    expect(last).toMatchObject({ TransactionType: 'CustomerBuyGoodsOnline', BusinessShortCode: '600100', PartyB: '5123456', Amount: 50, PhoneNumber: '254712345678' });
    const id = r.body.data.sale._id;
    const pending = await t(S, pharmacist).get(`/api/v1/pharmacy/sales/${id}/mpesa`);
    expect(pending.body.data).toMatchObject({ saleStatus: 'awaiting_payment', payment: { status: 'pending', phone: '***678' } });
    // A second prompt to the same phone while the first is in flight is refused.
    expect((await t(S, pharmacist).post(`/api/v1/pharmacy/sales/${id}/mpesa`).send({ phone: '0712345678', idempotencyKey: 'posmp-00004' })).body.error.code).toBe('STK_IN_PROGRESS');

    const ep = await meta().CallbackEndpoint.findOne({ provider: 'mpesa', tenantId: F.id }).lean();
    const token = IntegrationSecretService.decrypt(ep!.tokenEncrypted!.ciphertext!);
    await api().post(`/api/v1/payments/mpesa/callback/${token}`).send({ Body: { stkCallback: { CheckoutRequestID: `ws_POS_${sent.length}`, ResultCode: 0, ResultDesc: 'OK', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 50 }, { Name: 'MpesaReceiptNumber', Value: 'SPOS123456' }] } } } });
    const done = await t(S, pharmacist).get(`/api/v1/pharmacy/sales/${id}/mpesa`);
    expect(done.body.data).toMatchObject({ saleStatus: 'paid', payment: { status: 'completed', mpesaReceipt: 'SPOS123456' } });
    expect((await t(S, pharmacist).post(`/api/v1/pharmacy/sales/${id}/mpesa`).send({ phone: '0712345678', idempotencyKey: 'posmp-00005' })).body.error.code).toBe('SALE_NOT_PAYABLE');
  });

  it('keeps the sale awaiting payment when Safaricom cannot be reached, and lets the prompt be re-sent', async () => {
    failNext = true;
    const r = await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Baraka', lines: [{ itemId: item, quantity: 4 }], mpesaPrompt: { phone: '0722000111', idempotencyKey: 'posmp-00006' } });
    expect(r.status).toBe(201);
    expect(r.body.data.sale.status).toBe('awaiting_payment');
    expect(r.body.data.mpesa.error).toMatch(/busy/i);
    const again = await t(S, pharmacist).post(`/api/v1/pharmacy/sales/${r.body.data.sale._id}/mpesa`).send({ phone: '0722000111', idempotencyKey: 'posmp-00007' });
    expect(again.status).toBe(201);
    expect(sent.at(-1)).toMatchObject({ Amount: 20, PartyB: '5123456' });
  });

  it('pays a paybill facility to its shortcode, with the invoice number as the account', async () => {
    await t(S, admin).put('/api/v1/admin/integrations/mpesa')
      .send({ environment: 'sandbox', settings: { accountType: 'paybill', shortcode: '174379', till: '5123456', baseUrl: darajaUrl }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    const r = await t(S, pharmacist).post('/api/v1/pharmacy/sales').send({ locationId: loc, customerName: 'Chebet', lines: [{ itemId: item, quantity: 1 }], mpesaPrompt: { phone: '0733000222', idempotencyKey: 'posmp-00008' } });
    expect(r.status).toBe(201);
    expect(sent.at(-1)).toMatchObject({ TransactionType: 'CustomerPayBillOnline', PartyB: '174379', AccountReference: r.body.data.sale.invoiceNumber });
  });
});
