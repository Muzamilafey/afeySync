import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, teardown, tenantLogin } from './helpers';
import { authConfig } from '../src/config/env';
import { meta } from '../src/models/meta';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';
import { loadTenant } from '../src/modules/tenants/tenantLoader';

const A = 'ssofac';
const B = 'ssoother';
const ACCOUNTS = 'accounts.afeysync.test';
const UA = 'Mozilla/5.0 (Test Browser)';
const CSRF = { 'X-Requested-With': 'AfeySync', 'User-Agent': UA };
let owner = '';

const findFacility = (email: string, password = PASSWORD, host = ACCOUNTS, headers: Record<string, string> = CSRF) => api().post('/api/v1/auth/find-facility').set('Host', host).set(headers).send({ email, password });
const tokenOf = (url: string) => /#handoff=([A-Za-z0-9_-]+)$/.exec(url)![1];
const redeem = (slug: string, token: string, headers: Record<string, string> = CSRF) => api().post('/api/v1/auth/handoff').set('Host', hostOf(slug)).set(headers).send({ token });

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  await createFacility(owner, A);
  await createFacility(owner, B);
  authConfig.centralLogin = true;
});
afterAll(async () => {
  authConfig.centralLogin = false;
  await teardown();
});

describe('central sign-in on the accounts address', () => {
  it('refuses passwords on facility and main addresses, pointing to accounts', async () => {
    const direct = await api().post('/api/v1/auth/login').set('Host', hostOf(A)).send({ email: `admin@${A}.test`, password: PASSWORD });
    expect(direct.status).toBe(403);
    expect(direct.body.error).toMatchObject({ code: 'USE_ACCOUNTS_LOGIN' });
    expect(direct.body.error.message).toContain('accounts.afeysync.test');
    expect((await findFacility(`admin@${A}.test`, PASSWORD, hostOf(A))).body.error.code).toBe('USE_ACCOUNTS_LOGIN');
    expect((await findFacility(`admin@${A}.test`, PASSWORD, 'afeysync.test')).body.error.code).toBe('USE_ACCOUNTS_LOGIN');
    const ctx = await api().get('/api/v1/auth/context').set('Host', hostOf(A));
    expect(ctx.body.data).toMatchObject({ kind: 'facility', centralLogin: true });
    expect((await api().get('/api/v1/auth/context').set('Host', ACCOUNTS).query({ facility: A })).body.data).toMatchObject({ kind: 'accounts', facility: { slug: A } });
  });

  it('only answers requests from the app itself (CSRF header) and never reveals whether an email exists', async () => {
    expect((await findFacility(`admin@${A}.test`, PASSWORD, ACCOUNTS, { 'User-Agent': UA })).body.error.code).toBe('CSRF_REJECTED');
    const unknown = await findFacility('nobody@nowhere.test');
    const wrong = await findFacility(`admin@${A}.test`, 'Wrong-password-1');
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual({ ...unknown.body.error, requestId: wrong.body.error.requestId });
  });

  it('hands over once, for 60 seconds, to the same browser on the right facility only', async () => {
    const r = await findFacility(`admin@${A}.test`);
    expect(r.status).toBe(200);
    const url: string = r.body.data.facilities[0].url;
    expect(url).toMatch(new RegExp(`^https?://${A}\\.afeysync\\.test(:\\d+)?/login#handoff=`));
    const h = await meta().LoginHandoff.findOne({ facilitySlug: A }).sort({ createdAt: -1 }).lean();
    expect(h!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(JSON.stringify(h)).not.toContain(tokenOf(url)); // only the hash is stored

    // Wrong facility: refused, and the link is used up.
    expect((await redeem(B, tokenOf(url))).body.error.code).toBe('HANDOFF_INVALID');
    expect((await redeem(A, tokenOf(url))).body.error.code).toBe('HANDOFF_INVALID');

    // Another browser or another network: refused and used up.
    const t2 = tokenOf((await findFacility(`admin@${A}.test`)).body.data.facilities[0].url);
    expect((await redeem(A, t2, { ...CSRF, 'User-Agent': 'curl/8' })).body.error.code).toBe('HANDOFF_INVALID');
    expect((await redeem(A, t2)).body.error.code).toBe('HANDOFF_INVALID');
    const t3 = tokenOf((await findFacility(`admin@${A}.test`)).body.data.facilities[0].url);
    expect((await redeem(A, t3, { ...CSRF, 'X-Forwarded-For': '203.0.113.9' })).body.error.code).toBe('HANDOFF_INVALID');
    const rejected = await (await import('../src/modules/tenants/tenantLoader')).loadTenant((await meta().Tenant.findOne({ slug: A }).lean())!._id.toString());
    expect(await rejected.models.AuditLog.countDocuments({ action: 'auth.handoff_rejected' })).toBe(2);

    // Without the CSRF header the facility page's call is refused.
    const t4 = tokenOf((await findFacility(`admin@${A}.test`)).body.data.facilities[0].url);
    expect((await redeem(A, t4, { 'User-Agent': UA })).body.error.code).toBe('CSRF_REJECTED');

    // Expired.
    const t5 = tokenOf((await findFacility(`admin@${A}.test`)).body.data.facilities[0].url);
    await meta().LoginHandoff.updateMany({ facilitySlug: A, usedAt: null }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await redeem(A, t5)).body.error.code).toBe('HANDOFF_INVALID');

    // The real thing: a session on the facility's own address, cookie only for that host.
    const t6 = tokenOf((await findFacility(`admin@${A}.test`)).body.data.facilities[0].url);
    const ok = await redeem(A, t6);
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/afs_rt=.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect((await redeem(A, t6)).body.error.code).toBe('HANDOFF_INVALID'); // single use
    // The facility session does not work on another facility.
    const me = await api().get('/api/v1/auth/me').set('Host', hostOf(B)).set('Authorization', `Bearer ${ok.body.data.accessToken}`);
    expect([401, 403]).toContain(me.status);
  });

  it('sends password resets from the accounts address to each facility address', async () => {
    const r = await api().post('/api/v1/auth/forgot-password').set('Host', ACCOUNTS).set(CSRF).send({ email: `admin@${A}.test` });
    expect(r.status).toBe(200);
    const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.to': `admin@${A}.test`, 'payload.subject': /reset your AfeySync password/ }).sort({ createdAt: -1 }).lean();
    expect((job!.payload as { text: string }).text).toMatch(new RegExp(`https?://${A}\\.afeysync\\.test(:\\d+)?/reset-password\\?token=`));
  });

  it('keeps accounts, owner, app, identity, profile (and other system names) from ever being a facility: "already in use"', async () => {
    for (const slug of ['accounts', 'account', 'app', 'owner', 'identity', 'profile']) {
      const res = await api().post('/api/v1/owner/tenants').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ facility: { name: 'Sneaky', slug, county: 'Mandera' }, administrator: { name: 'Sneaky Admin', email: `x@${slug}.test`, password: PASSWORD }, branches: [{ branchName: 'Main', branchCode: 'MAIN' }], subscription: { plan: 'standard', maxBranches: 1, maxUsers: 5 } });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('This address is already in use. Please choose another.');
    }
  });
});

describe('two-step verification on the accounts address', () => {
  const tenantOf = async (slug: string) => loadTenant(String((await meta().Tenant.findOne({ slug }).lean())!._id));
  const emailCode = async (to: string) => {
    const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.to': to }).sort({ createdAt: -1, _id: -1 }).lean();
    return /(\d{6})/.exec(IntegrationSecretService.decrypt((job!.payload as { textEnc: string }).textEnc))![1];
  };
  const onAccounts = (path: string, body: object, headers: Record<string, string> = CSRF) => api().post(`/api/v1/auth/${path}`).set('Host', ACCOUNTS).set(headers).send(body);

  it('verifies on accounts, then the facility signs straight in without asking again', async () => {
    const t = await tenantOf(A);
    await t.models.User.updateOne({ email: `admin@${A}.test` }, { $set: { 'mfa.email.enabledAt': new Date() } });
    const r = await findFacility(`admin@${A}.test`);
    expect(r.body.data).toMatchObject({ mfaRequired: true, methods: ['email'], facility: { slug: A } });
    expect(r.body.data.facilities).toBeUndefined(); // no link before the second step
    const { challengeToken } = r.body.data;
    expect((await onAccounts('mfa/challenge/send', { challengeToken, method: 'email' })).status).toBe(200);
    expect((await onAccounts('mfa/challenge/verify', { challengeToken, method: 'email', code: '000000' })).status).toBe(401);
    const v = await onAccounts('mfa/challenge/verify', { challengeToken, method: 'email', code: await emailCode(`admin@${A}.test`) });
    expect(v.status).toBe(200);
    expect(v.body.data.accessToken).toBeUndefined(); // no session on the accounts address
    expect(String(v.headers['set-cookie'] ?? '')).not.toContain('afs_rt');
    const url: string = v.body.data.handoffUrl;
    expect(url).toMatch(new RegExp(`^https?://${A}\\.afeysync\\.test(:\\d+)?/login#handoff=`));
    const done = await redeem(A, tokenOf(url));
    expect(done.status).toBe(200);
    expect(done.body.data.mfaRequired).toBeUndefined();
    expect(done.body.data.accessToken).toBeTruthy();
    const s = await meta().Session.findOne({ tenantId: t.id }).sort({ createdAt: -1 }).lean();
    expect(s!.amr).toEqual(expect.arrayContaining(['password', 'email', 'accounts']));
    await t.models.User.updateOne({ email: `admin@${A}.test` }, { $unset: { 'mfa.email': 1 } });
  });

  it('lets someone at several facilities choose one first, with a single-use ticket for this browser', async () => {
    // The same person also works at facility B (B's administrator adds them).
    authConfig.centralLogin = false;
    const bAdmin = (await tenantLogin(B, `admin@${B}.test`)).token;
    await createUser(B, bAdmin, { email: `nurse@${A}.test`, roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    const aAdmin = (await tenantLogin(A, `admin@${A}.test`)).token;
    await createUser(A, aAdmin, { email: `nurse@${A}.test`, roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    authConfig.centralLogin = true;

    const r = await findFacility(`nurse@${A}.test`);
    expect(r.body.data.choices.map((c: { slug: string }) => c.slug).sort()).toEqual([A, B].sort());
    expect(JSON.stringify(r.body.data)).not.toContain('handoff'); // nothing usable until a choice is made
    const pickB = (x: typeof r) => x.body.data.choices.find((c: { slug: string }) => c.slug === B).ticket;
    // Another browser cannot use the ticket, and trying uses it up.
    const t1 = pickB(r);
    expect((await onAccounts('find-facility/select', { ticket: t1 }, { ...CSRF, 'User-Agent': 'curl/8' })).body.error.code).toBe('HANDOFF_INVALID');
    expect((await onAccounts('find-facility/select', { ticket: t1 })).body.error.code).toBe('HANDOFF_INVALID');
    const t2 = pickB(await findFacility(`nurse@${A}.test`));
    const sel = await onAccounts('find-facility/select', { ticket: t2 });
    expect(sel.body.data.facilities[0]).toMatchObject({ slug: B });
    expect((await redeem(B, tokenOf(sel.body.data.facilities[0].url))).body.data.accessToken).toBeTruthy();
    expect((await onAccounts('find-facility/select', { ticket: t2 })).body.error.code).toBe('HANDOFF_INVALID');
    // Arriving from facility A's page goes straight on to A.
    const direct = await onAccounts('find-facility', { email: `nurse@${A}.test`, password: PASSWORD, facility: A });
    expect(direct.body.data.facilities[0]).toMatchObject({ slug: A });
  });

  it('falls back to the facility for an older passkey that only works on the facility address', async () => {
    const t = await tenantOf(A);
    await t.models.User.updateOne({ email: `admin@${A}.test` }, { $set: { 'mfa.passkeys': [{ credentialId: 'legacy-cred', publicKey: 'x', counter: 0, name: 'Old laptop' }] } });
    const r = await findFacility(`admin@${A}.test`);
    expect(r.body.data.mfaRequired).toBeUndefined();
    const at = await redeem(A, tokenOf(r.body.data.facilities[0].url));
    expect(at.body.data).toMatchObject({ mfaRequired: true, methods: ['passkey'] });
    await t.models.User.updateOne({ email: `admin@${A}.test` }, { $unset: { 'mfa.passkeys': 1 } });
  });
});
