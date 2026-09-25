import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const A = 'newsfaca';
const B = 'newsfacb';
let owner = '';
let aId = '';
let tokA = '';
let tokB = '';
const own = (method: 'get' | 'post' | 'put' | 'delete', p: string) => api()[method](p).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  aId = (await createFacility(owner, A)).id;
  await createFacility(owner, B);
  tokA = (await tenantLogin(A, `admin@${A}.test`)).token;
  tokB = (await tenantLogin(B, `admin@${B}.test`)).token;
});
afterAll(teardown);

describe("What's new announcements", () => {
  let targetedId = '';

  it('shows published announcements to facilities, with an unread count', async () => {
    const draft = await own('post', '/api/v1/owner/announcements').send({ title: 'Not yet', body: 'draft' });
    expect(draft.status).toBe(201);
    const all = await own('post', '/api/v1/owner/announcements').send({ title: 'Inpatient improvements', body: '## New\n\n- Faster admissions', category: 'feature', status: 'published' });
    expect(all.status).toBe(201);
    const targeted = await own('post', '/api/v1/owner/announcements').send({ title: 'Maintenance for your facility', category: 'maintenance', audience: 'facilities', tenantIds: [aId], status: 'published' });
    targetedId = targeted.body.data.id;

    const listA = await t(A, tokA).get('/api/v1/announcements');
    expect(listA.status).toBe(200);
    expect(listA.body.data.map((x: { title: string }) => x.title).sort()).toEqual(['Inpatient improvements', 'Maintenance for your facility']);
    expect(listA.body.data.every((x: { unread: boolean }) => x.unread)).toBe(true);
    const listB = await t(B, tokB).get('/api/v1/announcements');
    expect(listB.body.data.map((x: { title: string }) => x.title)).toEqual(['Inpatient improvements']);
    expect((await t(A, tokA).get('/api/v1/announcements/unread-count')).body.data.unread).toBe(2);
  });

  it('clears the count once the user has looked, and counts new ones again', async () => {
    await t(A, tokA).post('/api/v1/announcements/seen');
    expect((await t(A, tokA).get('/api/v1/announcements/unread-count')).body.data.unread).toBe(0);
    // Other facilities keep their own count.
    expect((await t(B, tokB).get('/api/v1/announcements/unread-count')).body.data.unread).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    await own('post', '/api/v1/owner/announcements').send({ title: 'Price list import', status: 'published' });
    expect((await t(A, tokA).get('/api/v1/announcements/unread-count')).body.data.unread).toBe(1);
  });

  it('checks the audience and who may post', async () => {
    expect((await own('post', '/api/v1/owner/announcements').send({ title: 'Nobody chosen', audience: 'facilities', tenantIds: [] })).status).toBe(400);
    expect((await t(A, tokA).post('/api/v1/owner/announcements').send({ title: 'Sneaky post' })).status).toBeGreaterThanOrEqual(401);
    expect((await api().get('/api/v1/announcements').set('Host', `${A}.afeysync.test`)).status).toBe(401);
  });

  it('removes deleted announcements', async () => {
    expect((await own('delete', `/api/v1/owner/announcements/${targetedId}`)).status).toBe(200);
    const listA = await t(A, tokA).get('/api/v1/announcements');
    expect(listA.body.data.map((x: { title: string }) => x.title)).not.toContain('Maintenance for your facility');
  });
});
