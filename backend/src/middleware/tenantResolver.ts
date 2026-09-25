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
  if (!tenantId) {
    // <slug>.<PLATFORM_DOMAIN> always means that facility, even if it was created under a different
    // platform domain (e.g. before PLATFORM_DOMAIN was changed). In development <slug>.localhost works too.
    const slug = slugFromHost(host);
    if (slug) {
      const t = await meta().Tenant.findOne({ slug }).select('_id').lean();
      if (t) tenantId = String(t._id);
    }
  }
  cache.set(host, { tenantId, exp: Date.now() + TTL_MS });
  return tenantId;
}

export function slugFromHost(host: string): string | null {
  const suffixes = [env.PLATFORM_DOMAIN.toLowerCase()];
  if (env.NODE_ENV !== 'production') suffixes.push('localhost');
  for (const apex of suffixes) {
    if (!host.endsWith(`.${apex}`)) continue;
    const sub = host.slice(0, -(apex.length + 1));
    if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(sub)) return sub;
  }
  return null;
}

export async function resolveTenantHost(req: Request, _res: Response, next: NextFunction) {
  const host = (req.hostname || '').toLowerCase();
  req.isOwnerHost = ownerHosts.includes(host);
  req.hostTenantId = req.isOwnerHost ? null : await lookupHostTenant(host);
  next();
}

export const platformSubdomain = (slug: string) => `${slug}.${env.PLATFORM_DOMAIN}`;

/**
 * A helpful explanation when an address does not belong to an active facility (shown on sign-in and
 * password-reset pages instead of a bare "not resolved").
 */
export async function explainUnknownHost(rawHost: string): Promise<string> {
  const host = (rawHost || '').toLowerCase();
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === '::1' || host === 'localhost') {
    return `This page could not tell which facility you are on (the API received the address "${host || 'none'}"). Open your facility's own address, for example http://<facility>.localhost:3000 during development. If you already are, check that TRUST_PROXY in the API .env allows the frontend proxy (the default "loopback" works when both run on the same computer).`;
  }
  const slug = slugFromHost(host);
  if (slug) {
    const { Tenant, FacilityApplication } = meta();
    const tenant = await Tenant.findOne({ slug }).select('status name').lean();
    if (tenant?.status === 'suspended') return `${tenant.name} is suspended. Contact AfeySync support.`;
    if (tenant && tenant.status !== 'active') return `${tenant.name} is still being set up. Try again in a moment.`;
    const app = await FacilityApplication.findOne({ slug }).sort({ createdAt: -1 }).select('status facility.name').lean();
    if (app?.status === 'submitted') return `${app.facility?.name ?? slug} is registered but waiting for approval by AfeySync, so it cannot be used yet. The platform owner approves it in Owner → Registrations; you will get an email when it is ready.`;
    if (app?.status === 'email_pending') return `The registration for ${app.facility?.name ?? slug} has not been confirmed yet. Finish the email verification on the registration page.`;
    if (app?.status === 'rejected') return `The registration for ${app.facility?.name ?? slug} was not approved.`;
  }
  return `No facility uses the address ${host}. Check the address, or sign in on the main page and we will take you to your facility.`;
}
