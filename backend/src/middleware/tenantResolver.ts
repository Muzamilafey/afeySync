import type { NextFunction, Request, Response } from 'express';
import { env, ownerHosts } from '../config/env';
import { meta } from '../models/meta';

/**
 * Resolves the tenant from the request hostname:
 *   <slug>.<PLATFORM_DOMAIN>  -> TenantDomain(platform_subdomain)
 *   custom domain / branch subdomain -> TenantDomain(custom|branch, verified)
 * The frontend never supplies a tenant ID. Results are cached briefly.
 */
const cache = new Map<string, { tenantId: string | null; exp: number }>();
const TTL_MS = 60_000;

export function clearDomainCache() {
  cache.clear();
}

export async function lookupHostTenant(hostname: string): Promise<string | null> {
  const host = hostname.toLowerCase();
  const hit = cache.get(host);
  if (hit && hit.exp > Date.now()) return hit.tenantId;
  const domain = await meta().TenantDomain.findOne({ hostname: host }).lean();
  let tenantId: string | null = null;
  if (domain && (domain.type === 'platform_subdomain' || domain.verified)) tenantId = String(domain.tenantId);
  cache.set(host, { tenantId, exp: Date.now() + TTL_MS });
  return tenantId;
}

export async function resolveTenantHost(req: Request, _res: Response, next: NextFunction) {
  const host = (req.hostname || '').toLowerCase();
  req.isOwnerHost = ownerHosts.includes(host);
  req.hostTenantId = req.isOwnerHost ? null : await lookupHostTenant(host);
  next();
}

export const platformSubdomain = (slug: string) => `${slug}.${env.PLATFORM_DOMAIN}`;
