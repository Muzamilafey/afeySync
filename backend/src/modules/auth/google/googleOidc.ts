import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { meta } from '../../../models/meta';
import { AppError } from '../../../utils/errors';
import { randomToken, sha256 } from '../../../utils/crypto';
import { IntegrationSecretService, type EncryptedValue } from '../../integrations/secretService';
import { PROVIDER_DEFINITIONS } from '../../integrations/providers';

/**
 * Google Sign-In via OpenID Connect (authorization code flow + PKCE, state and nonce).
 * Endpoints come from Google's published discovery document; the ID token signature is verified
 * against Google's JWKS, and iss / aud / exp / nonce / email_verified are all checked.
 */
export interface GoogleConfig { clientId: string; clientSecret: string; discoveryUrl: string; redirectUri: string; hostedDomain?: string }
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }

const DISABLED = 'Sign in with Google is not enabled. Contact AfeySync platform administration.';
export const defaultRedirectUri = () => `${env.API_URL.replace(/\/$/, '')}/api/v1/oauth/google/callback`;

export async function googleConfig(): Promise<GoogleConfig> {
  const doc = await meta().IntegrationConfig.findOne({ scope: 'platform', tenantId: null, provider: 'google' }).lean();
  if (!doc?.enabled) throw new AppError(503, 'GOOGLE_DISABLED', DISABLED);
  const settings = (doc.settings ?? {}) as Record<string, string>;
  const secrets = (doc.secrets ?? {}) as unknown as Record<string, EncryptedValue>;
  const secret = secrets.clientSecret ? IntegrationSecretService.decrypt(secrets.clientSecret) : '';
  if (!settings.clientId || !secret) throw new AppError(503, 'GOOGLE_DISABLED', DISABLED);
  const def = Object.fromEntries(PROVIDER_DEFINITIONS.google.settings.filter((s) => s.default).map((s) => [s.key, s.default!]));
  return { clientId: settings.clientId, clientSecret: secret, discoveryUrl: settings.discoveryUrl || def.discoveryUrl, redirectUri: settings.redirectUri || defaultRedirectUri(), hostedDomain: settings.hostedDomain || undefined };
}

export async function googleEnabled() {
  try {
    await googleConfig();
    return true;
  } catch {
    return false;
  }
}

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: Array<Record<string, string>> }>();
const HOUR = 3600_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new AppError(502, 'GOOGLE_UNAVAILABLE', `Google responded ${res.status}`);
  return (await res.json()) as T;
}

export async function discovery(cfg: GoogleConfig): Promise<Discovery> {
  const hit = discoveryCache.get(cfg.discoveryUrl);
  if (hit && Date.now() - hit.at < HOUR) return hit.doc;
  const doc = await getJson<Discovery>(cfg.discoveryUrl);
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new AppError(502, 'GOOGLE_UNAVAILABLE', 'Invalid OpenID discovery document');
  discoveryCache.set(cfg.discoveryUrl, { at: Date.now(), doc });
  return doc;
}

async function signingKey(jwksUri: string, kid: string) {
  const load = async (force: boolean) => {
    const hit = jwksCache.get(jwksUri);
    if (!force && hit && Date.now() - hit.at < HOUR) return hit.keys;
    const { keys } = await getJson<{ keys: Array<Record<string, string>> }>(jwksUri);
    jwksCache.set(jwksUri, { at: Date.now(), keys });
    return keys;
  };
  // Refetch once on an unknown kid (Google rotates keys).
  let jwk = (await load(false)).find((k) => k.kid === kid) ?? (await load(true)).find((k) => k.kid === kid);
  if (!jwk) throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Unknown signing key');
  jwk = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  return crypto.createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKeyInput["key"], format: 'jwk' });
}

export function clearGoogleCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Creates the state record and returns Google's authorization URL. */
export async function startAuthorization(input: { portal: 'tenant' | 'platform'; mode: 'login' | 'link'; tenantId?: string | null; userId?: string; returnOrigin: string; next?: string }) {
  const cfg = await googleConfig();
  const d = await discovery(cfg);
  const state = randomToken(32);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  await meta().OAuthState.create({
    provider: 'google', portal: input.portal, mode: input.mode, tenantId: input.tenantId ?? undefined, userId: input.userId,
    stateHash: sha256(`oauth:${state}`), nonce, codeVerifier: IntegrationSecretService.encrypt(verifier), returnOrigin: input.returnOrigin, next: input.next,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    ...(cfg.hostedDomain ? { hd: cfg.hostedDomain } : {}),
  }).toString();
  return url.toString();
}

export interface GoogleIdentity { sub: string; email: string; name?: string }

/** Exchanges the authorization code and returns the verified identity. */
export async function completeAuthorization(code: string, st: { nonce: string; codeVerifier: EncryptedValue }): Promise<GoogleIdentity> {
  const cfg = await googleConfig();
  const d = await discovery(cfg);
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, code_verifier: IntegrationSecretService.decrypt(st.codeVerifier) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new AppError(401, 'GOOGLE_EXCHANGE_FAILED', `Google sign-in failed${body.error ? ` (${body.error})` : ''}`);
  const header = jwt.decode(body.id_token, { complete: true })?.header;
  if (!header?.kid || header.alg !== 'RS256') throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Unexpected token format');
  const key = await signingKey(d.jwks_uri, header.kid);
  let claims: jwt.JwtPayload;
  try {
    // Google issues tokens with either issuer form.
    const issuers = [d.issuer, d.issuer.replace(/^https:\/\//, '')] as [string, ...string[]];
    claims = jwt.verify(body.id_token, key, { algorithms: ['RS256'], audience: cfg.clientId, issuer: issuers }) as jwt.JwtPayload;
  } catch (err) {
    throw new AppError(401, 'GOOGLE_TOKEN_INVALID', `Invalid Google ID token: ${(err as Error).message}`);
  }
  if (claims.nonce !== st.nonce) throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Nonce mismatch');
  if (claims.email_verified !== true || !claims.email || !claims.sub) throw new AppError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Your Google email address is not verified');
  if (cfg.hostedDomain && claims.hd !== cfg.hostedDomain) throw new AppError(403, 'GOOGLE_DOMAIN_NOT_ALLOWED', `Only ${cfg.hostedDomain} Google accounts are allowed`);
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name ? String(claims.name) : undefined };
}
