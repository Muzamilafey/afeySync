import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';

/** A stand-in for backend.payhero.co.ke following the Pay Hero v2 documentation. */
const ph = { payments: [] as Array<Record<string, unknown>>, status: new Map<string, { status: string; provider_reference?: string }>(), n: 0, auth: [] as string[] };
const daraja = { stk: [] as Array<Record<string, unknown>> };
let server: http.Server;
let url = '';

const S = 'phfac';
let owner = '';
let admin = '';
let cashier = '';
let F: Awaited<ReturnType<typeof createFacility>>;
let patientId = '';

const newInvoice = async (amount = 1000) => {
  const inv = await t(S, cashier).post('/api/v1/billing/invoices').send({ patientId, lines: [{ serviceCode: 'PH-CONS', quantity: amount / 1000 }] });
  return inv.body.data as { _id: string; invoiceNumber: string };
};
const token = async (provider: string, tenantId: string | null) => {
  const ep = await meta().CallbackEndpoint.findOne({ provider, tenantId }).lean();
  return IntegrationSecretService.decrypt(ep!.tokenEncrypted!.ciphertext!);
};
const callback = (checkout: string, extra: Record<string, unknown> = {}) => ({ forward_url: '', status: true, response: { CheckoutRequestID: checkout, MerchantRequestID: 'x', ResultCode: 0, ResultDesc: 'The service request is processed successfully.', Status: 'Success', ...extra } });

beforeAll(async () => {
  await setupApp();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const u = new URL(req.url!, 'http://x');
      if (u.pathname.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'd', expires_in: '3599' }));
      if (u.pathname === '/mpesa/stkpush/v1/processrequest') { daraja.stk.push(JSON.parse(body)); return res.end(JSON.stringify({ MerchantRequestID: 'm', CheckoutRequestID: `ws_D_${daraja.stk.length}`, ResponseCode: '0', CustomerMessage: 'ok' })); }
      ph.auth.push(String(req.headers.authorization));
      if (req.headers.authorization !== 'Basic dG9rOnNlY3JldA==') { res.statusCode = 401; return res.end(JSON.stringify({ error_message: 'unauthorized' })); }
      if (u.pathname === '/api/v2/payment_channels') return res.end(JSON.stringify({ payment_channels: [{ id: 133, channel_type: 'till', short_code: '1731901', account_number: '', description: 'Ndabibi Nursing Home', is_active: true }], pagination: { count: 1 } }));
      if (u.pathname === '/api/v2/payments' && req.method === 'POST') {
        ph.n += 1;
        const b = JSON.parse(body);
        ph.payments.push(b);
        const reference = `PHREF${ph.n}`;
        ph.status.set(reference, { status: 'QUEUED' });
        res.statusCode = 201;
        return res.end(JSON.stringify({ success: true, status: 'QUEUED', reference, CheckoutRequestID: `ws_PH_${ph.n}` }));
      }
      if (u.pathname === '/api/v2/transaction-status') {
        const st = ph.status.get(u.searchParams.get('reference') ?? '');
        if (!st) { res.statusCode = 404; return res.end(JSON.stringify({ error_message: 'not found' })); }
        return res.end(JSON.stringify({ provider: 'm-pesa', success: st.status === 'SUCCESS', status: st.status, reference: u.searchParams.get('reference'), provider_reference: st.provider_reference ?? '' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = await ownerToken();
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  cashier = await createUser(S, admin, { email: 'cash@ph.test', roleKey: 'cashier', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'PH-CONS', name: 'Consultation', category: 'consultation', prices: [{ priceList: 'cash', amount: 1000 }] });
  patientId = (await t(S, admin).post('/api/v1/patients').send({ firstName: 'Pay', lastName: 'Hero', gender: 'female', phone: '0711000222' })).body.data._id;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await teardown();
});

// Pay Hero shows an API key username and password; together they make the HTTP Basic sign-in (tok:secret here).
const setupPayhero = (settings: Record<string, string>, secrets: Record<string, string> = { apiUsername: 'tok', apiPassword: 'secret', apiSecret: 'signing-secret' }) =>
  t(S, admin).put('/api/v1/admin/integrations/payhero').send({ environment: 'production', settings: { baseUrl: url, ...settings }, secrets, enabled: true });

describe('facility sets up Pay Hero itself', () => {
  it('is listed for the facility (not the owner) and checks the channel', async () => {
    const list = await t(S, admin).get('/api/v1/admin/integrations');
    expect(list.body.data.status.payhero).toMatchObject({ enabled: false, selfService: true });
    expect(list.body.data.status.mpesa).toMatchObject({ enabled: false, selfService: true });
    expect(list.body.data.facilityConfigs.payhero.defaultBaseUrls).toEqual({ production: 'https://backend.payhero.co.ke' });
    expect((await api().put('/api/v1/owner/integrations/payhero').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ enabled: true })).body.error.code).toBe('FACILITY_OWNED_INTEGRATION');
    expect((await setupPayhero({ channelId: 'abc', role: 'primary' })).body.error.message).toMatch(/channel ID must be a number/);
    expect((await setupPayhero({ channelId: '133', role: 'primary' }, { apiUsername: 'tok' })).body.error.message).toMatch(/API key password/);
    expect((await setupPayhero({ role: 'primary' })).body.error.message).toMatch(/Payment channel ID/);

    expect((await setupPayhero({ channelId: '999', role: 'primary' })).status).toBe(200);
    const wrong = await t(S, admin).post('/api/v1/admin/integrations/payhero/test');
    expect(wrong.body.data).toMatchObject({ ok: false, error: { code: 'PAYHERO_CHANNEL_NOT_FOUND' } });
    expect(wrong.body.data.error.message).toMatch(/133 \(Ndabibi Nursing Home\)/);
    expect((await setupPayhero({ channelId: '133', role: 'primary' })).status).toBe(200);
    const ok = await t(S, admin).post('/api/v1/admin/integrations/payhero/test');
    expect(ok.body.data).toMatchObject({ ok: true, paysInto: 'till 1731901 (Ndabibi Nursing Home)' });
    expect((await t(S, admin).get('/api/v1/admin/integrations')).body.data.status.payhero.enabled).toBe(true);
    // the token is never returned
    const listed = JSON.stringify((await t(S, admin).get('/api/v1/admin/integrations')).body);
    expect(listed).not.toContain('signing-secret');
    expect(listed).not.toMatch(/"secret"/);
  });
});

describe('M-Pesa prompts through Pay Hero', () => {
  it('sends the prompt to the channel and records it only after Pay Hero confirms', async () => {
    const inv = await newInvoice();
    const r = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv._id, phone: '254712345678', amount: 1000, idempotencyKey: 'ph-stk-00001' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'pending', mpesa: { gateway: 'payhero', gatewayReference: 'PHREF1', checkoutRequestId: 'ws_PH_1' } });
    const sent = ph.payments.at(-1)!;
    expect(sent).toMatchObject({ amount: 1000, phone_number: '0712345678', channel_id: 133, provider: 'm-pesa' });
    expect(String(sent.external_reference)).toMatch(new RegExp(`^${inv.invoiceNumber}-`));
    expect(sent.customer_name).toBeUndefined(); // patient names are not shared with the gateway
    expect(String(sent.callback_url)).toMatch(/\/api\/v1\/payments\/payhero\/callback\//);

    const tok = await token('payhero', F.id);
    expect((await api().post('/api/v1/payments/payhero/callback/not_a_real_token_1234567890').send(callback('ws_PH_1'))).status).toBe(404);
    // A callback claiming success is not enough while Pay Hero still says QUEUED.
    await api().post(`/api/v1/payments/payhero/callback/${tok}`).send(callback('ws_PH_1', { MpesaReceiptNumber: 'SFAKE00001', Amount: 1000 }));
    expect((await t(S, cashier).get(`/api/v1/billing/invoices/${inv._id}`)).body.data.status).not.toBe('paid');

    ph.status.set('PHREF1', { status: 'SUCCESS', provider_reference: 'SPH1234567' });
    // A receipt in the callback that differs from Pay Hero's record is refused.
    const inv2 = await newInvoice();
    await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv2._id, phone: '0712345679', amount: 1000, idempotencyKey: 'ph-stk-00002' });
    ph.status.set('PHREF2', { status: 'SUCCESS', provider_reference: 'SPH7654321' });
    await api().post(`/api/v1/payments/payhero/callback/${tok}`).send(callback('ws_PH_2', { MpesaReceiptNumber: 'SOTHER0000', Amount: 1000 }));
    expect((await t(S, cashier).get(`/api/v1/billing/invoices/${inv2._id}`)).body.data.status).not.toBe('paid');

    await api().post(`/api/v1/payments/payhero/callback/${tok}`).send(callback('ws_PH_1', { MpesaReceiptNumber: 'SPH1234567', Amount: 1000 }));
    await api().post(`/api/v1/payments/payhero/callback/${tok}`).send(callback('ws_PH_1', { MpesaReceiptNumber: 'SPH1234567', Amount: 1000 })); // duplicate
    const paid = (await t(S, cashier).get(`/api/v1/billing/invoices/${inv._id}`)).body.data;
    expect(paid.status).toBe('paid');
    const payments = (paid.payments as Array<{ status: string; mpesa?: Record<string, unknown> }>).filter((x) => x.status === 'completed');
    expect(payments).toHaveLength(1);
    expect(payments[0].mpesa).toMatchObject({ receiptNumber: 'SPH1234567', gateway: 'payhero' });
  });

  it('refuses a callback whose amount differs from the prompt', async () => {
    const inv = await newInvoice();
    await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv._id, phone: '0722000333', amount: 1000, idempotencyKey: 'ph-stk-00003' });
    ph.status.set(`PHREF${ph.n}`, { status: 'SUCCESS', provider_reference: 'SPH0000003' });
    await api().post(`/api/v1/payments/payhero/callback/${await token('payhero', F.id)}`).send(callback(`ws_PH_${ph.n}`, { MpesaReceiptNumber: 'SPH0000003', Amount: 1 }));
    const p = (await t(S, cashier).get(`/api/v1/billing/invoices/${inv._id}`)).body.data.payments.at(-1);
    expect(p).toMatchObject({ status: 'failed' });
    expect(p!.notes).toMatch(/KES 1 for a KES 1000 prompt/);
  });

  it('settles from the cashier status check when the callback never came, and fails a cancelled prompt', async () => {
    const inv = await newInvoice();
    const r = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv._id, phone: '0733000444', amount: 1000, idempotencyKey: 'ph-stk-00004' });
    ph.status.set(r.body.data.mpesa.gatewayReference, { status: 'SUCCESS', provider_reference: 'SPH0000004' });
    const q = await t(S, cashier).post(`/api/v1/payments/mpesa/${r.body.data._id}/query`);
    expect(q.body.data).toMatchObject({ status: 'completed', reference: 'SPH0000004' });

    const inv2 = await newInvoice();
    const r2 = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv2._id, phone: '0733000555', amount: 1000, idempotencyKey: 'ph-stk-00005' });
    ph.status.set(r2.body.data.mpesa.gatewayReference, { status: 'FAILED' });
    expect((await t(S, cashier).post(`/api/v1/payments/mpesa/${r2.body.data._id}/query`)).body.data.status).toBe('failed');
  });

  it('uses Daraja instead when Pay Hero is set as the backup', async () => {
    await t(S, admin).put('/api/v1/admin/integrations/mpesa').send({ environment: 'sandbox', settings: { accountType: 'till', shortcode: '4501863', till: '1731901', baseUrl: url }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    expect((await setupPayhero({ channelId: '133', role: 'backup' }, {})).status).toBe(200);
    const inv = await newInvoice();
    const r = await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv._id, phone: '0744000666', amount: 1000, idempotencyKey: 'ph-stk-00006' });
    expect(r.body.data.mpesa.gateway).toBe('daraja');
    expect(daraja.stk.at(-1)).toMatchObject({ PartyB: '1731901', TransactionType: 'CustomerBuyGoodsOnline' });
    // Turning Daraja off falls back to Pay Hero.
    await t(S, admin).put('/api/v1/admin/integrations/mpesa').send({ enabled: false });
    const inv2 = await newInvoice();
    expect((await t(S, cashier).post('/api/v1/payments/mpesa/stk').send({ invoiceId: inv2._id, phone: '0744000777', amount: 1000, idempotencyKey: 'ph-stk-00007' })).body.data.mpesa.gateway).toBe('payhero');
  });
});

describe('owner collects subscriptions and SMS credits through Pay Hero', () => {
  it('tops up the SMS wallet by a Pay Hero prompt, confirmed with Pay Hero', async () => {
    const own = (path: string) => api().put(`/api/v1/owner${path}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect((await own('/integrations/payhero_billing').send({ environment: 'production', settings: { baseUrl: url, channelId: '133', role: 'primary' }, secrets: { apiUsername: 'tok', apiPassword: 'secret' }, enabled: true })).status).toBe(200);
    // facilities cannot touch the owner's account
    expect((await t(S, admin).put('/api/v1/admin/integrations/payhero_billing').send({ enabled: true })).status).toBe(403);
    const before = (await t(S, admin).get('/api/v1/sms-wallet')).body.data;
    expect(before.mpesa.available).toBe(true);
    const r = await t(S, admin).post('/api/v1/sms-wallet/topup').send({ amount: 500, phone: '0712345678' });
    expect(r.status).toBe(201);
    const p = await meta().PlatformPayment.findById(r.body.data.paymentId).lean();
    expect(p!.mpesa).toMatchObject({ gateway: 'payhero' });
    expect(String(ph.payments.at(-1)!.callback_url)).toMatch(/\/api\/v1\/payments\/platform-payhero\/callback\//);
    ph.status.set(p!.mpesa!.gatewayReference!, { status: 'SUCCESS', provider_reference: 'SPHSMS0001' });
    await api().post(`/api/v1/payments/platform-payhero/callback/${await token('payhero_billing', null)}`).send(callback(p!.mpesa!.checkoutRequestId!, { MpesaReceiptNumber: 'SPHSMS0001', Amount: 500 }));
    const after = (await t(S, admin).get('/api/v1/sms-wallet')).body.data;
    expect(after.balance).toBeGreaterThan(before.balance);
    expect((await meta().PlatformPayment.findById(r.body.data.paymentId).lean())).toMatchObject({ status: 'completed', reference: 'SPHSMS0001' });
  });
});
