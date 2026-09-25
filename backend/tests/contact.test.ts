import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, setupApp, teardown } from './helpers';
import { meta } from '../src/models/meta';

beforeAll(async () => { await setupApp(); });
afterAll(teardown);

const send = (body: Record<string, unknown>) => api().post('/api/v1/contact').set('Host', 'afeysync.test').send(body);
const valid = { name: 'Dr Wanjiku Mwangi', email: 'wanjiku@clinic.test', phone: '0722 000 000', facility: 'Uzima Clinic', topic: 'demo', message: 'We would like a demo for our clinic next week.' };

describe('website contact form', () => {
  it('emails the message to the platform inbox, never to the sender', async () => {
    const r = await send(valid);
    expect(r.status).toBe(202);
    const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.subject': /Website enquiry: Request a demo from Dr Wanjiku Mwangi/ }).lean();
    const payload = job!.payload as { to: string; text: string };
    expect(payload.to).toBe('inbox@afeysync.test');
    expect(payload.text).toContain('Email: wanjiku@clinic.test');
    expect(payload.text).toContain('Facility: Uzima Clinic');
    expect(await meta().Job.countDocuments({ type: 'EMAIL', 'payload.to': 'wanjiku@clinic.test' })).toBe(0);
  });

  it('rejects header injection and incomplete messages', async () => {
    expect((await send({ ...valid, name: 'Evil\r\nBcc: victim@x.test' })).status).toBe(400);
    expect((await send({ ...valid, message: 'hi' })).status).toBe(400);
    expect((await send({ ...valid, email: 'not-an-email' })).status).toBe(400);
    expect((await send({ ...valid, topic: 'hacking' })).status).toBe(400);
  });

  it('quietly drops messages that fill the hidden honeypot field', async () => {
    const before = await meta().Job.countDocuments({ type: 'EMAIL' });
    const r = await send({ ...valid, name: 'Spam Bot', website: 'http://spam.test' });
    expect(r.status).toBe(202);
    expect(await meta().Job.countDocuments({ type: 'EMAIL' })).toBe(before);
  });
});
