import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';

let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let tx: { _id: string; reference: string };
const S = 'cbfac';

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Cb', lastName: 'Patient', gender: 'male' });
  const r = await t(S, admin).post('/api/v1/sha/transactions').send({ kind: 'preauthorization', patientId: p.body.data._id, idempotencyKey: 'preauth-key-0001' });
  tx = r.body.data;
});
afterAll(teardown);

const pathOf = (url: string) => new URL(url).pathname;

describe('SHA status callbacks', () => {
  it('idempotent drafts: same key returns the same transaction', async () => {
    const p = await t(S, admin).get('/api/v1/patients/search?q=Cb');
    const r = await t(S, admin).post('/api/v1/sha/transactions').send({ kind: 'preauthorization', patientId: p.body.data[0]._id, idempotencyKey: 'preauth-key-0001' });
    expect(r.status).toBe(200);
    expect(r.body.data.reference).toBe(tx.reference);
  });

  it('rejects unknown endpoints', async () => {
    const res = await api().post('/api/v1/sha/callbacks/unknowntoken_unknowntoken_1234').send({ status: 'approved' });
    expect(res.status).toBe(404);
  });

  it('verifies HMAC signatures, dedupes, and updates the matched record', async () => {
    const secret = 'callback-shared-secret-123';
    const ep = await t(S, admin).post('/api/v1/sha/callback-endpoints').send({ hmacHeader: 'X-Signature', hmacSecret: secret });
    expect(ep.status).toBe(201);
    const url = pathOf(ep.body.data.url);
    const body = JSON.stringify({ event_id: 'evt-1', reference: tx.reference, status: 'Approved', approved_amount: 4500 });
    const bad = await api().post(url).set('Content-Type', 'application/json').set('X-Signature', 'deadbeef').send(body);
    expect(bad.status).toBe(401);
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const ok = await api().post(url).set('Content-Type', 'application/json').set('X-Signature', `sha256=${sig}`).send(body);
    expect(ok.status).toBe(200);
    const dup = await api().post(url).set('Content-Type', 'application/json').set('X-Signature', `sha256=${sig}`).send(body);
    expect(dup.body.duplicate).toBe(true);
    const updated = await t(S, admin).get(`/api/v1/sha/transactions/${tx._id}`);
    expect(updated.body.data.status).toBe('approved');
    expect(updated.body.data.amounts.approved).toBe(4500);
    const events = await t(S, admin).get('/api/v1/sha/callback-events');
    expect(events.body.data[0].processing.state).toBe('processed');
    const notes = await t(S, admin).get('/api/v1/notifications');
    expect(notes.body.meta.unread).toBeGreaterThan(0);
  });

  it('records unmatched events without touching data', async () => {
    const ep = await t(S, admin).post('/api/v1/sha/callback-endpoints').send({});
    const res = await api().post(pathOf(ep.body.data.url)).send({ reference: 'NOPE-1', status: 'Rejected' });
    expect(res.status).toBe(200);
    const events = await t(S, admin).get('/api/v1/sha/callback-events');
    expect(events.body.data.find((e: { externalReference: string }) => e.externalReference === 'NOPE-1').processing.state).toBe('unmatched');
  });
});

describe('IntegrationSecretService', () => {
  it('encrypts with AES-256-GCM and detects tampering', () => {
    const enc = IntegrationSecretService.encrypt('super-secret-value');
    expect(enc.ciphertext).not.toContain('super-secret');
    expect(IntegrationSecretService.decrypt(enc)).toBe('super-secret-value');
    const parts = enc.ciphertext.split(':');
    parts[4] = Buffer.from('tampered!').toString('base64');
    expect(() => IntegrationSecretService.decrypt(parts.join(':'))).toThrow();
    expect(IntegrationSecretService.mask(enc)).toEqual(expect.objectContaining({ configured: true, hint: '••••alue' }));
  });
});
