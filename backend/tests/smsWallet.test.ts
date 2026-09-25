import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { runNextJob } from '../src/jobs/queue';
import { registerJobHandlers } from '../src/jobs/handlers';
import { enqueueSms } from '../src/modules/notifications/notify';
import { smsSegments } from '../src/modules/sms/smsWallet';

/* Local stand-ins for the documented Daraja and Talksasa APIs, used only by these tests. */
const sms: Array<Record<string, string>> = [];
let failSms = false;
const daraja = { last: null as null | Record<string, unknown>, n: 0 };
let server: http.Server;
let base = '';
let owner = '';
let admin = '';
let tenantId = '';
const S = 'walletfac';
const own = (m: 'get' | 'put' | 'post', url: string) => api()[m](`/api/v1/owner${url}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
const wallet = async () => (await t(S, admin).get('/api/v1/sms-wallet')).body.data;

async function send(message: string, opts: { critical?: boolean; sensitive?: boolean } = {}) {
  const j = await enqueueSms(tenantId, `test-${Date.now()}-${Math.random()}`, '0712000444', message, { ...opts, maxAttempts: 1 });
  for (let i = 0; i < 300; i++) {
    const job = await meta().Job.findById(j.id).lean();
    if (job && !['queued', 'running'].includes(job.status)) return job;
    if (!(await runNextJob())) break;
  }
  return meta().Job.findById(j.id).lean();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'tok', expires_in: '3599' }));
      if (req.url === '/mpesa/stkpush/v1/processrequest') {
        daraja.n += 1;
        daraja.last = JSON.parse(raw);
        return res.end(JSON.stringify({ MerchantRequestID: `m-${daraja.n}`, CheckoutRequestID: `ws_SMS_${daraja.n}`, ResponseCode: '0', CustomerMessage: 'Success' }));
      }
      if (req.url === '/api/v3/sms/send') {
        if (failSms) { res.statusCode = 500; return res.end(JSON.stringify({ status: 'error', message: 'Gateway down' })); }
        sms.push(JSON.parse(raw));
        return res.end(JSON.stringify({ status: 'success', data: { uid: `u${sms.length}` } }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setupApp();
  registerJobHandlers();
  owner = await ownerToken();
  // The platform SMS gateway; the facility does NOT get any per-facility SMS switch.
  await own('put', '/integrations/talksasa').send({ enabled: true, environment: 'production', settings: { baseUrl: `${base}/api/v3`, senderId: 'AFEYSYNC' }, secrets: { apiToken: 'tok' } });
  await own('put', '/integrations/mpesa_billing').send({ environment: 'sandbox', settings: { shortcode: '600100', paybill: '600100', baseUrl: base }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
  tenantId = (await createFacility(owner, S)).id;
  admin = (await tenantLogin(S, `admin@${S}.test`)).token;
});
afterAll(async () => {
  await teardown();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('SMS wallet', () => {
  it('counts SMS segments like the networks do', () => {
    expect(smsSegments('Hello')).toBe(1);
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('a'.repeat(306))).toBe(2);
    expect(smsSegments('Karibu 😊')).toBe(1);
    expect(smsSegments('😊'.repeat(71))).toBe(2);
  });

  it('gives every new facility 20 free welcome SMS, once, and tells its administrators', async () => {
    const w = await wallet();
    expect(w).toMatchObject({ balance: 20, status: 'ok', welcome: { credits: 20 }, mpesa: { available: true, paybill: '600100', accountRef: 'SMSWALLETFAC' } });
    await wallet();
    expect((await meta().SmsLedger.countDocuments({ tenantId, type: 'welcome' }))).toBe(1);
    const notes = (await t(S, admin).get('/api/v1/notifications')).body.data;
    expect(JSON.stringify(notes)).toMatch(/20 free SMS added/);
  });

  it('sends facility SMS through the platform gateway with no per-facility switch, charging per segment', async () => {
    const tenant = await meta().Tenant.findById(tenantId).lean();
    expect(tenant?.integrations?.talksasa).toBe(false);
    const job = await send('Your appointment is tomorrow at 9:00');
    expect(job?.status).toBe('completed');
    expect(sms.at(-1)).toMatchObject({ recipient: '254712000444', sender_id: 'AFEYSYNC' });
    expect((await wallet()).balance).toBe(19);
    await send('x'.repeat(200));
    expect((await wallet()).balance).toBe(17);
  });

  it('returns the credits when the gateway fails', async () => {
    failSms = true;
    const job = await send('This will fail');
    failSms = false;
    expect(job?.status).toBe('dead');
    expect((await wallet()).balance).toBe(17);
    const ledger = (await t(S, admin).get('/api/v1/sms-wallet/ledger')).body.data.map((l: { type: string }) => l.type);
    expect(ledger.slice(0, 2)).toEqual(['refund', 'debit']);
  });

  it('warns when low, stops ordinary SMS when empty, and still lets sign-in codes through from a small reserve', async () => {
    await own('post', `/sms/wallets/${tenantId}/adjust`).send({ credits: -12, note: 'test: use up credits' });
    await send('one more');
    expect((await wallet()).status).toBe('low');
    await own('post', `/sms/wallets/${tenantId}/adjust`).send({ credits: -4, note: 'test: use up credits' });
    expect((await wallet()).balance).toBe(0);
    const stopped = await send('no credits left');
    expect(stopped?.status).toBe('dead');
    expect(stopped?.lastError).toMatch(/SMS wallet is empty/);
    const titles = JSON.stringify((await t(S, admin).get('/api/v1/notifications')).body.data);
    expect(titles).toMatch(/running low/);
    expect(titles).toMatch(/SMS wallet is empty/);
    expect(await meta().Job.countDocuments({ type: 'EMAIL', 'payload.subject': { $regex: /SMS wallet is empty/ } })).toBeGreaterThan(0);
    const otp = await send('Your verification code is 123456', { critical: true, sensitive: true });
    expect(otp?.status).toBe('completed');
    expect((await wallet()).balance).toBe(-1);
    // the code never sits in the queue in plain text, and the encrypted copy is wiped once sent
    expect(JSON.stringify(otp?.payload)).not.toContain('123456');
    expect((otp?.payload as Record<string, unknown>).messageEnc).toBeUndefined();
  });

  it('tops up with M-Pesa through the owner channel, credits once per receipt, and re-arms the alerts', async () => {
    expect((await t(S, admin).post('/api/v1/sms-wallet/topup').send({ amount: 20, phone: '0712345678' })).body.error.message).toMatch(/minimum top-up is KES 50/);
    const r = await t(S, admin).post('/api/v1/sms-wallet/topup').send({ amount: 500, phone: '0712345678' });
    expect(r.status).toBe(201);
    expect(r.body.data.credits).toBe(500);
    expect(daraja.last).toMatchObject({ Amount: 500, AccountReference: 'SMSWALLETFAC', TransactionDesc: 'SMS credits' });
    const path = new URL(String(daraja.last!.CallBackURL)).pathname;
    const cb = { Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: `ws_SMS_${daraja.n}`, ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }, { Name: 'MpesaReceiptNumber', Value: 'SMS1234567' }, { Name: 'TransactionDate', Value: 20260925101010 }] } } } };
    await api().post(path).send(cb);
    await api().post(path).send(cb); // Safaricom may deliver twice
    expect((await wallet()).balance).toBe(499);
    expect((await t(S, admin).get(`/api/v1/sms-wallet/topup/${r.body.data.paymentId}`)).body.data).toMatchObject({ status: 'completed', credits: 500, receipt: 'SMS1234567' });
    const w = await meta().SmsWallet.findOne({ tenantId }).lean();
    expect(w?.emptyAlertAt).toBeFalsy();
    // paybill with the facility's account number also tops up
    const c2b = path.replace(/\/callback\/([^/]+)$/, '/c2b/$1/confirmation');
    await api().post(c2b).send({ TransID: 'SMS7654321', TransAmount: '100', BillRefNumber: 'sms-walletfac', MSISDN: '254712345678' });
    expect((await wallet()).balance).toBe(599);
  });

  it('lets the owner set pricing and see every wallet', async () => {
    expect((await own('put', '/sms/settings').send({ pricePerSms: 0.8, welcomeCredits: 20, lowBalanceCredits: 50, minTopupKes: 100, otpOverdraftCredits: 5 })).status).toBe(200);
    const r = await t(S, admin).post('/api/v1/sms-wallet/topup').send({ amount: 100, phone: '0712345678' });
    expect(r.body.data.credits).toBe(125);
    const list = (await own('get', '/sms/wallets')).body.data;
    expect(list.find((w: { slug: string }) => w.slug === S)).toMatchObject({ balance: 599, walletStatus: 'ok' });
    expect((await own('post', `/sms/wallets/${tenantId}/adjust`).send({ credits: 0, note: 'x' })).status).toBe(400);
  });
});
