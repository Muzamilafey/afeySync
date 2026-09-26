import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, OWNER_HOST, ownerToken, setupApp, teardown } from './helpers';
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
    expect(await meta().ContactMessage.countDocuments({ name: 'Spam Bot' })).toBe(0);
  });
});

describe('owner portal messages inbox', () => {
  it('keeps every message for the owner, who can search it and mark it replied or archived', async () => {
    const owner = await ownerToken();
    const own = (method: 'get' | 'patch', path: string) => api()[method](`/api/v1/owner/contact-messages${path}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect((await api().get('/api/v1/owner/contact-messages').set('Host', OWNER_HOST)).status).toBe(401);
    const list = await own('get', '');
    const msg = list.body.data.find((m: { email: string }) => m.email === 'wanjiku@clinic.test');
    expect(msg).toMatchObject({ name: 'Dr Wanjiku Mwangi', facility: 'Uzima Clinic', topicLabel: 'Request a demo', status: 'new', emailed: true });
    expect(list.body.meta.unread).toBeGreaterThanOrEqual(1);
    expect((await own('get', '?q=uzima')).body.data).toHaveLength(1);
    expect((await own('get', '?q=nothing-matches')).body.data).toHaveLength(0);
    const r = await own('patch', `/${msg._id}`).send({ status: 'replied', note: 'Called back, demo on Friday' });
    expect(r.body.data).toMatchObject({ status: 'replied', note: 'Called back, demo on Friday' });
    expect(r.body.data.handledByName).toBeTruthy();
    expect((await own('get', '/unread')).body.data.unread).toBe(list.body.meta.unread - 1);
    await own('patch', `/${msg._id}`).send({ status: 'archived' });
    expect((await own('get', '')).body.data.some((m: { _id: string }) => m._id === msg._id)).toBe(false);
    expect((await own('get', '?status=archived')).body.data.some((m: { _id: string }) => m._id === msg._id)).toBe(true);
  });
});
