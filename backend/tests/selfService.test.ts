import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, ownerToken, PASSWORD, setupApp, t, teardown } from './helpers';

const S = 'selffac';
let admin = '';

const login = (ua: string) => api().post('/api/v1/auth/login').set('Host', hostOf(S)).set('User-Agent', ua).send({ email: 'wakanda@selffac.test', password: PASSWORD });

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  await createFacility(owner, S);
  admin = (await api().post('/api/v1/auth/login').set('Host', hostOf(S)).send({ email: `admin@${S}.test`, password: PASSWORD })).body.data.accessToken;
  await createUser(S, admin, { email: 'wakanda@selffac.test', roleKey: 'receptionist', branchAccess: 'all', branchIds: [] });
});
afterAll(teardown);

describe('profile and security for every user', () => {
  it('shows a user their own profile and lets them change only their name and phone', async () => {
    const tok = (await login('Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36')).body.data.accessToken;
    const p = await t(S, tok).get('/api/v1/auth/profile');
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ email: 'wakanda@selffac.test', roles: [{ name: 'Receptionist', key: 'receptionist' }], branchAccess: 'all', facility: `${S} Hospital`, security: { twoStep: [], googleLinked: false } });
    expect(p.body.data.security.passwordChangedAt).toBeTruthy();
    const u = await t(S, tok).patch('/api/v1/auth/profile').send({ name: 'Wakanda Forever', phone: '+254 712 000 111', email: 'hijack@x.test', roleIds: ['x'] });
    expect(u.status).toBe(200);
    const after = (await t(S, tok).get('/api/v1/auth/profile')).body.data;
    expect(after).toMatchObject({ name: 'Wakanda Forever', phone: '+254 712 000 111', email: 'wakanda@selffac.test', roles: [{ key: 'receptionist' }] });
    expect((await t(S, tok).patch('/api/v1/auth/profile').send({ phone: 'call me' })).body.error.message).toMatch(/Phone: can only contain digits/);
  });

  it('lists signed-in devices, signs out one or all others, and shows recent activity', async () => {
    const a = (await login('Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36')).body.data.accessToken;
    const b = (await login('Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36')).body.data.accessToken;
    await api().post('/api/v1/auth/login').set('Host', hostOf(S)).send({ email: 'wakanda@selffac.test', password: 'Wrong-password-9' });
    const list = (await t(S, a).get('/api/v1/auth/sessions')).body.data as Array<{ id: string; current: boolean; device: string }>;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.map((s) => s.device)).toEqual(expect.arrayContaining(['Chrome on Windows', 'Chrome on Android']));
    const phone = (await t(S, b).get('/api/v1/auth/sessions')).body.data.find((s: { current: boolean }) => s.current);
    expect((await t(S, a).post(`/api/v1/auth/sessions/${phone.id}/revoke`)).status).toBe(200);
    expect((await t(S, b).get('/api/v1/auth/profile')).body.error.code).toBe('SESSION_REVOKED');
    const r = await t(S, a).post('/api/v1/auth/sessions/revoke-others');
    expect(r.body.data.signedOut).toBeGreaterThanOrEqual(1);
    const left = (await t(S, a).get('/api/v1/auth/sessions')).body.data;
    expect(left).toHaveLength(1);
    expect(left[0].current).toBe(true);
    const act = (await t(S, a).get('/api/v1/auth/activity')).body.data.map((x: { event: string }) => x.event);
    expect(act).toEqual(expect.arrayContaining(['Signed in', 'Failed sign-in attempt', 'Signed out a device', 'Signed out other devices', 'Profile updated']));
  });

  it('never exposes another user\'s sessions', async () => {
    const a = (await login('ua')).body.data.accessToken;
    const adminSessions = (await t(S, admin).get('/api/v1/auth/sessions')).body.data;
    expect((await t(S, a).post(`/api/v1/auth/sessions/${adminSessions[0].id}/revoke`)).status).toBe(404);
  });
});
