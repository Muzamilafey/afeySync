import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { backfillUserDirectory } from '../src/modules/auth/directory';

const APEX = 'afeysync.test';
const A = 'mainfac';
const B = 'mainother';
const EMAIL = 'nurse.joy@main.test';
const find = (body: Record<string, string>, host = APEX) => api().post('/api/v1/auth/find-facility').set('Host', host).set('Origin', `http://${host}:3000`).send(body);
const tokenOf = (url: string) => new URL(url).hash.replace('#handoff=', '');

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const fa = await createFacility(owner, A);
  const fb = await createFacility(owner, B);
  // the same person works at two facilities
  await createUser(A, (await tenantLogin(A, fa.admin.email)).token, { email: EMAIL, roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
  await createUser(B, (await tenantLogin(B, fb.admin.email)).token, { email: EMAIL, roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
});
afterAll(teardown);

describe('sign-in on the main domain', () => {
  it('tells the sign-in page what kind of address it is on', async () => {
    expect((await api().get('/api/v1/auth/context').set('Host', APEX)).body.data).toEqual({ kind: 'platform' });
    expect((await api().get('/api/v1/auth/context').set('Host', OWNER_HOST)).body.data).toEqual({ kind: 'owner' });
    expect((await api().get('/api/v1/auth/context').set('Host', hostOf(A))).body.data).toEqual({ kind: 'facility', facility: { name: `${A} Hospital`, slug: A } });
  });

  it('finds every facility where the email and password are valid, on the same scheme and port', async () => {
    const r = await find({ email: EMAIL.toUpperCase(), password: PASSWORD });
    expect(r.status).toBe(200);
    const slugs = r.body.data.facilities.map((f: { slug: string }) => f.slug).sort();
    expect(slugs).toEqual([A, B].sort());
    const a = r.body.data.facilities.find((f: { slug: string }) => f.slug === A);
    expect(a.url).toMatch(new RegExp(`^http://${A}\\.afeysync\\.test:3000/login#handoff=[A-Za-z0-9_-]{40,}$`));
  });

  it('gives the same answer for an unknown email and a wrong password, and only works on the main domain', async () => {
    const unknown = await find({ email: 'nobody@main.test', password: PASSWORD });
    const wrong = await find({ email: EMAIL, password: 'Wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error ? { ...unknown.body.error, requestId: wrong.body.error.requestId } : undefined);
    expect((await find({ email: EMAIL, password: PASSWORD }, hostOf(A))).body.error.code).toBe('NOT_PLATFORM_HOST');
  });

  it('exchanges a handoff once, only on its own facility, and continues the normal sign-in', async () => {
    const r = await find({ email: EMAIL, password: PASSWORD });
    const a = r.body.data.facilities.find((f: { slug: string }) => f.slug === A);
    const b = r.body.data.facilities.find((f: { slug: string }) => f.slug === B);
    // a token for facility A is useless on facility B
    expect((await api().post('/api/v1/auth/handoff').set('Host', hostOf(B)).send({ token: tokenOf(a.url) })).body.error.code).toBe('HANDOFF_INVALID');
    // (and it was consumed by that attempt)
    expect((await api().post('/api/v1/auth/handoff').set('Host', hostOf(A)).send({ token: tokenOf(a.url) })).body.error.code).toBe('HANDOFF_INVALID');
    const ok = await api().post('/api/v1/auth/handoff').set('Host', hostOf(B)).send({ token: tokenOf(b.url) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const me = await api().get('/api/v1/auth/me').set('Host', hostOf(B)).set('Authorization', `Bearer ${ok.body.data.accessToken}`);
    expect(me.body.data).toMatchObject({ user: { email: EMAIL }, tenant: { slug: B } });
    expect((await api().post('/api/v1/auth/handoff').set('Host', hostOf(B)).send({ token: tokenOf(b.url) })).body.error.code).toBe('HANDOFF_INVALID');
  });

  it('treats plain localhost as the main sign-in page in development and sends people to <slug>.localhost', async () => {
    expect((await api().get('/api/v1/auth/context').set('Host', 'localhost:3000')).body.data).toEqual({ kind: 'platform' });
    const r = await find({ email: EMAIL, password: PASSWORD }, 'localhost');
    expect(r.status).toBe(200);
    const a = r.body.data.facilities.find((f: { slug: string }) => f.slug === A);
    expect(a.url).toMatch(new RegExp(`^http://${A}\\.localhost:3000/login#handoff=`));
    const ok = await api().post('/api/v1/auth/handoff').set('Host', `${A}.localhost`).send({ token: tokenOf(a.url) });
    expect(ok.status).toBe(200);
  });

  it('applies the facility lockout to main-domain attempts', async () => {
    for (let i = 0; i < 5; i++) await find({ email: EMAIL, password: 'Wrong-password-1' });
    expect((await find({ email: EMAIL, password: PASSWORD })).body.error.code).toBe('ACCOUNT_LOCKED');
    expect((await api().post('/api/v1/auth/login').set('Host', hostOf(A)).send({ email: EMAIL, password: PASSWORD })).body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('stores only email hashes and can rebuild the directory', async () => {
    const rows = await meta().UserDirectory.find({}).lean();
    expect(JSON.stringify(rows)).not.toContain('@');
    await meta().UserDirectory.deleteMany({});
    await backfillUserDirectory();
    expect(await meta().UserDirectory.countDocuments({})).toBe(rows.length);
  });
});

describe('facility address resolution', () => {
  it('finds a facility by <slug>.<platform domain> and <slug>.localhost even when its saved address is stale', async () => {
    const t = await meta().Tenant.findOne({ slug: A }).lean();
    // simulate a facility created under another PLATFORM_DOMAIN
    await meta().TenantDomain.updateOne({ tenantId: t!._id, type: 'platform_subdomain' }, { hostname: `${A}.afeysync.com` });
    const { clearDomainCache } = await import('../src/middleware/tenantResolver');
    clearDomainCache();
    for (const host of [hostOf(A), `${A}.localhost`, `${A}.localhost:3000`]) {
      const r = await api().get('/api/v1/auth/context').set('Host', host);
      expect(r.body.data).toEqual({ kind: 'facility', facility: { name: `${A} Hospital`, slug: A } });
    }
    expect((await api().get('/api/v1/auth/context').set('Host', 'no-such-facility.localhost')).body.data.kind).toBe('unknown');
  });
});

describe('explaining an address that is not an active facility', () => {
  it('says when a registration is still waiting for approval', async () => {
    await meta().FacilityApplication.create({ reference: 'APP-TEST0001', tokenHash: 'x'.repeat(64), slug: 'pendingfac', status: 'submitted', facility: { name: 'Pending Clinic' }, admin: { email: 'p@pending.test' } });
    const r = await api().get('/api/v1/auth/context').set('Host', 'pendingfac.localhost:3000');
    expect(r.body.data.kind).toBe('unknown');
    expect(r.body.data.message).toMatch(/Pending Clinic is registered but waiting for approval/);
    const login = await api().post('/api/v1/auth/login').set('Host', 'pendingfac.localhost:3000').send({ email: 'p@pending.test', password: 'x' });
    expect(login.body.error).toMatchObject({ code: 'TENANT_NOT_RESOLVED', message: expect.stringMatching(/waiting for approval/) });
    expect((await api().get('/api/v1/auth/context').set('Host', 'nothing-here.localhost')).body.data.message).toMatch(/couldn't find a facility at nothing-here\.localhost/);
  });

});
