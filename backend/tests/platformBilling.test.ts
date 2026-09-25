import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { seedPlans } from '../src/modules/plans/planService';

const S = 'planfac';
const S2 = 'planother';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let owner: string;
let admin: string;
let admin2: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let daraja: Awaited<ReturnType<typeof startDaraja>>;

const own = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) => api()[method](`/api/v1/owner${url}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);

async function startDaraja() {
  const state = { stk: 0, last: null as null | Record<string, unknown>, c2b: null as null | Record<string, unknown> };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'tok', expires_in: '3599' }));
      if (req.url === '/mpesa/stkpush/v1/processrequest') {
        state.stk += 1;
        state.last = JSON.parse(body);
        return res.end(JSON.stringify({ MerchantRequestID: `m-${state.stk}`, CheckoutRequestID: `ws_PLAT_${state.stk}`, ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' }));
      }
      if (req.url === '/mpesa/c2b/v1/registerurl') {
        state.c2b = JSON.parse(body);
        return res.end(JSON.stringify({ ResponseCode: '0', ResponseDescription: 'Success' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { state, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const callbackPath = () => new URL(String(daraja.state.last!.CallBackURL)).pathname;
const stkCallback = (checkout: string, ok: boolean, receipt: string, amount: number) => ({
  Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: checkout, ResultCode: ok ? 0 : 1032, ResultDesc: ok ? 'The service request is processed successfully.' : 'Request cancelled by user', CallbackMetadata: ok ? { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt }, { Name: 'TransactionDate', Value: 20260925101010 }, { Name: 'PhoneNumber', Value: 254712345678 }] } : undefined } },
});

beforeAll(async () => {
  await setupApp();
  await seedPlans();
  daraja = await startDaraja();
  owner = await ownerToken();
  F = await createFacility(owner, S);
  await createFacility(owner, S2);
  admin = (await tenantLogin(S, F.admin.email)).token;
  admin2 = (await tenantLogin(S2, `admin@${S2}.test`)).token;
});
afterAll(async () => {
  await daraja.close();
  await teardown();
});

describe('plans and module entitlements', () => {
  it('restricts API modules to the plan and exposes them in /auth/me', async () => {
    expect((await own('put', `/tenants/${F.id}/subscription`).send({ plan: 'basic' })).status).toBe(200);
    const me = await t(S, admin).get('/api/v1/auth/me');
    expect(me.body.data.subscription).toMatchObject({ plan: 'basic', unrestricted: false });
    expect(me.body.data.subscription.modules).toContain('laboratory');
    expect(me.body.data.subscription.modules).not.toContain('dental');
    const blocked = await t(S, admin).get('/api/v1/dental/charts?patientId=000000000000000000000000');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_NOT_IN_PLAN');
    expect((await t(S, admin).get('/api/v1/radiology/exams')).body.error?.code).toBe('MODULE_NOT_IN_PLAN');
    // core modules are always available
    expect((await t(S, admin).get('/api/v1/patients')).status).toBe(200);
    // the owner adds radiology to Basic: it opens immediately
    const plans = (await own('get', '/plans')).body.data;
    const basic = plans.find((p: { key: string }) => p.key === 'basic');
    expect(basic.facilities).toBe(1);
    expect((await own('patch', '/plans/basic').send({ modules: [...basic.modules, 'radiology'], prices: { monthly: 5000, quarterly: 14000, annual: 50000 } })).status).toBe(200);
    expect((await t(S, admin).get('/api/v1/radiology/exams')).status).toBe(200);
    // the other facility (standard plan) is unaffected
    expect((await t(S2, admin2).get('/api/v1/radiology/exams')).status).toBe(200);
  });

  it('validates plan definitions', async () => {
    expect((await own('post', '/plans').send({ key: 'Bad Key', name: 'x', prices: { monthly: 1, quarterly: 1, annual: 1 }, maxBranches: 1, maxUsers: 1 })).status).toBe(400);
    expect((await own('post', '/plans').send({ key: 'clinic-plus', name: 'Clinic Plus', prices: { monthly: 8000, quarterly: 22000, annual: 80000 }, maxBranches: 2, maxUsers: 30, modules: ['laboratory', 'nope'] })).status).toBe(400);
    const ok = await own('post', '/plans').send({ key: 'clinic-plus', name: 'Clinic Plus', prices: { monthly: 8000, quarterly: 22000, annual: 80000 }, maxBranches: 2, maxUsers: 30, modules: ['laboratory', 'pharmacy'], highlight: true });
    expect(ok.status).toBe(201);
    expect((await own('get', '/plans')).body.data.filter((p: { highlight: boolean }) => p.highlight).map((p: { key: string }) => p.key)).toEqual(['clinic-plus']);
    expect((await own('put', `/tenants/${F.id}/subscription`).send({ plan: 'does-not-exist' })).status).toBe(400);
  });
});

let invoiceId: string;
describe('documents with automatic stamp and signature', () => {
  it('refuses to issue until a signature is uploaded; only PNG/JPEG images are accepted', async () => {
    expect((await own('put', '/billing/settings').send({ companyName: 'AfeySync Ltd', kraPin: 'p051234567x', vatRegistered: true, vatRate: 16, signatoryName: 'Muzamil Afey', signatoryTitle: 'Director', email: 'billing@afeysync.test', bank: { name: 'KCB', accountNumber: '1234567890' } })).status).toBe(200);
    const inv = await own('post', '/billing/documents').send({ type: 'invoice', tenantId: F.id, lines: [{ description: 'Standard plan — 1 year', quantity: 1, unitPrice: 120000, kind: 'subscription', planKey: 'standard', billingCycle: 'annual' }, { description: 'Onsite training', quantity: 2, unitPrice: 5000 }] });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ status: 'draft', subtotal: 130000, vatRate: 16, vatAmount: 20800, total: 150800 });
    expect(inv.body.data.number).toMatch(/^INV-\d{4}-0001$/);
    expect(inv.body.data.customer.name).toBe(`${S} Hospital`);
    invoiceId = inv.body.data._id;
    expect((await own('post', `/billing/documents/${invoiceId}/issue`)).body.error.code).toBe('SIGNATURE_REQUIRED');
    expect((await own('post', '/billing/assets/signature').send({ dataBase64: Buffer.from('<svg>not an image</svg>').toString('base64') })).status).toBe(415);
    expect((await own('post', '/billing/assets/signature').send({ dataBase64: PNG })).status).toBe(201);
    expect((await own('post', '/billing/assets/stamp').send({ dataBase64: `data:image/png;base64,${PNG}` })).status).toBe(201);
    expect((await own('get', '/billing/settings')).body.data.assets.stamp.mimeType).toBe('image/png');
  });

  it('refuses to issue a document with a zero total', async () => {
    const z = await own('post', '/billing/documents').send({ type: 'invoice', tenantId: F.id, lines: [{ description: 'Trial plan', quantity: 1, unitPrice: 0, kind: 'subscription', planKey: 'trial', billingCycle: 'monthly' }] });
    expect((await own('post', `/billing/documents/${z.body.data._id}/issue`)).body.error.code).toBe('ZERO_TOTAL');
  });

  it('issues and signs, locks the content, and renders a PDF', async () => {
    const drafts = await t(S, admin).get('/api/v1/subscription/documents');
    expect(drafts.body.data).toHaveLength(0); // drafts are never shown to the facility
    const issued = await own('post', `/billing/documents/${invoiceId}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.body.data.status).toBe('issued');
    expect(issued.body.data.signing).toMatchObject({ signatoryName: 'Muzamil Afey' });
    expect(issued.body.data.signing.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.body.data.signing.stampAssetId).toBeTruthy();
    expect(issued.body.data.balance).toBe(150800);
    expect((await own('patch', `/billing/documents/${invoiceId}`).send({ notes: 'changed' })).body.error.code).toBe('DOCUMENT_LOCKED');
    // a new stamp does not change what the issued invoice was signed with
    await own('post', '/billing/assets/stamp').send({ dataBase64: PNG });
    expect((await own('get', `/billing/documents/${invoiceId}`)).body.data.signing.stampAssetId).toBe(issued.body.data.signing.stampAssetId);
    const pdf = await own('get', `/billing/documents/${invoiceId}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // the signature and stamp images are embedded
    expect(((pdf.body as Buffer).toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((await own('post', `/billing/documents/${invoiceId}/send`).send({})).body.error.message).toMatch(/no email/);
    const sent = await own('post', `/billing/documents/${invoiceId}/send`).send({ to: 'accounts@planfac.test' });
    expect(sent.body.data.sentTo).toBe('accounts@planfac.test');
    const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.to': 'accounts@planfac.test' }).lean();
    const att = (job!.payload as { attachments: Array<{ filename: string; contentBase64: string }> }).attachments[0];
    expect(att.filename).toMatch(/^INV-\d{4}-0001\.pdf$/);
    expect(Buffer.from(att.contentBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('M-Pesa collections', () => {
  it('is unavailable until the owner configures the collections account', async () => {
    const r = await t(S, admin).post(`/api/v1/subscription/documents/${invoiceId}/pay`).send({ phone: '0712345678' });
    expect(r.body.error.code).toBe('INTEGRATION_DISABLED');
    const cfg = await own('put', '/integrations/mpesa_billing').send({ environment: 'sandbox', settings: { shortcode: '600100', paybill: '600100', baseUrl: daraja.url }, secrets: { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, enabled: true });
    expect(cfg.status).toBe(200);
    // facilities can never configure or see the owner's collection account
    expect((await t(S, admin).put('/api/v1/admin/integrations/mpesa_billing').send({ enabled: true })).status).toBe(403);
  });

  it('pays by STK push, confirms only from the callback, and extends the subscription', async () => {
    const reception = await createUser(S, admin, { email: 'desk@planfac.test', roleKey: 'receptionist', branchAccess: 'all', branchIds: [] });
    expect((await t(S, reception).post(`/api/v1/subscription/documents/${invoiceId}/pay`).send({ phone: '0712345678' })).status).toBe(403);
    const r = await t(S, admin).post(`/api/v1/subscription/documents/${invoiceId}/pay`).send({ phone: '0712345678' });
    expect(r.status).toBe(200);
    expect(daraja.state.last).toMatchObject({ Amount: 150800, PhoneNumber: '254712345678', AccountReference: expect.stringMatching(/^INV\d{8}$/) });
    expect((await t(S, admin).post(`/api/v1/subscription/documents/${invoiceId}/pay`).send({ phone: '0712345678' })).body.error.code).toBe('STK_PENDING');
    const path = callbackPath();
    expect(path).toMatch(/^\/api\/v1\/payments\/platform-mpesa\/callback\//);
    expect((await api().post('/api/v1/payments/platform-mpesa/callback/not-a-real-token-xxxxxxxxxxxx').send(stkCallback('ws_PLAT_1', true, 'SIA1234567', 150800))).status).toBe(404);
    await api().post(path).send(stkCallback('ws_PLAT_1', true, 'SIA1234567', 150800));
    await api().post(path).send(stkCallback('ws_PLAT_1', true, 'SIA1234567', 150800)); // duplicate delivery
    const doc = (await t(S, admin).get(`/api/v1/subscription/documents/${invoiceId}`)).body.data;
    expect(doc).toMatchObject({ status: 'paid', amountPaid: 150800, balance: 0 });
    expect(doc.payments.filter((p: { status: string }) => p.status === 'completed')).toHaveLength(1);
    const sub = (await t(S, admin).get('/api/v1/subscription')).body.data.subscription;
    expect(sub).toMatchObject({ plan: 'standard', status: 'active', billingCycle: 'annual', maxBranches: 3, maxUsers: 60 });
    const months = (new Date(sub.endsAt).getTime() - Date.now()) / (30.4 * 86_400_000);
    expect(months).toBeGreaterThan(11.5);
    expect(months).toBeLessThan(12.5);
    expect((await t(S, admin).get('/api/v1/auth/me')).body.data.subscription.modules).toContain('inpatient');
  });

  it('matches paybill payments by invoice number and keeps unmatched ones for allocation', async () => {
    const inv = await own('post', '/billing/documents').send({ type: 'invoice', tenantId: F.id, lines: [{ description: 'Data migration', quantity: 1, unitPrice: 10000 }] });
    const issued = (await own('post', `/billing/documents/${inv.body.data._id}/issue`)).body.data;
    const reg = await own('post', '/billing/mpesa/register-c2b');
    expect(reg.status).toBe(200);
    const confirmUrl = new URL(String(daraja.state.c2b!.ConfirmationURL)).pathname;
    const validateUrl = new URL(String(daraja.state.c2b!.ValidationURL)).pathname;
    const ref = issued.number.replace(/-/g, '').toLowerCase();
    expect((await api().post(validateUrl).send({ BillRefNumber: 'WRONG' })).body.ResultCode).toBe('C2B00012');
    expect((await api().post(validateUrl).send({ BillRefNumber: ref })).body.ResultCode).toBe('0');
    await api().post(confirmUrl).send({ TransID: 'SIB0000001', TransAmount: '4000', BillRefNumber: ref, MSISDN: '254700000000', FirstName: 'Jane' });
    await api().post(confirmUrl).send({ TransID: 'SIB0000001', TransAmount: '4000', BillRefNumber: ref }); // duplicate
    let d = (await own('get', `/billing/documents/${issued._id}`)).body.data;
    expect(d).toMatchObject({ status: 'partially_paid', amountPaid: 4000 });
    // VAT applies: 10000 + 16% = 11600
    expect(d.balance).toBe(7600);
    await api().post(confirmUrl).send({ TransID: 'SIB0000002', TransAmount: '7600', BillRefNumber: 'unknown-ref' });
    const unmatched = (await own('get', '/billing/payments?unmatched=true')).body.data;
    expect(unmatched).toHaveLength(1);
    expect((await own('post', `/billing/payments/${unmatched[0]._id}/allocate`).send({ documentId: issued._id })).status).toBe(200);
    d = (await own('get', `/billing/documents/${issued._id}`)).body.data;
    expect(d.status).toBe('paid');
    // a manual payment cannot reuse an M-Pesa receipt
    const inv3 = await own('post', '/billing/documents').send({ type: 'invoice', tenantId: F.id, lines: [{ description: 'Support', quantity: 1, unitPrice: 1000 }] });
    await own('post', `/billing/documents/${inv3.body.data._id}/issue`);
    expect((await own('post', `/billing/documents/${inv3.body.data._id}/payments`).send({ method: 'mpesa_c2b', amount: 1160, reference: 'SIB0000001' })).body.error.code).toBe('DUPLICATE_RECEIPT');
    expect((await own('post', `/billing/documents/${inv3.body.data._id}/payments`).send({ method: 'bank', amount: 1160, reference: 'EFT-99812' })).body.data.status).toBe('paid');
  });
});

describe('quotations and agreements', () => {
  it('lets a facility request a signed quotation and accept it into a payable invoice', async () => {
    const q = await t(S, admin).post('/api/v1/subscription/quote').send({ planKey: 'basic', billingCycle: 'quarterly', periods: 2 });
    expect(q.status).toBe(201);
    const quote = (await t(S, admin).get(`/api/v1/subscription/documents/${q.body.data._id}`)).body.data;
    expect(quote).toMatchObject({ type: 'quotation', status: 'issued', subtotal: 28000 });
    expect(quote.signing.signatureAssetId).toBeTruthy();
    expect((await t(S, admin).post(`/api/v1/subscription/documents/${quote._id}/accept`).send({ name: 'Fatuma Admin', title: 'Administrator' })).status).toBe(400);
    const acc = await t(S, admin).post(`/api/v1/subscription/documents/${quote._id}/accept`).send({ name: 'Fatuma Admin', title: 'Administrator', confirm: true });
    expect(acc.status).toBe(200);
    expect(acc.body.data.document.acceptance).toMatchObject({ byName: 'Fatuma Admin', byEmail: `admin@${S}.test` });
    const inv = (await t(S, admin).get(`/api/v1/subscription/documents/${acc.body.data.invoiceId}`)).body.data;
    expect(inv).toMatchObject({ type: 'invoice', status: 'issued', total: 32480 });
    expect((await t(S, admin).post('/api/v1/subscription/quote').send({ planKey: 'trial', billingCycle: 'monthly' })).body.error.code).toBe('PRICE_ON_REQUEST');
  });

  it('issues an agreement from the template, which the facility accepts electronically', async () => {
    const c = await own('post', '/billing/documents').send({ type: 'contract', tenantId: F.id, contract: { planKey: 'standard', billingCycle: 'annual', amount: 120000, startDate: '2026-10-01', termMonths: 12, specialTerms: 'Two free training sessions in the first month.' } });
    expect(c.status).toBe(201);
    expect(c.body.data.number).toMatch(/^AGR-/);
    const preview = (await own('get', `/billing/documents/${c.body.data._id}`)).body.data.contractPreview;
    expect(preview).toContain(`${S} Hospital`);
    expect(preview).toContain('KES 120,000.00');
    const issued = (await own('post', `/billing/documents/${c.body.data._id}/issue`)).body.data;
    expect(issued.contract.body).toContain('Data Protection Act, 2019');
    const acc = await t(S, admin).post(`/api/v1/subscription/documents/${issued._id}/accept`).send({ name: 'Fatuma Admin', title: 'Administrator', confirm: true });
    expect(acc.body.data.document.status).toBe('accepted');
    expect(acc.body.data.invoiceId).toBeNull();
    const pdf = await t(S, admin).get(`/api/v1/subscription/documents/${issued._id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('keeps each facility to its own documents', async () => {
    expect((await t(S2, admin2).get(`/api/v1/subscription/documents/${invoiceId}`)).status).toBe(404);
    expect((await t(S2, admin2).get('/api/v1/subscription/documents')).body.data).toHaveLength(0);
    expect((await t(S2, admin2).post(`/api/v1/subscription/documents/${invoiceId}/pay`).send({ phone: '0712345678' })).status).toBe(404);
  });

  it('voids only unpaid documents', async () => {
    expect((await own('post', `/billing/documents/${invoiceId}/void`).send({ reason: 'Issued in error' })).body.error.code).toBe('INVALID_TRANSITION');
    const list = await own('get', '/billing/documents?type=invoice');
    expect(list.body.meta.openInvoices).toBe(list.body.data.filter((d: { status: string }) => ['issued', 'partially_paid'].includes(d.status)).length);
    expect(list.body.meta.openInvoices).toBeGreaterThan(0);
    const d = await own('post', '/billing/documents').send({ type: 'quotation', customer: { name: 'Prospect Clinic', email: 'hello@prospect.test' }, lines: [{ description: 'Basic plan', quantity: 1, unitPrice: 5000 }] });
    expect(d.body.data.tenantId).toBeUndefined();
    expect((await own('post', `/billing/documents/${d.body.data._id}/void`).send({ reason: 'Customer changed plans' })).body.data.status).toBe('void');
  });
});

describe('audit', () => {
  it('records owner billing actions', async () => {
    const actions = (await meta().PlatformAuditLog.find({ action: /^billing\./ }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['billing.settings', 'billing.signature_uploaded', 'billing.invoice_issue', 'billing.payment_recorded']));
  });
});
