import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, OWNER_HOST, ownerToken, setupApp, teardown } from './helpers';
import { meta } from '../src/models/meta';
import { enqueueJob, runNextJob } from '../src/jobs/queue';
import { registerJobHandlers } from '../src/jobs/handlers';
import { resolveSmsGateway } from '../src/integrations/sms/gateway';
import { talksasaNumber } from '../src/integrations/talksasa/smsService';

/* A local stand-in for the documented Talksasa API v3, used only by these tests. */
const sent: Array<{ auth?: string; body: Record<string, string> }> = [];
let server: http.Server;
let baseUrl = '';

let owner = '';
let tenantId = '';
const S = 'smsfac';
const own = (m: 'get' | 'put' | 'post', url: string) => api()[m](`/api/v1/owner${url}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);

async function runUntilDone(jobId: unknown) {
  for (let i = 0; i < 300; i++) {
    const j = await meta().Job.findById(jobId).lean();
    if (j && j.status !== 'queued' && j.status !== 'running') return j;
    if (!(await runNextJob())) break;
  }
  return meta().Job.findById(jobId).lean();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const json = (code: number, b: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (req.headers.authorization !== 'Bearer tok-good') return json(401, { status: 'error', message: 'Unauthenticated.' });
      if (req.method === 'GET' && req.url === '/api/v3/balance') return json(200, { status: 'success', data: { remaining_unit: 420 } });
      if (req.method === 'POST' && req.url === '/api/v3/sms/send') {
        const body = JSON.parse(raw || '{}');
        sent.push({ auth: req.headers.authorization, body });
        // Talksasa reports some failures in the body with HTTP 200.
        if (body.sender_id === 'NOTAPPROVED') return json(200, { status: 'error', message: 'Sender ID is not approved' });
        return json(200, { status: 'success', data: { uid: `uid-${sent.length}`, status: 'Delivered' } });
      }
      json(404, { status: 'error', message: 'Not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v3`;
  await setupApp();
  registerJobHandlers();
  owner = await ownerToken();
  tenantId = (await createFacility(owner, S)).id;
});
afterAll(async () => {
  await teardown();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('Talksasa SMS gateway', () => {
  it('formats Kenyan numbers the way Talksasa expects', () => {
    expect(talksasaNumber('0712345678')).toBe('254712345678');
    expect(talksasaNumber('+254 712-345-678')).toBe('254712345678');
    expect(talksasaNumber('0110345678')).toBe('254110345678');
    expect(talksasaNumber('31612345678')).toBe('31612345678');
  });

  it('is configured by the owner, never exposes the token, and tests the connection with the balance', async () => {
    const bad = await own('put', '/integrations/talksasa').send({ enabled: true, environment: 'production', settings: { baseUrl, senderId: 'AFEYSYNC' }, secrets: { apiToken: 'tok-wrong' } });
    expect(bad.status).toBe(200);
    const failed = await own('post', '/integrations/talksasa/test').send({});
    expect(failed.body.data.ok).toBe(false);
    expect(failed.body.data.error.code).toBe('SMS_AUTH_ERROR');

    await own('put', '/integrations/talksasa').send({ secrets: { apiToken: 'tok-good' } });
    const ok = await own('post', '/integrations/talksasa/test').send({});
    expect(ok.body.data.ok).toBe(true);
    expect(ok.body.data.balance).toEqual({ remaining_unit: 420 });
    const list = await own('get', '/integrations');
    expect(JSON.stringify(list.body)).not.toContain('tok-good');

    const sms = await own('post', '/integrations/talksasa/test').send({ kind: 'sms', to: '0712000111' });
    expect(sms.body.data.ok).toBe(true);
    expect(sent.at(-1)!.body).toEqual({ recipient: '254712000111', sender_id: 'AFEYSYNC', type: 'plain', message: 'AfeySync test message: your Talksasa SMS gateway works.' });
    expect((await own('post', '/integrations/talksasa/test').send({ kind: 'sms', to: 'not-a-phone' })).status).toBe(400);
  });

  it('sends facility SMS through Talksasa when it is the gateway available to the facility', async () => {
    expect((await own('put', `/tenants/${tenantId}/integrations`).send({ talksasa: true, africastalking: false })).body.data.talksasa).toBe(true);
    expect((await resolveSmsGateway(tenantId)).gateway).toBe('talksasa');
    const before = sent.length;
    const job = await enqueueJob('SMS', `talksasa-test-${Date.now()}`, { to: '0712000222', message: 'Your appointment is tomorrow at 9:00' }, tenantId);
    const done = await runUntilDone(job.id);
    expect(done?.status).toBe('completed');
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ auth: 'Bearer tok-good', body: { recipient: '254712000222', sender_id: 'AFEYSYNC', type: 'plain', message: 'Your appointment is tomorrow at 9:00' } });
  });

  it('follows the facility choice, and says so when the chosen gateway is not available', async () => {
    await own('put', '/integrations/africastalking').send({ enabled: true, environment: 'sandbox', settings: { username: 'sandbox' }, secrets: { apiKey: 'at-key' } });
    await own('put', `/tenants/${tenantId}/integrations`).send({ africastalking: true });
    expect((await resolveSmsGateway(tenantId)).gateway).toBe('africastalking'); // auto prefers Africa's Talking
    expect((await own('put', `/tenants/${tenantId}/integrations`).send({ smsGateway: 'talksasa' })).body.data.smsGateway).toBe('talksasa');
    expect((await resolveSmsGateway(tenantId)).gateway).toBe('talksasa');
    // SMS needs no per-facility switch; only the owner turning the gateway off platform-wide stops it.
    await own('put', `/tenants/${tenantId}/integrations`).send({ talksasa: false });
    expect((await resolveSmsGateway(tenantId)).gateway).toBe('talksasa');
    await own('put', '/integrations/talksasa').send({ enabled: false });
    await expect(resolveSmsGateway(tenantId)).rejects.toThrow(/Talksasa SMS is selected for this facility but is not available/);
    await own('put', '/integrations/talksasa').send({ enabled: true });
  });

  it('treats an error in the response body as a failure, never as sent', async () => {
    await own('put', '/integrations/talksasa').send({ settings: { baseUrl, senderId: 'NOTAPPROVED' } });
    const job = await enqueueJob('SMS', `talksasa-err-${Date.now()}`, { to: '0712000333', message: 'hello' }, tenantId, { maxAttempts: 1 });
    const done = await runUntilDone(job.id);
    expect(done?.status).not.toBe('completed');
    expect(done?.lastError).toMatch(/Sender ID is not approved/);
    await own('put', '/integrations/talksasa').send({ settings: { baseUrl, senderId: 'AFEYSYNC' } });
  });
});
