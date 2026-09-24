import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';

let owner: string;
let fac: Awaited<ReturnType<typeof createFacility>>;

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  fac = await createFacility(owner, 'authtest');
});
afterAll(teardown);

describe('authentication', () => {
  it('provisions facility with admin, roles and domain', async () => {
    expect(fac.branches).toHaveLength(1);
    const me = await t('authtest', (await tenantLogin('authtest', fac.admin.email)).token).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.tenant.slug).toBe('authtest');
    expect(me.body.data.permissions).toContain('admin.users');
    expect(me.body.data.permissions.some((p: string) => p.startsWith('owner.'))).toBe(false);
  });

  it('rejects login when tenant cannot be resolved from host', async () => {
    const res = await api().post('/api/v1/auth/login').set('Host', 'unknown.example.com').send({ email: fac.admin.email, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_NOT_RESOLVED');
  });

  it('rejects wrong password with a generic error and never leaks stack traces', async () => {
    const res = await api().post('/api/v1/auth/login').set('Host', hostOf('authtest')).send({ email: fac.admin.email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: expect.objectContaining({ code: 'INVALID_CREDENTIALS' }) });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { cookies } = await tenantLogin('authtest', fac.admin.email);
    const first = await api().post('/api/v1/auth/refresh').set('Host', hostOf('authtest')).set('X-Requested-With', 'AfeySync').set('Cookie', cookies);
    expect(first.status).toBe(200);
    const rotatedCookies = first.headers['set-cookie'] as unknown as string[];
    // Reusing the old token => reuse detected, family revoked
    const reuse = await api().post('/api/v1/auth/refresh').set('Host', hostOf('authtest')).set('X-Requested-With', 'AfeySync').set('Cookie', cookies);
    expect(reuse.status).toBe(401);
    const afterReuse = await api().post('/api/v1/auth/refresh').set('Host', hostOf('authtest')).set('X-Requested-With', 'AfeySync').set('Cookie', rotatedCookies);
    expect(afterReuse.status).toBe(401);
    // Access tokens from the revoked family stop working
    const me = await t('authtest', first.body.data.accessToken).get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });

  it('requires the CSRF header for refresh', async () => {
    const { cookies } = await tenantLogin('authtest', fac.admin.email);
    const res = await api().post('/api/v1/auth/refresh').set('Host', hostOf('authtest')).set('Cookie', cookies);
    expect(res.status).toBe(403);
  });

  it('logout revokes the session immediately', async () => {
    const { token } = await tenantLogin('authtest', fac.admin.email);
    expect((await t('authtest', token).post('/api/v1/auth/logout')).status).toBe(200);
    expect((await t('authtest', token).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('separates owner and facility portals', async () => {
    const { token } = await tenantLogin('authtest', fac.admin.email);
    const ownerWithTenantToken = await api().get('/api/v1/owner/dashboard').set('Host', OWNER_HOST).set('Authorization', `Bearer ${token}`);
    expect(ownerWithTenantToken.status).toBe(401);
    const tenantWithOwnerToken = await api().get('/api/v1/patients').set('Host', hostOf('authtest')).set('Authorization', `Bearer ${owner}`);
    expect(tenantWithOwnerToken.status).toBe(401);
    const ownerLoginOnTenantHost = await api().post('/api/v1/owner/auth/login').set('Host', hostOf('authtest')).send({ email: 'owner@afeysync.test', password: PASSWORD });
    expect(ownerLoginOnTenantHost.status).toBe(403);
  });

  it('suspended facilities cannot be used', async () => {
    const f = await createFacility(owner, 'suspendme');
    const { token } = await tenantLogin('suspendme', f.admin.email);
    const s = await api().post(`/api/v1/owner/tenants/${f.id}/suspend`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ reason: 'Non-payment test' });
    expect(s.status).toBe(200);
    const res = await t('suspendme', token).get('/api/v1/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SUSPENDED');
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i += 1) await api().post('/api/v1/auth/login').set('Host', hostOf('authtest')).send({ email: fac.admin.email, password: 'wrong' });
    const res = await api().post('/api/v1/auth/login').set('Host', hostOf('authtest')).send({ email: fac.admin.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});
