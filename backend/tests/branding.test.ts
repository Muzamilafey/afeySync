import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const A = 'brandfac';
const B = 'brandother';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let owner = '';
let admin = '';
let tenantA = '';
const context = (slug: string) => api().get('/api/v1/auth/context').set('Host', hostOf(slug));

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  tenantA = (await createFacility(owner, A)).id;
  await createFacility(owner, B);
  admin = (await tenantLogin(A, `admin@${A}.test`)).token;
});
afterAll(teardown);

describe('facility branding', () => {
  it('starts with the facility name and no logo', async () => {
    expect((await context(A)).body.data.branding).toEqual({ name: `${A} Hospital`, legalName: `${A} Hospital`, tagline: null, welcomeMessage: null, primaryColor: null, logoUrl: null });
  });

  it('lets the facility admin set its name, tagline, message and colour, shown on its own address only', async () => {
    const r = await t(A, admin).put('/api/v1/admin/branding').send({ displayName: 'Brand Care', tagline: 'Caring for Mandera', welcomeMessage: 'Welcome back', primaryColor: '#1D4ED8' });
    expect(r.status).toBe(200);
    const b = (await context(A)).body.data.branding;
    expect(b).toMatchObject({ name: 'Brand Care', tagline: 'Caring for Mandera', welcomeMessage: 'Welcome back', primaryColor: '#1d4ed8' });
    expect((await context(B)).body.data.branding.name).toBe(`${B} Hospital`);
    // an empty value goes back to the default
    await t(A, admin).put('/api/v1/admin/branding').send({ welcomeMessage: '' });
    expect((await context(A)).body.data.branding.welcomeMessage).toBeNull();
  });

  it('refuses colours too light for white text and invalid colours', async () => {
    const light = await t(A, admin).put('/api/v1/admin/branding').send({ primaryColor: '#fde68a' });
    expect(light.status).toBe(400);
    expect(JSON.stringify(light.body)).toMatch(/too light/);
    expect((await t(A, admin).put('/api/v1/admin/branding').send({ primaryColor: 'red' })).status).toBe(400);
  });

  it('accepts only PNG/JPEG logos and serves them on the facility address only', async () => {
    expect((await t(A, admin).put('/api/v1/admin/branding/logo').send({ dataBase64: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') })).status).toBe(415);
    const up = await t(A, admin).put('/api/v1/admin/branding/logo').send({ dataBase64: `data:image/png;base64,${PNG}` });
    expect(up.status).toBe(200);
    expect(up.body.data.logoUrl).toMatch(/^\/api\/v1\/auth\/branding\/logo\?v=[0-9a-f]{16}$/);
    const img = await api().get(up.body.data.logoUrl).set('Host', hostOf(A));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect((await api().get('/api/v1/auth/branding/logo').set('Host', hostOf(B))).status).toBe(404);
    expect((await t(A, admin).del('/api/v1/admin/branding/logo')).body.data.logoUrl).toBeNull();
    expect((await api().get('/api/v1/auth/branding/logo').set('Host', hostOf(A))).status).toBe(404);
  });

  it('is limited to users who manage settings', async () => {
    const nurse = await createUser(A, admin, { email: 'nurse@brandfac.test', roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    expect((await t(A, nurse).put('/api/v1/admin/branding').send({ displayName: 'Hacked' })).status).toBe(403);
    expect((await t(A, nurse).put('/api/v1/admin/branding/logo').send({ dataBase64: PNG })).status).toBe(403);
  });

  it('lets the owner brand a facility on its behalf', async () => {
    const own = (m: 'put' | 'get', url: string) => api()[m](`/api/v1/owner${url}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect((await own('put', `/tenants/${tenantA}/branding`).send({ tagline: 'Set by AfeySync' })).status).toBe(200);
    expect((await own('put', `/tenants/${tenantA}/branding/logo`).send({ dataBase64: PNG })).body.data.logoUrl).toBeTruthy();
    expect((await context(A)).body.data.branding.tagline).toBe('Set by AfeySync');
    expect((await own('get', '/tenants/000000000000000000000000/branding')).status).toBe(404);
  });
});
