import type { Request } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AppError, forbidden } from '../../../utils/errors';
import { env } from '../../../config/env';

/**
 * WebAuthn passkeys as a second factor. The relying party is the exact host the user signs in on
 * (each facility subdomain or custom domain, or the owner portal), so a passkey created for one
 * facility cannot be used on another. User verification (biometric or device PIN) is required.
 */
export interface StoredPasskey {
  credentialId?: string | null;
  publicKey?: string | null;
  counter?: number | null;
  transports?: string[] | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
  name?: string | null;
  /** The WebAuthn RP ID it was registered for. Missing on older passkeys: those belong to the exact host they were created on. */
  rpId?: string | null;
  createdAt?: Date | null;
  lastUsedAt?: Date | null;
}

export const MAX_PASSKEYS = 10;

/** Copies a stored passkey (possibly a Mongoose subdocument) into a plain object. */
export const plainPasskey = (p: StoredPasskey): StoredPasskey => ({
  credentialId: p.credentialId, publicKey: p.publicKey, counter: p.counter, transports: [...(p.transports ?? [])], deviceType: p.deviceType, backedUp: p.backedUp, name: p.name, rpId: p.rpId, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt,
});

export const rpId = (req: Request) => (req.hostname || '').toLowerCase();

/**
 * New passkeys are registered for the shared parent domain (PLATFORM_DOMAIN, or localhost locally), so the
 * same passkey works on the accounts sign-in and on every facility address. The browser still reports, and
 * we still check, the exact origin of every use. Custom domains keep their own host.
 */
export function sharedRpId(req: Request) {
  const host = rpId(req);
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost';
  const apex = env.PLATFORM_DOMAIN.toLowerCase();
  if (host === apex || host.endsWith(`.${apex}`)) return apex;
  return host;
}

/** The RP ID a stored passkey belongs to (older ones: this very host). */
const rpOf = (req: Request, p: StoredPasskey) => p.rpId || rpId(req);

/** Passkeys that can be used on this address: shared-domain ones, and older ones on their own host (never on accounts). */
export function usablePasskeys(req: Request, passkeys: StoredPasskey[]) {
  const shared = sharedRpId(req);
  return passkeys.filter((p) => p.credentialId && (p.rpId ? p.rpId === shared : !req.isAccountsHost));
}

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';

/** The browser's origin must be this very host, over HTTPS (plain HTTP only for local development). */
export function expectedOrigin(req: Request): string {
  const raw = req.get('origin');
  let u: URL;
  try {
    u = new URL(raw ?? '');
  } catch {
    throw forbidden('Passkeys require a browser origin', 'ORIGIN_MISMATCH');
  }
  const host = rpId(req);
  if (u.hostname.toLowerCase() !== host) throw forbidden('Origin does not match this site', 'ORIGIN_MISMATCH');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(host))) throw forbidden('Passkeys require HTTPS', 'ORIGIN_MISMATCH');
  return u.origin;
}

export async function registrationOptions(req: Request, input: { brand: string; userId: string; email: string; name: string; existing: StoredPasskey[] }) {
  return generateRegistrationOptions({
    rpName: input.brand,
    rpID: sharedRpId(req),
    userName: input.email,
    userDisplayName: input.name,
    userID: new TextEncoder().encode(input.userId),
    attestationType: 'none',
    excludeCredentials: input.existing.filter((p) => p.credentialId).map((p) => ({ id: p.credentialId!, transports: (p.transports ?? []) as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
}

export async function verifyRegistration(req: Request, response: RegistrationResponseJSON, challenge: string, name: string): Promise<StoredPasskey> {
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: expectedOrigin(req), expectedRPID: sharedRpId(req), requireUserVerification: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'PASSKEY_INVALID', 'The passkey could not be verified. Try again.');
  }
  if (!v.verified || !v.registrationInfo) throw new AppError(400, 'PASSKEY_INVALID', 'The passkey could not be verified. Try again.');
  const c = v.registrationInfo.credential;
  return {
    credentialId: c.id,
    publicKey: Buffer.from(c.publicKey).toString('base64url'),
    counter: c.counter,
    transports: c.transports ?? [],
    deviceType: v.registrationInfo.credentialDeviceType,
    backedUp: v.registrationInfo.credentialBackedUp,
    name,
    rpId: sharedRpId(req),
    createdAt: new Date(),
  };
}

export async function authenticationOptions(req: Request, passkeys: StoredPasskey[]) {
  // One RP ID per ceremony: the shared one when the user has such passkeys, otherwise this host (older passkeys).
  const usable = usablePasskeys(req, passkeys);
  const shared = sharedRpId(req);
  const rp = usable.some((p) => p.rpId === shared) ? shared : rpId(req);
  return generateAuthenticationOptions({
    rpID: rp,
    userVerification: 'required',
    allowCredentials: usable.filter((p) => rpOf(req, p) === rp).map((p) => ({ id: p.credentialId!, transports: (p.transports ?? []) as AuthenticatorTransportFuture[] })),
  });
}

/** Verifies a sign-in assertion. Returns the matching passkey with its new counter, or null. */
export async function verifyAuthentication(req: Request, response: AuthenticationResponseJSON, challenge: string, passkeys: StoredPasskey[]): Promise<StoredPasskey | null> {
  const pk = usablePasskeys(req, passkeys).find((p) => p.credentialId === response?.id);
  if (!pk?.publicKey) return null;
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(req),
      expectedRPID: rpOf(req, pk),
      requireUserVerification: true,
      credential: { id: pk.credentialId!, publicKey: new Uint8Array(Buffer.from(pk.publicKey, 'base64url')), counter: pk.counter ?? 0, transports: (pk.transports ?? []) as AuthenticatorTransportFuture[] },
    });
    if (!v.verified) return null;
    return { ...plainPasskey(pk), counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() };
  } catch (err) {
    if (err instanceof AppError) throw err;
    return null; // bad signature, counter regression (possible cloned key), wrong challenge
  }
}
