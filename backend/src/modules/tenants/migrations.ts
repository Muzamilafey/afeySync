import { meta } from '../../models/meta';
import { ensureTenantIndexes } from '../../models/tenant';
import { getTenantConnection, getTenantModels } from '../../db/tenantManager';
import { DEFAULT_ROLES, PERMISSIONS_ADDED_IN } from '../rbac/catalog';
import { seedTenantCatalogs } from './seedCatalogs';
import { logger } from '../../utils/logger';
import { PERMISSION_GROUPS } from '../rbac/catalog';

/**
 * Tenant schema migrations. New tenants are provisioned at the latest version; existing tenants are
 * upgraded on API start. Migrations are additive and idempotent: they never overwrite a facility's
 * customisations of system roles, only add permissions introduced by newer versions.
 */
export const TENANT_SCHEMA_VERSION = 6;

export async function migrateTenant(dbName: string, fromVersion: number) {
  const conn = getTenantConnection(dbName);
  const m = getTenantModels(dbName);
  await ensureTenantIndexes(conn);
  for (const [group, g] of Object.entries(PERMISSION_GROUPS)) {
    for (const [key, description] of Object.entries(g.permissions)) await m.Permission.updateOne({ key }, { $set: { key, group, description } }, { upsert: true });
  }
  for (let v = fromVersion + 1; v <= TENANT_SCHEMA_VERSION; v += 1) {
    const added = PERMISSIONS_ADDED_IN[v] ?? [];
    for (const role of DEFAULT_ROLES) {
      const grant = role.permissions.filter((p) => added.includes(p));
      if (grant.length) await m.Role.updateOne({ key: role.key, system: true }, { $addToSet: { permissions: { $each: grant } } });
    }
    if (v === 2) await seedTenantCatalogs(m);
    // v4: passkeys are a new two-factor method; allow them in a facility's saved MFA policy.
    if (v === 4) await m.FacilitySetting.updateOne({ key: 'security.mfa', 'value.methods': { $exists: true } }, { $addToSet: { 'value.methods': 'passkey' } });
  }
}

export async function runTenantMigrations() {
  const { TenantDatabase, PlatformSettings } = meta();
  // Platform policy: allow passkeys once (the marker keeps an owner's later choice from being undone).
  const marker = await PlatformSettings.findOne({ key: 'migrations.passkeyPolicy' }).lean();
  if (!marker) {
    await PlatformSettings.updateOne({ key: 'security.mfa', 'value.methods': { $exists: true } }, { $addToSet: { 'value.methods': 'passkey' } });
    await PlatformSettings.updateOne({ key: 'migrations.passkeyPolicy' }, { $set: { key: 'migrations.passkeyPolicy', value: { at: new Date() } } }, { upsert: true });
  }
  const pending = await TenantDatabase.find({ status: 'ready', schemaVersion: { $lt: TENANT_SCHEMA_VERSION } }).lean();
  for (const db of pending) {
    try {
      await migrateTenant(db.dbName, db.schemaVersion ?? 1);
      await TenantDatabase.updateOne({ _id: db._id }, { schemaVersion: TENANT_SCHEMA_VERSION });
      logger.info({ db: db.dbName, to: TENANT_SCHEMA_VERSION }, 'Tenant migrated');
    } catch (err) {
      logger.error({ err, db: db.dbName }, 'Tenant migration failed');
    }
  }
}
