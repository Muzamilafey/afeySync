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

/** Addresses of this computer: always the main sign-in page, whatever NODE_ENV or PLATFORM_DOMAIN say. */
export const isLoopbackHost = (host: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes((host || '').toLowerCase());

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
  // <slug>.localhost only ever reaches the API from the same computer, so it is safe in every mode.
  const suffixes = [env.PLATFORM_DOMAIN.toLowerCase(), 'localhost'];
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
    return `We couldn't tell which facility this page belongs to. Please sign in on the main page, or open your facility's own address. If this keeps happening, ask your administrator to check the server's TRUST_PROXY setting.`;
  }
  const slug = slugFromHost(host);
  if (slug) {
    const { Tenant, FacilityApplication } = meta();
    const tenant = await Tenant.findOne({ slug }).select('status name').lean();
    if (tenant?.status === 'suspended') return `${tenant.name} is currently paused. Please contact AfeySync support to restore access.`;
    if (tenant && tenant.status !== 'active') return `${tenant.name} is still being set up. Please try again in a few minutes.`;
    const app = await FacilityApplication.findOne({ slug }).sort({ createdAt: -1 }).select('status facility.name').lean();
    if (app?.status === 'submitted') return `${app.facility?.name ?? slug} is registered but waiting for approval by AfeySync. You'll get an email as soon as it's ready.`;
    if (app?.status === 'email_pending') return `The registration for ${app.facility?.name ?? slug} isn't confirmed yet. Please finish the email verification step on the registration page.`;
    if (app?.status === 'rejected') return `The registration for ${app.facility?.name ?? slug} wasn't approved. Please contact AfeySync support for details.`;
  }
  return `We couldn't find a facility at ${host}. Please check the address, or sign in on the main page and we'll take you to your facility.`;
}
