import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { runNextJob } from '../src/jobs/queue';
import { registerJobHandlers } from '../src/jobs/handlers';

/* A local stand-in for the documented Talksasa SMS API, used only by these tests. */
const sent: Array<Record<string, string>> = [];
let server: http.Server;
let owner = '';
let admin = '';
let reception = '';
let campaignId = '';
const S = 'campaignfac';
const own = (m: 'put', url: string) => api()[m](`/api/v1/owner${url}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
const audience = { kind: 'patients', gender: 'female' };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v3/sms/send') { sent.push(JSON.parse(raw)); return res.end(JSON.stringify({ status: 'success', data: { uid: `u${sent.length}` } })); }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  await setupApp();
  registerJobHandlers();
  owner = await ownerToken();
  await own('put', '/integrations/talksasa').send({ enabled: true, environment: 'production', settings: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v3`, senderId: 'AFEYSYNC' }, secrets: { apiToken: 'tok' } });
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  reception = await createUser(S, admin, { email: 'rec@campaign.test', roleKey: 'receptionist', branchAccess: 'all', branchIds: [] });
  const mk = (firstName: string, phone?: string, sms = true, gender = 'female') => t(S, admin).post('/api/v1/patients').send({ firstName, lastName: 'Test', gender, phone, consent: { sms } });
  await mk('Amina', '0712000001');
  await mk('Beatrice', '0712000002');
  await mk('Carol', '0712000003', false);
  await mk('Dorcas');
  await mk('Evans', '0712000005', true, 'male');
});
afterAll(async () => {
  await teardown();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('bulk SMS campaigns', () => {
  it('is only for staff allowed to send bulk SMS', async () => {
    expect((await t(S, reception).post('/api/v1/sms/campaigns/preview').send({ message: 'Hello', audience })).status).toBe(403);
  });

  it('previews the audience, leaving out patients who declined SMS or have no phone', async () => {
    const r = await t(S, admin).post('/api/v1/sms/campaigns/preview').send({ message: 'Hi {firstName}, free cancer screening this Saturday.', audience });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ recipientCount: 2, excluded: { noConsent: 1, noPhone: 1 }, segments: 1, credits: 2, enough: true });
    expect(r.body.data.sample).toMatch(/: Hi (Amina|Beatrice), free cancer screening/);
  });

  it('refuses a campaign the SMS wallet cannot pay for', async () => {
    const numbers = Array.from({ length: 30 }, (_, i) => `07130000${String(i).padStart(2, '0')}`);
    const r = await t(S, admin).post('/api/v1/sms/campaigns').send({ name: 'Too big', message: 'Clinic closed on Monday', audience: { kind: 'numbers', numbers } });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('INSUFFICIENT_SMS_CREDITS');
  });

  it('sends a personalised SMS to each recipient and reports delivery', async () => {
    const r = await t(S, admin).post('/api/v1/sms/campaigns').send({ name: 'Screening day', message: 'Hi {firstName}, free cancer screening this Saturday.', audience });
    expect(r.status).toBe(201);
    campaignId = r.body.data._id;
    for (let i = 0; i < 20 && (await runNextJob()); i++);
    const texts = sent.map((s) => JSON.stringify(s));
    expect(texts.some((x) => x.includes('Hi Amina, free cancer screening'))).toBe(true);
    expect(texts.some((x) => x.includes('Carol'))).toBe(false);
    const d = await t(S, admin).get(`/api/v1/sms/campaigns/${campaignId}`);
    expect(d.body.data.stats).toMatchObject({ sent: 2, pending: 0, failed: 0 });
    expect(d.body.data.recipients[0].phone).toMatch(/\*+\d{3}$/);
  });

  it('cancels messages scheduled for later', async () => {
    const r = await t(S, admin).post('/api/v1/sms/campaigns').send({ name: 'Reminder', message: 'Clinic open on Sunday', audience: { kind: 'numbers', numbers: ['0712000009', '0712000005'] }, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(r.body.data.status).toBe('scheduled');
    const c = await t(S, admin).post(`/api/v1/sms/campaigns/${r.body.data._id}/cancel`).send({});
    expect(c.body.data.stopped).toBe(2);
    const list = await t(S, admin).get('/api/v1/sms/campaigns');
    expect(list.body.data[0]).toMatchObject({ status: 'cancelled', stats: { cancelled: 2 } });
  });
});
