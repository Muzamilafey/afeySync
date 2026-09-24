import crypto from 'node:crypto';
import { env } from '../../config/env';

/**
 * IntegrationSecretService
 * AES-256-GCM envelope for credentials (API keys, client secrets, passwords, private keys, tokens).
 * Stored format: `v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>`.
 * Decrypted values are only ever used server-side; they must never be serialized to a client.
 */
export interface EncryptedValue {
  ciphertext: string;
  keyId: string;
  last4: string;
  updatedAt: Date;
}

function loadKeys(): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const primary = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64');
  if (primary.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  keys.set(env.INTEGRATION_ENCRYPTION_KEY_ID, primary);
  // Retired keys for rotation: INTEGRATION_ENCRYPTION_OLD_KEYS="k0:<b64>,kx:<b64>"
  for (const pair of (process.env.INTEGRATION_ENCRYPTION_OLD_KEYS ?? '').split(',').filter(Boolean)) {
    const [id, b64] = pair.split(':');
    if (id && b64) keys.set(id, Buffer.from(b64, 'base64'));
  }
  return keys;
}

const keys = loadKeys();

export const IntegrationSecretService = {
  encrypt(plaintext: string): EncryptedValue {
    const keyId = env.INTEGRATION_ENCRYPTION_KEY_ID;
    const key = keys.get(keyId)!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ['v1', keyId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':'),
      keyId,
      last4: plaintext.length > 8 ? plaintext.slice(-4) : '',
      updatedAt: new Date(),
    };
  },

  decrypt(value: EncryptedValue | string): string {
    const raw = typeof value === 'string' ? value : value.ciphertext;
    const [version, keyId, ivB64, tagB64, ctB64] = raw.split(':');
    if (version !== 'v1') throw new Error('Unsupported secret format');
    const key = keys.get(keyId);
    if (!key) throw new Error(`Encryption key ${keyId} is not available`);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  },

  /** Re-encrypt with the current primary key (used during key rotation). */
  rewrap(value: EncryptedValue): EncryptedValue {
    return this.encrypt(this.decrypt(value));
  },

  /** Browser-safe representation: presence + masked hint only. */
  mask(value?: EncryptedValue | null) {
    if (!value) return { configured: false };
    return { configured: true, hint: value.last4 ? `••••${value.last4}` : '••••••••', updatedAt: value.updatedAt };
  },
};
