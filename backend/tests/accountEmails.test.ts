import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';

const S = 'welcomefac';
let admin = '';
let tenantId = '';
let receptionistRole = '';

const emailsTo = async (to: string) => (await meta().Job.find({ type: 'EMAIL', 'payload.to': to }).sort({ createdAt: 1 }).lean()).map((j) => j.payload as { subject: string; text: string; html?: string });
const tokenFrom = (text: string) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)![1];

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  tenantId = (await createFacility(owner, S)).id;
  admin = (await tenantLogin(S, `admin@${S}.test`)).token;
  receptionistRole = (await t(S, admin).get('/api/v1/roles')).body.data.find((r: { key: string }) => r.key === 'receptionist')._id;
  void OWNER_HOST;
});
afterAll(teardown);

const newUser = (email: string, extra: Record<string, unknown> = {}) =>
  t(S, admin).post('/api/v1/users').set('Origin', `http://${hostOf(S)}:3000`).send({ name: 'Amina Welcome', email, roleIds: [receptionistRole], branchAccess: 'all', branchIds: [], ...extra });

describe('new user onboarding', () => {
  it('emails the new user their sign-in address, email and a set-password link, never a password', async () => {
    const r = await newUser('amina@welcome.test');
    expect(r.status).toBe(201);
    expect(r.body.data.temporaryPassword).toBeTruthy();
    expect(['sent', 'email_not_configured']).toContain(r.body.data.welcomeEmail);
    const [mail] = await emailsTo('amina@welcome.test');
    expect(mail.subject).toBe(`Welcome to ${S} Hospital on AfeySync`);
    expect(mail.text).toContain(`Sign-in address: http://${hostOf(S)}:3000/login`);
    expect(mail.text).toContain('Your email (username): amina@welcome.test');
    expect(mail.text).toContain('Role: Receptionist');
    expect(mail.text).toMatch(/expires in 72 hours/);
    expect(mail.text).not.toContain(r.body.data.temporaryPassword);
    expect(mail.html).not.toContain(r.body.data.temporaryPassword);
    expect(mail.html).toContain('Choose your password');
  });

  it('forces a new user to choose a password before using anything else', async () => {
    const r = await newUser('baraka@welcome.test');
    const login = await api().post('/api/v1/auth/login').set('Host', hostOf(S)).send({ email: 'baraka@welcome.test', password: r.body.data.temporaryPassword });
    expect(login.body.data.mustChangePassword).toBe(true);
    const tok = login.body.data.accessToken;
    expect((await t(S, tok).get('/api/v1/patients')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await t(S, tok).get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(true);
    expect((await t(S, tok).post('/api/v1/auth/change-password').send({ currentPassword: r.body.data.temporaryPassword, newPassword: 'Baraka-Chose-1' })).status).toBe(200);
    expect((await t(S, tok).get('/api/v1/patients')).status).toBe(200);
    expect((await t(S, tok).get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(false);
  });

  it('lets the new user set their own password from the email link, once', async () => {
    await newUser('chebet@welcome.test');
    const token = tokenFrom((await emailsTo('chebet@welcome.test'))[0].text);
    const set = await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token, newPassword: 'Chebet-Chose-1' });
    expect(set.status).toBe(200);
    expect((await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token, newPassword: 'Chebet-Again-1' })).body.error.code).toBe('RESET_TOKEN_INVALID');
    const login = await api().post('/api/v1/auth/login').set('Host', hostOf(S)).send({ email: 'chebet@welcome.test', password: 'Chebet-Chose-1' });
    expect(login.body.data.mustChangePassword).toBe(false);
    expect((await t(S, login.body.data.accessToken).get('/api/v1/patients')).status).toBe(200);
    // the link only works on its own facility
    const other = await api().post('/api/v1/auth/reset-password').set('Host', 'mainfac.afeysync.test').send({ token, newPassword: 'Chebet-Chose-2' });
    expect(other.status).not.toBe(200);
  });

  it('emails the user when an administrator resets their password, and old links stop working', async () => {
    const created = await newUser('dalmas@welcome.test');
    const oldToken = tokenFrom((await emailsTo('dalmas@welcome.test'))[0].text);
    const reset = await t(S, admin).post(`/api/v1/users/${created.body.data.id}/reset-password`).set('Origin', `http://${hostOf(S)}:3000`);
    expect(reset.status).toBe(200);
    const mails = await emailsTo('dalmas@welcome.test');
    expect(mails[1].subject).toBe(`${S} Hospital: your password was reset`);
    expect(mails[1].text).not.toContain(reset.body.data.temporaryPassword);
    expect((await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token: oldToken, newPassword: 'Dalmas-Chose-1' })).body.error.code).toBe('RESET_TOKEN_INVALID');
    expect((await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token: tokenFrom(mails[1].text), newPassword: 'Dalmas-Chose-1' })).status).toBe(200);
  });

  it('welcomes the first administrator of a facility the owner creates', async () => {
    const mails = await emailsTo(`admin@${S}.test`);
    expect(mails[0].subject).toBe(`Welcome to ${S} Hospital on AfeySync`);
    expect(mails[0].text).toContain(`Sign-in address: http://${hostOf(S)}:3000/login`);
    expect(mails[0].text).not.toContain(PASSWORD);
    void tenantId;
  });
});
