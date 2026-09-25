import { meta } from '../../models/meta';
import { getTenantModels } from '../../db/tenantManager';
import { sha256 } from '../../utils/crypto';
import { logger } from '../../utils/logger';

/**
 * Email → facility directory for signing in on the main domain. Only a hash of the email is stored,
 * so the platform database never holds a readable list of facility users.
 */
export const emailHash = (email: string) => sha256(`dir:${email.trim().toLowerCase()}`);

export async function registerDirectoryEntry(email: string, tenantId: string) {
  await meta().UserDirectory.updateOne({ emailHash: emailHash(email), tenantId }, { $setOnInsert: { emailHash: emailHash(email), tenantId } }, { upsert: true }).catch((err) => logger.warn({ err }, 'user directory write failed'));
}

/** Removes this facility's directory entry for an email (after the user's email changes). */
export async function removeDirectoryEntry(email: string, tenantId: string) {
  await meta().UserDirectory.deleteOne({ emailHash: emailHash(email), tenantId });
}

export async function tenantsForEmail(email: string): Promise<string[]> {
  const rows = await meta().UserDirectory.find({ emailHash: emailHash(email) }).select('tenantId').lean();
  return rows.map((r) => String(r.tenantId));
}

/** Idempotent backfill from every ready facility database (runs at start-up). */
export async function backfillUserDirectory() {
  const dbs = await meta().TenantDatabase.find({ status: 'ready' }).select('tenantId dbName').lean();
  for (const db of dbs) {
    try {
      const users = await getTenantModels(db.dbName).User.find({}).select('email').lean();
      if (!users.length) continue;
      await meta().UserDirectory.bulkWrite(users.map((u) => ({ updateOne: { filter: { emailHash: emailHash(u.email), tenantId: db.tenantId }, update: { $setOnInsert: { emailHash: emailHash(u.email), tenantId: db.tenantId } }, upsert: true } })), { ordered: false });
    } catch (err) {
      logger.warn({ err, db: db.dbName }, 'user directory backfill failed');
    }
  }
}
