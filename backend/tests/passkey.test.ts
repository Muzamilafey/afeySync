import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { api, createFacility, createUser, hostOf, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';

/**
 * A minimal software authenticator (ES256, "none" attestation) so the real WebAuthn verification
 * code runs end to end: registration, sign-in, counter checks, origin binding and removal.
 */
const S = 'pkfac';
const S2 = 'pkother';
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

class SoftAuthenticator {
  keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  credId = crypto.randomBytes(32);
  counter = 0;
  constructor(public rpId: string) {}
  private cose() {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  }
  private authData(flags: number, attested: boolean) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const parts = [sha(this.rpId), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credId.length);
      parts.push(Buffer.alloc(16), len, this.credId, Buffer.from(this.cose()));
    }
    return Buffer.concat(parts);
  }
  register(challenge: string, origin: string) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(0x45, true)]]) as never);
    return { id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] } };
  }
  assert(challenge: string, origin: string, { uv = true, bumpCounter = true } = {}) {
    if (bumpCounter) this.counter += 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
    const authenticatorData = this.authData(uv ? 0x05 : 0x01, false);
    const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, sha(clientDataJSON)]), this.keys.privateKey);
    return { id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) } };
  }
}

const origin = `https://${hostOf(S)}`;
const login = (slug: string, email: string) => api().post('/api/v1/auth/login').set('Host', hostOf(slug)).send({ email, password: PASSWORD });
const pk = (slug: string, path: string, body: unknown, o = `https://${hostOf(slug)}`) => api().post(`/api/v1/auth/mfa${path}`).set('Host', hostOf(slug)).set('Origin', o).send(body as object);

let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let user: string;
const device = new SoftAuthenticator(hostOf(S));

beforeAll(async () => {
  await setupApp();
  const { ownerToken } = await import('./helpers');
  const owner = await ownerToken();
  F = await createFacility(owner, S);
  await createFacility(owner, S2);
  admin = (await tenantLogin(S, F.admin.email)).token;
  user = await createUser(S, admin, { email: 'pk@mfa.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: [F.branches[0].id] });
});
afterAll(teardown);

async function signInChallenge() {
  const l = await login(S, 'pk@mfa.test');
  expect(l.body.data.mfaRequired).toBe(true);
  expect(l.body.data.methods).toContain('passkey');
  const opts = await pk(S, '/challenge/passkey-options', { challengeToken: l.body.data.challengeToken });
  expect(opts.status).toBe(200);
  return { token: l.body.data.challengeToken as string, challenge: opts.body.data.challenge as string, allow: opts.body.data.allowCredentials as Array<{ id: string }> };
}

describe('passkeys (WebAuthn) as a second factor', () => {
  it('registers a passkey bound to this facility host with user verification required', async () => {
    const o = await t(S, user).post('/api/v1/auth/mfa/passkey/options').set('Origin', origin);
    expect(o.status).toBe(200);
    expect(o.body.data.options.rp.id).toBe(hostOf(S));
    expect(o.body.data.options.authenticatorSelection.userVerification).toBe('required');
    // a response for another site is rejected
    const bad = await t(S, user).post('/api/v1/auth/mfa/passkey/confirm').set('Origin', `https://${hostOf(S2)}`).send({ challengeToken: o.body.data.challengeToken, name: 'Laptop', response: device.register(o.body.data.options.challenge, `https://${hostOf(S2)}`) });
    expect(bad.body.error.code).toBe('ORIGIN_MISMATCH');

    const o2 = await t(S, user).post('/api/v1/auth/mfa/passkey/options').set('Origin', origin);
    const ok = await t(S, user).post('/api/v1/auth/mfa/passkey/confirm').set('Origin', origin).send({ challengeToken: o2.body.data.challengeToken, name: 'Laptop', response: device.register(o2.body.data.options.challenge, origin) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.recoveryCodes).toHaveLength(10);
    // the challenge is single-use
    const again = await t(S, user).post('/api/v1/auth/mfa/passkey/confirm').set('Origin', origin).send({ challengeToken: o2.body.data.challengeToken, name: 'Laptop', response: device.register(o2.body.data.options.challenge, origin) });
    expect(again.body.error.code).toBe('MFA_CHALLENGE_INVALID');

    const st = await t(S, user).get('/api/v1/auth/mfa');
    expect(st.body.data.enabled).toEqual(['passkey']);
    expect(st.body.data.passkeys).toEqual([expect.objectContaining({ name: 'Laptop', id: b64u(device.credId) })]);
    expect(JSON.stringify(st.body)).not.toMatch(/publicKey/);
  });

  it('signs in with the passkey', async () => {
    const c = await signInChallenge();
    expect(c.allow.map((a) => a.id)).toEqual([b64u(device.credId)]);
    const v = await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(c.challenge, origin) });
    expect(v.status).toBe(200);
    expect(v.body.data.accessToken).toBeTruthy();
    expect((await t(S, user).get('/api/v1/auth/mfa')).body.data.passkeys[0].lastUsedAt).toBeTruthy();
  });

  it('rejects a wrong challenge, a replayed counter, missing user verification and a foreign origin', async () => {
    let c = await signInChallenge();
    expect((await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(b64u(crypto.randomBytes(32)), origin) })).body.error.code).toBe('MFA_CODE_INVALID');
    // the WebAuthn challenge was consumed by the failed attempt; a fresh one is needed
    expect((await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(c.challenge, origin) })).body.error.code).toBe('MFA_CODE_INVALID');

    // replay the counter the server last accepted (1): a cloned authenticator is refused
    c = await signInChallenge();
    device.counter = 1;
    expect((await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(c.challenge, origin, { bumpCounter: false }) })).body.error.code).toBe('MFA_CODE_INVALID');
    device.counter = 10;

    c = await signInChallenge();
    expect((await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(c.challenge, origin, { uv: false }) })).body.error.code).toBe('MFA_CODE_INVALID');

    c = await signInChallenge();
    const foreign = `https://${hostOf(S2)}`;
    expect((await pk(S, '/challenge/verify', { challengeToken: c.token, method: 'passkey', assertion: device.assert(c.challenge, foreign) }, foreign)).body.error.code).toBe('ORIGIN_MISMATCH');
  });

  it('removes a passkey only with the password', async () => {
    const id = b64u(device.credId);
    expect((await t(S, user).post('/api/v1/auth/mfa/passkey/remove').send({ id, password: 'wrong' })).body.error.code).toBe('INVALID_CREDENTIALS');
    const r = await t(S, user).post('/api/v1/auth/mfa/passkey/remove').send({ id, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.data.enabled).toEqual([]);
    expect((await login(S, 'pk@mfa.test')).body.data.accessToken).toBeTruthy();
  });
});
