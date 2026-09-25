import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { currentStep, hotp, totp, verifyTotp, base32Encode } from '../src/modules/auth/mfa/totp';

const S = 'mfafac';
const S2 = 'mfaother';
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let totpSecret: string;
let recovery: string[];

const login = (slug: string, email: string, password = PASSWORD) => api().post('/api/v1/auth/login').set('Host', hostOf(slug)).send({ email, password });
const verify = (slug: string, body: Record<string, string>) => api().post('/api/v1/auth/mfa/challenge/verify').set('Host', hostOf(slug)).send(body);
async function lastCode(type: 'EMAIL' | 'SMS', to: string) {
  const job = await meta().Job.findOne({ type, 'payload.to': to }).sort({ createdAt: -1, _id: -1 }).lean();
  const p = job!.payload as { text?: string; message?: string };
  return /code: (\d{6})/.exec(p.text ?? p.message ?? '')![1];
}

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  F = await createFacility(owner, S);
  await createFacility(owner, S2);
  admin = (await tenantLogin(S, F.admin.email)).token;
});
afterAll(teardown);

describe('TOTP primitives', () => {
  it('matches the RFC 6238 SHA-1 test vector and tolerates one step of drift', () => {
    expect(hotp(Buffer.from('12345678901234567890'), 1, 8)).toBe('94287082'); // T = 59s
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = Date.now();
    expect(verifyTotp(secret, totp(secret, currentStep(now) - 1), -1, now)).toBe(currentStep(now) - 1);
    expect(verifyTotp(secret, totp(secret, currentStep(now) - 3), -1, now)).toBeNull();
    // replay protection: a step at or below the last accepted step is rejected
    expect(verifyTotp(secret, totp(secret, currentStep(now)), currentStep(now), now)).toBeNull();
  });
});

describe('authenticator app (TOTP)', () => {
  let user: string;
  it('enrolls with a confirmed code and returns one-time recovery codes', async () => {
    user = await createUser(S, admin, { email: 'doc@mfa.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: [F.branches[0].id] });
    const setup = await t(S, user).post('/api/v1/auth/mfa/totp/setup');
    expect(setup.status).toBe(200);
    totpSecret = setup.body.data.secret;
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\/.*secret=/);
    expect((await t(S, user).post('/api/v1/auth/mfa/totp/confirm').send({ code: '000000' })).status).toBe(400);
    const ok = await t(S, user).post('/api/v1/auth/mfa/totp/confirm').send({ code: totp(totpSecret) });
    expect(ok.status).toBe(200);
    recovery = ok.body.data.recoveryCodes;
    expect(recovery).toHaveLength(10);
    const st = await t(S, user).get('/api/v1/auth/mfa');
    expect(st.body.data.enabled).toEqual(['totp']);
    // secrets never leave the server
    const users = await t(S, admin).get('/api/v1/users?q=doc@mfa');
    expect(JSON.stringify(users.body)).not.toMatch(/ciphertext|recoveryCodes/);
  });

  it('requires the second factor at login and rejects wrong or replayed codes', async () => {
    const l = await login(S, 'doc@mfa.test');
    expect(l.body.data.mfaRequired).toBe(true);
    expect(l.body.data.accessToken).toBeUndefined();
    expect(l.body.data.methods).toEqual(['totp']);
    const token = l.body.data.challengeToken;
    const bad = await verify(S, { challengeToken: token, method: 'totp', code: '123456' });
    expect(bad.body.error.code).toBe('MFA_CODE_INVALID');
    const code = totp(totpSecret, currentStep() + 1);
    const good = await verify(S, { challengeToken: token, method: 'totp', code });
    expect(good.status).toBe(200);
    expect(good.body.data.accessToken).toBeTruthy();
    expect((await t(S, good.body.data.accessToken).get('/api/v1/auth/me')).status).toBe(200);
    // challenge is single-use; the same code cannot be replayed on a new challenge
    expect((await verify(S, { challengeToken: token, method: 'totp', code })).body.error.code).toBe('MFA_CHALLENGE_INVALID');
    const l2 = await login(S, 'doc@mfa.test');
    expect((await verify(S, { challengeToken: l2.body.data.challengeToken, method: 'totp', code })).body.error.code).toBe('MFA_CODE_INVALID');
  });

  it('locks the challenge after five wrong codes', async () => {
    const l = await login(S, 'doc@mfa.test');
    let last;
    for (let i = 0; i < 5; i++) last = await verify(S, { challengeToken: l.body.data.challengeToken, method: 'totp', code: '000000' });
    expect(last!.body.error.code).toBe('MFA_TOO_MANY_ATTEMPTS');
    expect((await verify(S, { challengeToken: l.body.data.challengeToken, method: 'totp', code: totp(totpSecret, currentStep() + 1) })).body.error.code).toBe('MFA_CHALLENGE_INVALID');
  });

  it('accepts a recovery code exactly once', async () => {
    const l = await login(S, 'doc@mfa.test');
    const r = await verify(S, { challengeToken: l.body.data.challengeToken, method: 'recovery', code: recovery[0].toUpperCase() });
    expect(r.status).toBe(200);
    const l2 = await login(S, 'doc@mfa.test');
    expect((await verify(S, { challengeToken: l2.body.data.challengeToken, method: 'recovery', code: recovery[0] })).status).toBe(401);
  });

  it('cannot use a challenge from another facility', async () => {
    const l = await login(S, 'doc@mfa.test');
    const r = await verify(S2, { challengeToken: l.body.data.challengeToken, method: 'totp', code: totp(totpSecret, currentStep() + 1) });
    expect(r.status).toBe(401);
  });
});

describe('email and SMS codes', () => {
  let nurse: string;
  it('enrolls email and SMS with a verification code', async () => {
    nurse = await createUser(S, admin, { email: 'nurse@mfa.test', roleKey: 'nurse', branchAccess: 'specific', branchIds: [F.branches[0].id] });
    const e = await t(S, nurse).post('/api/v1/auth/mfa/email/setup');
    expect(e.status).toBe(200);
    const ec = await lastCode('EMAIL', 'nurse@mfa.test');
    expect((await t(S, nurse).post('/api/v1/auth/mfa/email/confirm').send({ challengeToken: e.body.data.challengeToken, code: ec })).status).toBe(200);
    expect((await t(S, nurse).post('/api/v1/auth/mfa/sms/setup').send({ phone: '12345' })).status).toBe(400);
    const s = await t(S, nurse).post('/api/v1/auth/mfa/sms/setup').send({ phone: '0712 000 111' });
    expect(s.body.data.sentTo).toBe('*********111');
    const sc = await lastCode('SMS', '254712000111');
    const conf = await t(S, nurse).post('/api/v1/auth/mfa/sms/confirm').send({ challengeToken: s.body.data.challengeToken, code: sc });
    expect(conf.status).toBe(200);
    expect(conf.body.data.recoveryCodes).toBeUndefined(); // already issued with the first method
    expect((await t(S, nurse).get('/api/v1/auth/mfa')).body.data.enabled).toEqual(['email', 'sms']);
  });

  it('signs in with an SMS code', async () => {
    const l = await login(S, 'nurse@mfa.test');
    expect(l.body.data.methods).toEqual(['email', 'sms']);
    expect(l.body.data.phone).toBe('*********111');
    const send = await api().post('/api/v1/auth/mfa/challenge/send').set('Host', hostOf(S)).send({ challengeToken: l.body.data.challengeToken, method: 'sms' });
    expect(send.status).toBe(200);
    expect((await api().post('/api/v1/auth/mfa/challenge/send').set('Host', hostOf(S)).send({ challengeToken: l.body.data.challengeToken, method: 'sms' })).body.error.code).toBe('MFA_RESEND_TOO_SOON');
    const code = await lastCode('SMS', '254712000111');
    expect((await verify(S, { challengeToken: l.body.data.challengeToken, method: 'email', code })).status).toBe(401); // code bound to its method
    const l2 = await login(S, 'nurse@mfa.test');
    await api().post('/api/v1/auth/mfa/challenge/send').set('Host', hostOf(S)).send({ challengeToken: l2.body.data.challengeToken, method: 'email' });
    const ecode = await lastCode('EMAIL', 'nurse@mfa.test');
    const ok = await verify(S, { challengeToken: l2.body.data.challengeToken, method: 'email', code: ecode });
    expect(ok.body.data.accessToken).toBeTruthy();
    nurse = ok.body.data.accessToken;
  });

  it('removing a method needs the password', async () => {
    expect((await t(S, nurse).post('/api/v1/auth/mfa/sms/disable').send({ password: 'wrong' })).status).toBe(401);
    const r = await t(S, nurse).post('/api/v1/auth/mfa/sms/disable').send({ password: PASSWORD });
    expect(r.body.data.enabled).toEqual(['email']);
  });
});

describe('facility policy', () => {
  it('forces enrollment before any other API use when required', async () => {
    const setPolicy = await t(S, admin).put('/api/v1/admin/security/mfa-policy').send({ mode: 'all', methods: ['totp', 'email'] });
    expect(setPolicy.status).toBe(200);
    await createUser(S, admin, { email: 'rec@mfa.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [F.branches[0].id] }).catch(() => null);
    const l = await login(S, 'rec@mfa.test');
    expect(l.body.data.mfaEnrollmentRequired).toBe(true);
    const restricted = l.body.data.accessToken;
    expect((await t(S, restricted).get('/api/v1/patients')).body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect((await t(S, restricted).get('/api/v1/auth/me')).status).toBe(200);
    const st = await t(S, restricted).get('/api/v1/auth/mfa');
    expect(st.body.data.required).toBe(true);
    expect(st.body.data.available).toEqual(['totp', 'email']);
    expect((await t(S, restricted).post('/api/v1/auth/mfa/sms/setup').send({ phone: '0712000222' })).body.error.code).toBe('MFA_METHOD_NOT_ALLOWED');
    const setup = await t(S, restricted).post('/api/v1/auth/mfa/totp/setup');
    const conf = await t(S, restricted).post('/api/v1/auth/mfa/totp/confirm').send({ code: totp(setup.body.data.secret) });
    const full = conf.body.data.accessToken;
    expect(full).toBeTruthy();
    // a new account must still choose its own password before anything else
    expect((await t(S, full).get('/api/v1/patients')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await t(S, full).post('/api/v1/auth/change-password').send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}x` })).status).toBe(200);
    expect((await t(S, full).get('/api/v1/patients')).status).toBe(200);
    // the last method cannot be removed while policy requires MFA
    expect((await t(S, full).post('/api/v1/auth/mfa/totp/disable').send({ password: `${PASSWORD}x` })).body.error.code).toBe('MFA_REQUIRED_BY_POLICY');
  });

  it('admins can reset a user who lost their device', async () => {
    const users = await t(S, admin).get('/api/v1/users?q=rec@mfa');
    const id = users.body.data[0]._id;
    expect((await t(S, admin).post(`/api/v1/users/${id}/mfa/reset`).send({ reason: 'x' })).status).toBe(400);
    expect((await t(S, admin).post(`/api/v1/users/${id}/mfa/reset`).send({ reason: 'Lost phone, identity confirmed in person' })).status).toBe(200);
    const l = await login(S, 'rec@mfa.test', `${PASSWORD}x`);
    expect(l.body.data.mfaEnrollmentRequired).toBe(true);
    await t(S, admin).put('/api/v1/admin/security/mfa-policy').send({ mode: 'optional', methods: ['totp', 'email', 'sms'] });
  });
});

describe('owner portal', () => {
  it('supports authenticator-app MFA for platform users', async () => {
    const owner = await ownerToken();
    const o = (path: string) => api().post(`/api/v1/owner/auth${path}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    const setup = await o('/mfa/totp/setup');
    const secret = setup.body.data.secret;
    expect((await o('/mfa/totp/confirm').send({ code: totp(secret) })).status).toBe(200);
    expect((await o('/mfa/sms/setup').send({ phone: '0712000333' })).status).toBe(403);
    const l = await api().post('/api/v1/owner/auth/login').set('Host', OWNER_HOST).send({ email: 'owner@afeysync.test', password: PASSWORD });
    expect(l.body.data.mfaRequired).toBe(true);
    const v = await api().post('/api/v1/owner/auth/mfa/challenge/verify').set('Host', OWNER_HOST).send({ challengeToken: l.body.data.challengeToken, method: 'totp', code: totp(secret, currentStep() + 1) });
    expect(v.body.data.accessToken).toBeTruthy();
    // a platform challenge is useless on a facility host
    const l2 = await api().post('/api/v1/owner/auth/login').set('Host', OWNER_HOST).send({ email: 'owner@afeysync.test', password: PASSWORD });
    expect((await verify(S, { challengeToken: l2.body.data.challengeToken, method: 'totp', code: totp(secret, currentStep() + 1) })).status).toBe(401);
    await meta().PlatformUser.updateOne({ email: 'owner@afeysync.test' }, { $set: { mfa: {} } });
  });
});
