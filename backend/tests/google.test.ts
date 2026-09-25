import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { api, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';
import { clearGoogleCaches } from '../src/modules/auth/google/googleOidc';
import { totp, currentStep } from '../src/modules/auth/mfa/totp';

/* Test double for Google's OpenID Connect endpoints (tests only). Enforces PKCE like the real service. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const CLIENT_ID = 'afeysync-test.apps.googleusercontent.com';
type Grant = { sub: string; email: string; nonce: string; challenge: string; aud?: string; emailVerified?: boolean };
const grants = new Map<string, Grant>();
let base = '';
const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/.well-known/openid-configuration') return json(200, { issuer: 'https://accounts.google.com', authorization_endpoint: `${base}/auth`, token_endpoint: `${base}/token`, jwks_uri: `${base}/certs` });
    if (url.pathname === '/certs') return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
    if (url.pathname === '/token' && req.method === 'POST') {
      const f = new URLSearchParams(body);
      const g = grants.get(f.get('code') ?? '');
      if (!g || f.get('client_secret') !== 'google-secret') return json(400, { error: 'invalid_grant' });
      const verifierHash = crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (verifierHash !== g.challenge) return json(400, { error: 'invalid_grant' });
      grants.delete(f.get('code')!);
      const idToken = jwt.sign({ sub: g.sub, email: g.email, email_verified: g.emailVerified ?? true, nonce: g.nonce, name: 'Test User' }, privateKey, { algorithm: 'RS256', keyid: KID, issuer: 'https://accounts.google.com', audience: g.aud ?? CLIENT_ID, expiresIn: 300 });
      return json(200, { access_token: 'x', id_token: idToken, token_type: 'Bearer' });
    }
    json(404, {});
  });
});

const S = 'gfac';
const S2 = 'gother';
let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let doctor: string;

/** Starts a flow, lets "Google" approve it, and returns the completion code from the redirect. */
async function runFlow(start: () => Promise<{ status: number; body: { data: { url: string } } }>, identity: Partial<Grant> & { sub: string; email: string }, code = crypto.randomUUID()) {
  const s = await start();
  expect(s.status).toBe(200);
  const auth = new URL(s.body.data.url);
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(auth.searchParams.get('scope')).toBe('openid email profile');
  grants.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')!, ...identity });
  const cb = await api().get(`/api/v1/oauth/google/callback?code=${code}&state=${auth.searchParams.get('state')}`).set('Host', 'api.afeysync.test');
  expect(cb.status).toBe(303);
  return new URL(cb.headers.location);
}
const startLogin = (slug: string) => () => api().post('/api/v1/auth/google/start').set('Host', hostOf(slug)).send({ returnOrigin: `https://${hostOf(slug)}`, next: '/patients' });
const complete = (slug: string, code: string) => api().post('/api/v1/auth/google/complete').set('Host', hostOf(slug)).send({ code });

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setupApp();
  owner = await ownerToken();
  F = await createFacility(owner, S);
  await createFacility(owner, S2);
  admin = (await tenantLogin(S, F.admin.email)).token;
  doctor = await createUser(S, admin, { email: 'doc@g.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: [F.branches[0].id] });
});
afterAll(async () => {
  server.close();
  await teardown();
});

describe('Sign in with Google', () => {
  it('is off until the platform owner configures it', async () => {
    expect((await api().get('/api/v1/auth/google/status').set('Host', hostOf(S))).body.data.enabled).toBe(false);
    expect((await startLogin(S)()).status).toBe(403);
    const cfg = await api().put('/api/v1/owner/integrations/google').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ environment: 'production', enabled: true, settings: { clientId: CLIENT_ID, discoveryUrl: `${base}/.well-known/openid-configuration`, redirectUri: 'https://api.afeysync.test/api/v1/oauth/google/callback' }, secrets: { clientSecret: 'google-secret' } });
    expect(cfg.status).toBe(200);
    clearGoogleCaches();
    expect((await api().get('/api/v1/auth/google/status').set('Host', hostOf(S))).body.data.enabled).toBe(true);
    const test = await api().post('/api/v1/owner/integrations/google/test').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({});
    expect(test.body.data.success ?? test.body.success).toBeTruthy();
  });

  it('refuses to redirect to another host', async () => {
    const r = await api().post('/api/v1/auth/google/start').set('Host', hostOf(S)).send({ returnOrigin: 'https://evil.example.com' });
    expect(r.body.error.code).toBe('ORIGIN_MISMATCH');
  });

  it('does not sign in Google accounts that are not linked (no auto-linking by email)', async () => {
    const back = await runFlow(startLogin(S), { sub: 'g-doc', email: 'doc@g.test' });
    expect(back.origin).toBe(`https://${hostOf(S)}`);
    expect(back.pathname).toBe('/google-complete');
    const r = await complete(S, back.searchParams.get('code')!);
    expect(r.body.error.code).toBe('GOOGLE_NOT_LINKED');
  });

  it('links a Google account from a signed-in session and then signs in with it', async () => {
    const back = await runFlow(() => t(S, doctor).post('/api/v1/auth/google/link').send({ returnOrigin: `https://${hostOf(S)}` }), { sub: 'g-doc', email: 'dr.personal@gmail.com' });
    const linked = await complete(S, back.searchParams.get('code')!);
    expect(linked.body.data).toEqual(expect.objectContaining({ linked: true, googleEmail: 'dr.personal@gmail.com' }));
    const back2 = await runFlow(startLogin(S), { sub: 'g-doc', email: 'dr.personal@gmail.com' });
    const code = back2.searchParams.get('code')!;
    const r = await complete(S, code);
    expect(r.status).toBe(200);
    expect(r.body.data.accessToken).toBeTruthy();
    expect(r.body.data.next).toBe('/patients');
    expect(r.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    // completion codes are single use and bound to the facility that started the flow
    expect((await complete(S, code)).body.error.code).toBe('GOOGLE_STATE_INVALID');
    const back3 = await runFlow(startLogin(S), { sub: 'g-doc', email: 'dr.personal@gmail.com' });
    expect((await complete(S2, back3.searchParams.get('code')!)).body.error.code).toBe('GOOGLE_STATE_INVALID');
    const audit = await t(S, admin).get('/api/v1/admin/audit?action=auth.google_linked');
    expect(audit.body.data).toHaveLength(1);
  });

  it('still requires the second factor after Google sign-in', async () => {
    const setup = await t(S, doctor).post('/api/v1/auth/mfa/totp/setup');
    await t(S, doctor).post('/api/v1/auth/mfa/totp/confirm').send({ code: totp(setup.body.data.secret) });
    const back = await runFlow(startLogin(S), { sub: 'g-doc', email: 'dr.personal@gmail.com' });
    const r = await complete(S, back.searchParams.get('code')!);
    expect(r.body.data.mfaRequired).toBe(true);
    expect(r.body.data.accessToken).toBeUndefined();
    const v = await api().post('/api/v1/auth/mfa/challenge/verify').set('Host', hostOf(S)).send({ challengeToken: r.body.data.challengeToken, method: 'totp', code: totp(setup.body.data.secret, currentStep() + 1) });
    expect(v.body.data.accessToken).toBeTruthy();
  });

  it('rejects tokens with the wrong audience, a replayed nonce or an unverified email', async () => {
    const wrongAud = await runFlow(startLogin(S), { sub: 'g-doc', email: 'x@gmail.com', aud: 'someone-else' });
    expect(wrongAud.searchParams.get('error')).toBe('GOOGLE_TOKEN_INVALID');
    const unverified = await runFlow(startLogin(S), { sub: 'g-doc', email: 'x@gmail.com', emailVerified: false });
    expect(unverified.searchParams.get('error')).toBe('GOOGLE_EMAIL_UNVERIFIED');
    const nonce = await runFlow(startLogin(S), { sub: 'g-doc', email: 'x@gmail.com', nonce: 'forged' });
    expect(nonce.searchParams.get('error')).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('facility admins can turn Google sign-in off', async () => {
    expect((await t(S, admin).put('/api/v1/admin/security/google-login').send({ enabled: false })).status).toBe(200);
    expect((await startLogin(S)()).body.error.code).toBe('GOOGLE_DISABLED');
    await t(S, admin).put('/api/v1/admin/security/google-login').send({ enabled: true });
  });

  it('unlinking requires the password', async () => {
    expect((await t(S, doctor).post('/api/v1/auth/google/unlink').send({ password: 'nope' })).status).toBe(401);
    expect((await t(S, doctor).post('/api/v1/auth/google/unlink').send({ password: PASSWORD })).status).toBe(200);
    expect((await t(S, doctor).get('/api/v1/auth/google/link')).body.data.linked).toBe(false);
  });

  it('works for the owner portal', async () => {
    const o = () => api().post('/api/v1/owner/auth/google/link').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ returnOrigin: `https://${OWNER_HOST}` });
    const back = await runFlow(o, { sub: 'g-owner', email: 'owner@gmail.com' });
    expect(back.pathname).toBe('/owner/google-complete');
    expect((await api().post('/api/v1/owner/auth/google/complete').set('Host', OWNER_HOST).send({ code: back.searchParams.get('code') })).body.data.linked).toBe(true);
    const back2 = await runFlow(() => api().post('/api/v1/owner/auth/google/start').set('Host', OWNER_HOST).send({ returnOrigin: `https://${OWNER_HOST}` }), { sub: 'g-owner', email: 'owner@gmail.com' });
    // an owner completion code cannot be redeemed on a facility host
    expect((await complete(S, back2.searchParams.get('code')!)).status).toBe(401);
  });
});
