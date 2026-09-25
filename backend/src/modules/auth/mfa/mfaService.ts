import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { h } from '../../../utils/asyncHandler';
import { parse } from '../../../utils/validate';
import { AppError, badRequest, conflict, unauthorized } from '../../../utils/errors';
import { randomToken, sha256 } from '../../../utils/crypto';
import { meta } from '../../../models/meta';
import { IntegrationSecretService } from '../../integrations/secretService';
import { enqueueJob } from '../../../jobs/queue';
import { notifyEmail, enqueueSms } from '../../notifications/notify';
import { normalizePhone } from '../../patients/patientService';
import { verifyPassword } from '../password';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { MAX_PASSKEYS, plainPasskey, usablePasskeys, authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration, type StoredPasskey } from './passkey';

export type MfaMethod = 'totp' | 'email' | 'sms' | 'passkey';
export const ALL_METHODS: MfaMethod[] = ['totp', 'email', 'sms', 'passkey'];
export interface MfaPolicy { mode: 'optional' | 'admins' | 'all'; methods: MfaMethod[] }
export const DEFAULT_POLICY: MfaPolicy = { mode: 'optional', methods: ALL_METHODS };
export const policySchema = z.object({ mode: z.enum(['optional', 'admins', 'all']), methods: z.array(z.enum(['totp', 'email', 'sms', 'passkey'])).min(1) });

/** Fields hidden by default that MFA code paths need. */
export const MFA_SELECT = '+passwordHash +mfa.recoveryCodes +mfa.totp.secret +mfa.totp.pendingSecret';

const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const RESEND_SECONDS = 30;
const RECOVERY_CODES = 10;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Enc = { ciphertext?: string | null; keyId?: string | null } | null | undefined;
export interface MfaDoc {
  _id: unknown;
  email: string;
  name: string;
  phone?: string | null;
  passwordHash?: string;
  mfa?: {
    totp?: { secret?: Enc; pendingSecret?: Enc; confirmedAt?: Date | null; lastStep?: number | null } | null;
    email?: { enabledAt?: Date | null } | null;
    sms?: { enabledAt?: Date | null; phone?: string | null } | null;
    passkeys?: StoredPasskey[] | null;
    recoveryCodes?: Array<{ hash?: string | null; usedAt?: Date | null }>;
    preferred?: string | null;
  } | null;
  set(path: string, value: unknown): unknown;
  save(): Promise<unknown>;
}

export function enabledMethods(doc: MfaDoc): MfaMethod[] {
  const m = doc.mfa ?? {};
  const out: MfaMethod[] = [];
  if (m.totp?.confirmedAt && m.totp.secret?.ciphertext) out.push('totp');
  if (m.email?.enabledAt) out.push('email');
  if (m.sms?.enabledAt && m.sms.phone) out.push('sms');
  if ((m.passkeys ?? []).length) out.push('passkey');
  return out;
}

export const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_m, a: string, mid: string, b: string) => `${a}${'*'.repeat(Math.min(6, mid.length))}${b}`);
export const maskPhone = (p?: string | null) => (p ? `${'*'.repeat(Math.max(0, p.length - 3))}${p.slice(-3)}` : undefined);
const normCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

export function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, stored: codes.map((c) => ({ hash: sha256(`rc:${normCode(c)}`) })) };
}

/* ------------------------------------------------------------------ Challenges */
export async function createChallenge(input: { subjectType: 'tenant' | 'platform'; subjectId: string; tenantId?: string | null; purpose: 'login' | 'enroll_email' | 'enroll_sms' | 'enroll_passkey'; methods: string[]; ip?: string; userAgent?: string; via?: string }) {
  const token = randomToken(32);
  const challenge = await meta().MfaChallenge.create({ ...input, tenantId: input.tenantId ?? undefined, tokenHash: sha256(`mfa:${token}`), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  return { token, challenge };
}

export type Challenge = NonNullable<Awaited<ReturnType<ReturnType<typeof meta>['MfaChallenge']['findOne']>>>;

export async function findChallenge(token: string, purpose: string) {
  const ch = await meta().MfaChallenge.findOne({ tokenHash: sha256(`mfa:${token}`) });
  if (!ch || ch.purpose !== purpose || ch.consumedAt || ch.expiresAt < new Date() || ch.attempts >= MAX_ATTEMPTS) {
    throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
  }
  return ch;
}

async function registerFailure(ch: Challenge) {
  ch.attempts += 1;
  if (ch.attempts >= MAX_ATTEMPTS) ch.consumedAt = new Date();
  await ch.save();
  const left = MAX_ATTEMPTS - ch.attempts;
  throw new AppError(401, left > 0 ? 'MFA_CODE_INVALID' : 'MFA_TOO_MANY_ATTEMPTS', left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many incorrect codes. Start again.');
}

/** Sends a one-time code by email or SMS for a challenge. The code itself is never stored, only its hash. */
export async function deliverOtp(ch: Challenge, method: 'email' | 'sms', to: string, brand: string, tenantId: string | null) {
  const sends = ch.otp?.sends ?? 0;
  if (sends >= MAX_SENDS) throw new AppError(429, 'MFA_SEND_LIMIT', 'Too many codes requested. Start again later.');
  if (ch.otp?.sentAt && Date.now() - ch.otp.sentAt.getTime() < RESEND_SECONDS * 1000) throw new AppError(429, 'MFA_RESEND_TOO_SOON', `Wait ${RESEND_SECONDS} seconds before requesting another code.`);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  ch.set('otp', { method, hash: sha256(`${ch._id}:${code}`), sentAt: new Date(), sends: sends + 1, target: method === 'email' ? maskEmail(to) : maskPhone(to) });
  await ch.save();
  const key = `${tenantId ?? 'platform'}:mfa:${ch._id}:${sends + 1}`;
  const text = `${brand} verification code: ${code}. It expires in 10 minutes. Never share this code.`;
  // The code is never stored in plain text: queued messages are encrypted and wiped after sending.
  if (method === 'email') {
    await notifyEmail(
      tenantId,
      key,
      to,
      `Your ${brand} sign-in code`, // never the code itself: subjects are queued unencrypted
      `Use the code below to complete your sign-in.\n\n${text}\n\nIf you did not try to sign in, change your password and contact your administrator.`,
      undefined,
      { sensitive: true, code: { value: code, expires: '10 minutes' }, title: `Your ${brand} sign-in code`, intro: 'Use the code below to complete your sign-in.', notice: "Didn't request this? Someone may know your password: change it now and tell your administrator." },
    );
  }
  else await enqueueSms(tenantId, key, to, text, { critical: true, sensitive: true, maxAttempts: 3 });
  return { sentTo: ch.otp!.target };
}

/** Verifies one factor for a user. Throws on failure (and counts the attempt against the challenge). */
export async function verifyFactor(req: Request, doc: MfaDoc, ch: Challenge, method: MfaMethod | 'recovery', code: string, assertion?: unknown) {
  const c = code.trim();
  if (method === 'passkey') {
    const challenge = ch.webauthnChallenge;
    // The WebAuthn challenge is single-use: clear it whatever the outcome.
    ch.webauthnChallenge = undefined;
    const passkeys = doc.mfa?.passkeys ?? [];
    const hit = challenge && assertion ? await verifyAuthentication(req, assertion as never, challenge, passkeys) : null;
    if (!hit) return registerFailure(ch);
    doc.set('mfa.passkeys', passkeys.map((p) => (p.credentialId === hit.credentialId ? hit : plainPasskey(p))));
    await doc.save();
    return;
  }
  if (method === 'totp') {
    const t = doc.mfa?.totp;
    if (!t?.confirmedAt || !t.secret?.ciphertext) return registerFailure(ch);
    const step = verifyTotp(IntegrationSecretService.decrypt(t.secret.ciphertext), c.replace(/\s/g, ''), t.lastStep ?? -1);
    if (step === null) return registerFailure(ch);
    doc.set('mfa.totp.lastStep', step);
    await doc.save();
    return;
  }
  if (method === 'recovery') {
    const codes = doc.mfa?.recoveryCodes ?? [];
    const hash = sha256(`rc:${normCode(c)}`);
    const hit = codes.find((r) => r.hash === hash && !r.usedAt);
    if (!hit) return registerFailure(ch);
    hit.usedAt = new Date();
    doc.set('mfa.recoveryCodes', codes);
    await doc.save();
    return;
  }
  const otp = ch.otp;
  const valid = otp?.hash && otp.method === method && otp.sentAt && Date.now() - otp.sentAt.getTime() < CHALLENGE_TTL_MS && /^\d{6}$/.test(c) && crypto.timingSafeEqual(Buffer.from(otp.hash), Buffer.from(sha256(`${ch._id}:${c}`)));
  if (!valid) return registerFailure(ch);
}

/* ------------------------------------------------------------------ Router factory */
export interface MfaAdapter {
  kind: 'tenant' | 'platform';
  /** Methods this portal supports at all (the owner portal has no SMS). */
  supported: MfaMethod[];
  authenticate: RequestHandler;
  brand(req: Request): string;
  tenantId(req: Request): string | null;
  userId(req: Request): string;
  loadUser(req: Request, id: string): Promise<MfaDoc | null>;
  /** Loads the user for a login challenge (and sets up request context such as req.tenant). */
  loadChallengeUser(req: Request, ch: Challenge): Promise<MfaDoc | null>;
  policy(req: Request): Promise<MfaPolicy>;
  isRequired(req: Request, doc: MfaDoc, policy: MfaPolicy): Promise<boolean>;
  completeLogin(req: Request, res: Response, doc: MfaDoc, amr: string[]): Promise<unknown>;
  /** If the current session is restricted to enrollment, lift it and return a fresh access token. */
  liftRestriction(req: Request): Promise<string | undefined>;
  audit(req: Request, action: string, resourceId: string, extra?: Record<string, unknown>, failed?: boolean): Promise<void>;
}

/** Starts the second step of a login. Returns the response payload for the client. */
export async function beginLoginChallenge(req: Request, adapter: Pick<MfaAdapter, 'kind' | 'supported'>, doc: MfaDoc, tenantId: string | null, policy: MfaPolicy, via = 'password') {
  // Passkeys are only offered where one of them can actually be used (see usablePasskeys).
  const here = enabledMethods(doc).filter((m) => m !== 'passkey' || usablePasskeys(req, doc.mfa?.passkeys ?? []).length > 0);
  const methods = here.filter((m) => adapter.supported.includes(m) && policy.methods.includes(m));
  // A method disabled by policy after enrollment must not lock the user out: fall back to all enrolled methods.
  const offered = methods.length ? methods : here.filter((m) => adapter.supported.includes(m));
  const { token } = await createChallenge({ subjectType: adapter.kind, subjectId: String(doc._id), tenantId, purpose: 'login', methods: offered, ip: req.ip, userAgent: req.get('user-agent'), via });
  const hasRecovery = (doc.mfa?.recoveryCodes ?? []).some((r) => !r.usedAt);
  return { mfaRequired: true, challengeToken: token, methods: offered, preferred: doc.mfa?.preferred && offered.includes(doc.mfa.preferred as MfaMethod) ? doc.mfa.preferred : offered[0], recoveryAvailable: hasRecovery, email: maskEmail(doc.email), phone: maskPhone(doc.mfa?.sms?.phone) };
}

export function buildMfaRouter(a: MfaAdapter) {
  const r = Router();

  /* ---- Login step 2 (unauthenticated; bound to the challenge token) */
  r.post('/mfa/challenge/send', h(async (req, res) => {
    const body = parse(z.object({ challengeToken: z.string().min(20).max(200), method: z.enum(['email', 'sms']) }), req.body);
    const ch = await findChallenge(body.challengeToken, 'login');
    if (!ch.methods.includes(body.method)) throw badRequest('This method is not enabled for your account');
    const doc = await a.loadChallengeUser(req, ch);
    if (!doc) throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
    const to = body.method === 'email' ? doc.email : doc.mfa?.sms?.phone;
    if (!to) throw badRequest('No destination on file for this method');
    res.json({ success: true, data: await deliverOtp(ch, body.method, to, a.brand(req), a.tenantId(req)) });
  }));

  r.post('/mfa/challenge/passkey-options', h(async (req, res) => {
    const body = parse(z.object({ challengeToken: z.string().min(20).max(200) }), req.body);
    const ch = await findChallenge(body.challengeToken, 'login');
    if (!ch.methods.includes('passkey')) throw badRequest('This method is not enabled for your account');
    const doc = await a.loadChallengeUser(req, ch);
    if (!doc) throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
    const options = await authenticationOptions(req, doc.mfa?.passkeys ?? []);
    ch.webauthnChallenge = options.challenge;
    await ch.save();
    res.json({ success: true, data: options });
  }));

  r.post('/mfa/challenge/verify', h(async (req, res) => {
    const body = parse(
      z.object({ challengeToken: z.string().min(20).max(200), method: z.enum(['totp', 'email', 'sms', 'passkey', 'recovery']), code: z.string().max(20).default(''), assertion: z.record(z.string(), z.unknown()).optional() })
        .refine((b) => (b.method === 'passkey' ? !!b.assertion : b.code.trim().length >= 4), { message: 'Enter the code', path: ['code'] }),
      req.body,
    );
    const ch = await findChallenge(body.challengeToken, 'login');
    if (body.method !== 'recovery' && !ch.methods.includes(body.method)) throw badRequest('This method is not enabled for your account');
    const doc = await a.loadChallengeUser(req, ch);
    if (!doc) throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
    try {
      await verifyFactor(req, doc, ch, body.method, body.code, body.assertion);
    } catch (err) {
      await a.audit(req, 'auth.mfa_failed', String(doc._id), { method: body.method }, true);
      throw err;
    }
    ch.consumedAt = new Date();
    await ch.save();
    await a.audit(req, 'auth.mfa_verified', String(doc._id), { method: body.method, via: ch.via });
    if (body.method === 'recovery') {
      const left = (doc.mfa?.recoveryCodes ?? []).filter((c) => !c.usedAt).length;
      await notifyEmail(a.tenantId(req), `mfa-recovery-used:${doc._id}:${Date.now()}`, doc.email, `${a.brand(req)}: a recovery code was used`, `A two-factor recovery code was used to sign in to your account. ${left} code(s) remain. If this was not you, contact your administrator immediately.`);
    }
    res.json({ success: true, data: await a.completeLogin(req, res, doc, [ch.via ?? 'password', body.method]) });
  }));

  /* ---- Enrollment & management (authenticated; allowed on enrollment-restricted sessions) */
  const me = async (req: Request) => {
    const doc = await a.loadUser(req, a.userId(req));
    if (!doc) throw unauthorized();
    return doc;
  };
  const afterEnable = async (req: Request, doc: MfaDoc, method: MfaMethod) => {
    let recoveryCodes: string[] | undefined;
    if (!(doc.mfa?.recoveryCodes ?? []).some((c) => !c.usedAt)) {
      const rc = newRecoveryCodes();
      doc.set('mfa.recoveryCodes', rc.stored);
      recoveryCodes = rc.codes;
    }
    if (!doc.mfa?.preferred) doc.set('mfa.preferred', method);
    await doc.save();
    await a.audit(req, 'auth.mfa_enabled', String(doc._id), { method });
    await notifyEmail(a.tenantId(req), `mfa-on:${doc._id}:${method}:${Date.now()}`, doc.email, `${a.brand(req)}: two-factor method added`, `A two-factor authentication method (${method}) was added to your account. If this was not you, contact your administrator immediately.`);
    return { recoveryCodes, accessToken: await a.liftRestriction(req) };
  };

  r.get('/mfa', a.authenticate, h(async (req, res) => {
    const doc = await me(req);
    const policy = await a.policy(req);
    res.json({
      success: true,
      data: {
        enabled: enabledMethods(doc),
        available: a.supported.filter((m) => policy.methods.includes(m)),
        required: await a.isRequired(req, doc, policy),
        policy,
        preferred: doc.mfa?.preferred ?? null,
        email: maskEmail(doc.email),
        smsPhone: maskPhone(doc.mfa?.sms?.phone),
        phoneOnFile: maskPhone(normalizePhone(doc.phone)),
        passkeys: (doc.mfa?.passkeys ?? []).map((p) => ({ id: p.credentialId, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp ?? false })),
        recoveryCodesRemaining: (doc.mfa?.recoveryCodes ?? []).filter((c) => !c.usedAt).length,
      },
    });
  }));

  const assertAllowed = async (req: Request, method: MfaMethod) => {
    const policy = await a.policy(req);
    if (!a.supported.includes(method) || !policy.methods.includes(method)) throw forbiddenMethod();
  };
  const forbiddenMethod = () => new AppError(403, 'MFA_METHOD_NOT_ALLOWED', 'This two-factor method is not enabled for your organisation');

  r.post('/mfa/totp/setup', a.authenticate, h(async (req, res) => {
    await assertAllowed(req, 'totp');
    const doc = await me(req);
    const secret = generateTotpSecret();
    doc.set('mfa.totp.pendingSecret', IntegrationSecretService.encrypt(secret));
    await doc.save();
    res.json({ success: true, data: { secret, otpauthUri: otpauthUri(a.brand(req), doc.email, secret) } });
  }));

  r.post('/mfa/totp/confirm', a.authenticate, h(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(6).max(10) }), req.body);
    const doc = await me(req);
    const pending = doc.mfa?.totp?.pendingSecret?.ciphertext;
    if (!pending) throw badRequest('Start authenticator setup first');
    const step = verifyTotp(IntegrationSecretService.decrypt(pending), code.replace(/\s/g, ''));
    if (step === null) throw new AppError(400, 'MFA_CODE_INVALID', 'That code is not correct. Check the time on your phone and try again.');
    doc.set('mfa.totp', { secret: doc.mfa!.totp!.pendingSecret, pendingSecret: undefined, confirmedAt: new Date(), lastStep: step });
    res.json({ success: true, data: await afterEnable(req, doc, 'totp') });
  }));

  r.post('/mfa/passkey/options', a.authenticate, h(async (req, res) => {
    await assertAllowed(req, 'passkey');
    const doc = await me(req);
    const existing = doc.mfa?.passkeys ?? [];
    if (existing.length >= MAX_PASSKEYS) throw conflict(`You can register up to ${MAX_PASSKEYS} passkeys. Remove one first.`, undefined, 'PASSKEY_LIMIT');
    const options = await registrationOptions(req, { brand: a.brand(req), userId: a.userId(req), email: doc.email, name: doc.name, existing });
    const { token, challenge } = await createChallenge({ subjectType: a.kind, subjectId: a.userId(req), tenantId: a.tenantId(req), purpose: 'enroll_passkey', methods: ['passkey'], ip: req.ip, userAgent: req.get('user-agent') });
    await meta().MfaChallenge.updateOne({ _id: challenge._id }, { webauthnChallenge: options.challenge });
    res.json({ success: true, data: { challengeToken: token, options } });
  }));

  r.post('/mfa/passkey/confirm', a.authenticate, h(async (req, res) => {
    const body = parse(z.object({ challengeToken: z.string().min(20).max(200), name: z.string().trim().min(1).max(60).default('Passkey'), response: z.record(z.string(), z.unknown()) }), req.body);
    await assertAllowed(req, 'passkey');
    const ch = await findChallenge(body.challengeToken, 'enroll_passkey');
    if (String(ch.subjectId) !== a.userId(req) || !ch.webauthnChallenge) throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
    ch.consumedAt = new Date();
    await ch.save();
    const doc = await me(req);
    const pk = await verifyRegistration(req, body.response as never, ch.webauthnChallenge, body.name);
    const existing = doc.mfa?.passkeys ?? [];
    if (existing.some((p) => p.credentialId === pk.credentialId)) throw conflict('This passkey is already registered', undefined, 'PASSKEY_EXISTS');
    doc.set('mfa.passkeys', [...existing.map(plainPasskey), pk]);
    res.json({ success: true, data: await afterEnable(req, doc, 'passkey') });
  }));

  r.post('/mfa/passkey/remove', a.authenticate, h(async (req, res) => {
    const { id, password } = parse(z.object({ id: z.string().min(1).max(1400), password: z.string().min(1).max(200) }), req.body);
    const doc = await a.loadUser(req, a.userId(req));
    if (!doc || !doc.passwordHash || !(await verifyPassword(password, doc.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
    const passkeys = doc.mfa?.passkeys ?? [];
    const target = passkeys.find((p) => p.credentialId === id);
    if (!target) throw badRequest('Passkey not found');
    const enabled = enabledMethods(doc);
    const policy = await a.policy(req);
    if (passkeys.length === 1 && enabled.length === 1 && (await a.isRequired(req, doc, policy))) throw conflict('Two-factor authentication is required by your organisation. Add another method before removing this one.', undefined, 'MFA_REQUIRED_BY_POLICY');
    doc.set('mfa.passkeys', passkeys.filter((p) => p.credentialId !== id).map(plainPasskey));
    if (passkeys.length === 1) {
      const remaining = enabled.filter((m) => m !== 'passkey');
      if (doc.mfa?.preferred === 'passkey') doc.set('mfa.preferred', remaining[0]);
      if (!remaining.length) doc.set('mfa.recoveryCodes', []);
    }
    await doc.save();
    await a.audit(req, 'auth.passkey_removed', String(doc._id), { name: target.name });
    await notifyEmail(a.tenantId(req), `passkey-off:${doc._id}:${Date.now()}`, doc.email, `${a.brand(req)}: passkey removed`, `The passkey "${target.name ?? 'Passkey'}" was removed from your account. If this was not you, contact your administrator immediately.`);
    res.json({ success: true, data: { enabled: enabledMethods(doc) } });
  }));

  r.post('/mfa/:method/setup', a.authenticate, h(async (req, res) => {
    const method = z.enum(['email', 'sms']).parse(req.params.method);
    await assertAllowed(req, method);
    const body = parse(z.object({ phone: z.string().max(30).optional() }), req.body ?? {});
    const doc = await me(req);
    let target = doc.email;
    if (method === 'sms') {
      const phone = normalizePhone(body.phone ?? doc.phone);
      if (!phone || !/^254\d{9}$/.test(phone)) throw badRequest('Enter a valid Kenyan mobile number');
      target = phone;
    }
    const { token, challenge } = await createChallenge({ subjectType: a.kind, subjectId: a.userId(req), tenantId: a.tenantId(req), purpose: `enroll_${method}`, methods: [method], ip: req.ip, userAgent: req.get('user-agent') });
    const sent = await deliverOtp(challenge, method, target, a.brand(req), a.tenantId(req));
    // Remember the unmasked destination for confirmation (the challenge is private and short-lived).
    await meta().MfaChallenge.updateOne({ _id: challenge._id }, { via: target });
    res.json({ success: true, data: { challengeToken: token, ...sent } });
  }));

  r.post('/mfa/:method/confirm', a.authenticate, h(async (req, res) => {
    const method = z.enum(['email', 'sms']).parse(req.params.method);
    const body = parse(z.object({ challengeToken: z.string().min(20).max(200), code: z.string().min(6).max(10) }), req.body);
    const ch = await findChallenge(body.challengeToken, `enroll_${method}`);
    if (String(ch.subjectId) !== a.userId(req)) throw unauthorized('This verification has expired. Start again.', 'MFA_CHALLENGE_INVALID');
    const doc = await me(req);
    await verifyFactor(req, doc, ch, method, body.code);
    ch.consumedAt = new Date();
    await ch.save();
    if (method === 'email') doc.set('mfa.email', { enabledAt: new Date() });
    else doc.set('mfa.sms', { enabledAt: new Date(), phone: ch.via });
    res.json({ success: true, data: await afterEnable(req, doc, method) });
  }));

  r.post('/mfa/:method/disable', a.authenticate, h(async (req, res) => {
    const method = z.enum(['totp', 'email', 'sms', 'passkey']).parse(req.params.method);
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const doc = await a.loadUser(req, a.userId(req));
    if (!doc || !doc.passwordHash || !(await verifyPassword(password, doc.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
    const enabled = enabledMethods(doc);
    if (!enabled.includes(method)) throw badRequest('This method is not enabled');
    const policy = await a.policy(req);
    if (enabled.length === 1 && (await a.isRequired(req, doc, policy))) throw conflict('Two-factor authentication is required by your organisation. Add another method before removing this one.', undefined, 'MFA_REQUIRED_BY_POLICY');
    if (method === 'totp') doc.set('mfa.totp', { lastStep: -1 });
    else if (method === 'passkey') doc.set('mfa.passkeys', []);
    else doc.set(`mfa.${method}`, {});
    const remaining = enabled.filter((m) => m !== method);
    if (doc.mfa?.preferred === method) doc.set('mfa.preferred', remaining[0]);
    if (!remaining.length) doc.set('mfa.recoveryCodes', []);
    await doc.save();
    await a.audit(req, 'auth.mfa_disabled', String(doc._id), { method });
    await notifyEmail(a.tenantId(req), `mfa-off:${doc._id}:${method}:${Date.now()}`, doc.email, `${a.brand(req)}: two-factor method removed`, `A two-factor authentication method (${method}) was removed from your account. If this was not you, contact your administrator immediately.`);
    res.json({ success: true, data: { enabled: remaining } });
  }));

  r.post('/mfa/recovery-codes', a.authenticate, h(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const doc = await a.loadUser(req, a.userId(req));
    if (!doc || !doc.passwordHash || !(await verifyPassword(password, doc.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
    if (!enabledMethods(doc).length) throw badRequest('Enable a two-factor method first');
    const rc = newRecoveryCodes();
    doc.set('mfa.recoveryCodes', rc.stored);
    await doc.save();
    await a.audit(req, 'auth.mfa_recovery_regenerated', String(doc._id));
    res.json({ success: true, data: { recoveryCodes: rc.codes } });
  }));

  r.post('/mfa/preferred', a.authenticate, h(async (req, res) => {
    const { method } = parse(z.object({ method: z.enum(['totp', 'email', 'sms', 'passkey']) }), req.body);
    const doc = await me(req);
    if (!enabledMethods(doc).includes(method)) throw badRequest('This method is not enabled');
    doc.set('mfa.preferred', method);
    await doc.save();
    res.json({ success: true });
  }));

  return r;
}
