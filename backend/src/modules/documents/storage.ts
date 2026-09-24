import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env';

/**
 * Private document storage. Keys are generated server-side only (tenant/yyyy/mm/uuid) and never
 * contain user input, so path traversal is impossible; the root is outside any web-served directory.
 * The interface is small so an S3-compatible driver can replace it.
 */
const root = path.resolve(env.FILE_STORAGE_PATH);

export function newKey(tenantSlug: string) {
  const d = new Date();
  return `${tenantSlug}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
}

function resolveKey(key: string) {
  if (!/^[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export const localStorageDriver = {
  async put(key: string, data: Buffer) {
    const full = resolveKey(key);
    await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await fsp.writeFile(full, data, { mode: 0o600, flag: 'wx' });
  },
  stream(key: string) {
    return fs.createReadStream(resolveKey(key));
  },
  async exists(key: string) {
    return fsp.access(resolveKey(key)).then(() => true, () => false);
  },
};

/** Detect file type from content (magic bytes) — the client-declared MIME type is not trusted. */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 132 && buf.subarray(128, 132).toString('latin1') === 'DICM') return { mime: 'application/dicom', ext: 'dcm' };
  return null;
}
