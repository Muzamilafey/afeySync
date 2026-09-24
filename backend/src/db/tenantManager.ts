import type { Connection } from 'mongoose';
import { env } from '../config/env';
import { getTenantBaseConn } from './connections';
import { tenantModels, type TenantModels } from '../models/tenant';

export const tenantDbName = (slug: string) => `${env.TENANT_DB_PREFIX}${slug.replace(/-/g, '_')}`;

/**
 * Returns a connection bound to the tenant's own database. Uses `useDb` so all tenants share one
 * connection pool while every query is physically scoped to a separate database.
 */
export function getTenantConnection(dbName: string): Connection {
  if (!dbName.startsWith(env.TENANT_DB_PREFIX)) throw new Error('Refusing to open non-tenant database');
  return getTenantBaseConn().useDb(dbName, { useCache: true });
}

export function getTenantModels(dbName: string): TenantModels {
  return tenantModels(getTenantConnection(dbName));
}
