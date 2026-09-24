import { isValidObjectId } from 'mongoose';
import { meta } from '../../models/meta';
import { getTenantModels } from '../../db/tenantManager';
import type { TenantContext } from '../../types/context';
import { AppError, notFound } from '../../utils/errors';

const cache = new Map<string, { ctx: TenantContext; exp: number }>();
const TTL_MS = 15_000;

export function invalidateTenantCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function loadTenant(tenantId: string, { requireActive = true } = {}): Promise<TenantContext> {
  if (!isValidObjectId(tenantId)) throw notFound('Facility not found', 'TENANT_NOT_FOUND');
  let ctx = cache.get(tenantId);
  if (!ctx || ctx.exp < Date.now()) {
    const { Tenant, TenantDatabase } = meta();
    const [tenant, db] = await Promise.all([Tenant.findById(tenantId).lean(), TenantDatabase.findOne({ tenantId }).lean()]);
    if (!tenant || !db) throw notFound('Facility not found', 'TENANT_NOT_FOUND');
    ctx = {
      ctx: {
        id: String(tenant._id),
        slug: tenant.slug,
        name: tenant.name,
        dbName: db.dbName,
        status: tenant.status,
        models: getTenantModels(db.dbName),
      },
      exp: Date.now() + TTL_MS,
    };
    cache.set(tenantId, ctx);
  }
  if (requireActive && ctx.ctx.status !== 'active') {
    throw new AppError(403, ctx.ctx.status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_UNAVAILABLE', 'This facility account is not active. Contact AfeySync support.');
  }
  return ctx.ctx;
}
