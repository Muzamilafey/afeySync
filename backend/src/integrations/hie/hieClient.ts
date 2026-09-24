import crypto from 'node:crypto';
import { meta } from '../../models/meta';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { resolveIntegration, type ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { getOperation } from './contractService';

/**
 * Low-level DHA HIE HTTP adapter shared by the DHA and SHA service layers.
 *  - OAuth2 client-credentials token (POST /tenants/token, x-www-form-urlencoded) with caching,
 *    single-flight renewal and early refresh.
 *  - Contract-driven operations (method/path from IntegrationContract; never hardcoded in services).
 *  - Facility headers (X-Facility-Id / X-Facility-Id-Type) when the operation requires them.
 *  - Integration log per call (no secrets, no patient payloads).
 *  - Retries only for idempotent operations on transient failures (network, 429, 502/503/504).
 */

export type HieProvider = 'sha' | 'dha';

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

export function clearTokenCache() {
  tokenCache.clear();
  inflight.clear();
}

const tokenKey = (cfg: ResolvedIntegration) =>
  crypto.createHash('sha256').update(`${cfg.configId}|${cfg.settings.baseUrl}|${cfg.secrets.clientId}|${cfg.secrets.clientSecret}`).digest('hex');

export interface HieCallContext {
  tenantId: string | null;
  userId?: string;
  branchId?: string;
  requestId?: string;
}

export interface HieRequest {
  operation: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  pathParams?: Record<string, string>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface HieResponse<T = unknown> {
  status: number;
  data: T;
  latencyMs: number;
  requestId: string;
}

const TRANSIENT = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorFor(provider: HieProvider, status: number, body: unknown): AppError {
  const P = provider.toUpperCase();
  const upstreamMsg =
    (body && typeof body === 'object' && ((body as Record<string, unknown>).message || (body as Record<string, unknown>).error_description || (body as Record<string, unknown>).detail)) ||
    undefined;
  const msg = typeof upstreamMsg === 'string' ? upstreamMsg.slice(0, 300) : undefined;
  if (status === 400 || status === 422) return new AppError(422, `${P}_VALIDATION_ERROR`, msg ?? `${P} rejected the request as invalid`);
  if (status === 401 || status === 403) return new AppError(502, `${P}_AUTH_ERROR`, `${P} authentication failed. Check the integration credentials.`);
  if (status === 404) return new AppError(404, `${P}_NOT_FOUND`, msg ?? 'No matching record found');
  if (status === 409) return new AppError(409, `${P}_DUPLICATE`, msg ?? `${P} reports a duplicate submission`);
  if (status === 503 || status === 504) return new AppError(503, `${P}_UNAVAILABLE`, `${P} service is temporarily unavailable. Please retry.`);
  if (status === 429) return new AppError(503, `${P}_RATE_LIMITED`, `${P} is rate limiting requests. Try again shortly.`);
  return new AppError(502, `${P}_UPSTREAM_ERROR`, `${P} service returned an error (HTTP ${status})`);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

async function log(provider: HieProvider, ctx: HieCallContext, entry: Record<string, unknown>) {
  try {
    await meta().IntegrationLog.create({
      provider,
      tenantId: ctx.tenantId ?? undefined,
      userId: ctx.userId,
      branchId: ctx.branchId,
      ...entry,
    });
  } catch (err) {
    logger.warn({ err }, 'integration log write failed');
  }
}

export async function fetchToken(provider: HieProvider, cfg: ResolvedIntegration, ctx: HieCallContext, force = false): Promise<string> {
  const key = tokenKey(cfg);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const op = await getOperation(provider, cfg.environment, 'auth.token');
      const url = cfg.settings.baseUrl.replace(/\/+$/, '') + op.path;
      const started = Date.now();
      const requestId = crypto.randomUUID();
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ client_id: cfg.secrets.clientId ?? '', client_secret: cfg.secrets.clientSecret ?? '' }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        await log(provider, ctx, { requestId, operation: 'auth.token', method: 'POST', path: op.path, status: 'failure', latencyMs: Date.now() - started, errorCode: 'NETWORK', errorMessage: (err as Error).message });
        throw new AppError(503, `${provider.toUpperCase()}_UNREACHABLE`, `${provider.toUpperCase()} HIE could not be reached`);
      }
      const body = (await readBody(res)) as Record<string, unknown> | null;
      const latencyMs = Date.now() - started;
      if (!res.ok || !body?.access_token) {
        await log(provider, ctx, { requestId, operation: 'auth.token', method: 'POST', path: op.path, status: 'failure', httpStatus: res.status, latencyMs, errorCode: `${provider.toUpperCase()}_AUTH_ERROR` });
        throw new AppError(502, `${provider.toUpperCase()}_AUTH_ERROR`, `${provider.toUpperCase()} authentication failed. Check the client ID/secret and environment.`);
      }
      await log(provider, ctx, { requestId, operation: 'auth.token', method: 'POST', path: op.path, status: 'success', httpStatus: res.status, latencyMs });
      const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 300;
      const tok = { token: String(body.access_token), expiresAt: Date.now() + expiresIn * 1000 };
      tokenCache.set(key, tok);
      return tok;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return (await pending).token;
}

/** Token status for the owner/admin health pages (never returns the token itself). */
export function tokenStatus(cfg: ResolvedIntegration) {
  const t = tokenCache.get(tokenKey(cfg));
  return t ? { valid: t.expiresAt > Date.now(), expiresAt: new Date(t.expiresAt) } : { valid: false };
}

export async function hieRequest<T = unknown>(provider: HieProvider, ctx: HieCallContext, req: HieRequest): Promise<HieResponse<T>> {
  const cfg = await resolveIntegration(provider, ctx.tenantId);
  return hieRequestWithConfig<T>(provider, cfg, ctx, req);
}

export async function hieRequestWithConfig<T = unknown>(provider: HieProvider, cfg: ResolvedIntegration, ctx: HieCallContext, req: HieRequest): Promise<HieResponse<T>> {
  const op = await getOperation(provider, cfg.environment, req.operation);
  let path = op.path!;
  for (const [k, v] of Object.entries(req.pathParams ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(v));
  if (/\{[^}]+\}/.test(path)) throw new AppError(400, 'VALIDATION_ERROR', `Missing path parameter for ${req.operation}`);
  const url = new URL(cfg.settings.baseUrl.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const maxAttempts = op.idempotent ? 3 : 1;
  const requestId = ctx.requestId ? `${ctx.requestId}:${crypto.randomUUID().slice(0, 8)}` : crypto.randomUUID();
  let attempt = 0;
  let forcedRefresh = false;

  while (true) {
    attempt += 1;
    const token = await fetchToken(provider, cfg, ctx, forcedRefresh);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Request-Id': requestId };
    if (req.body !== undefined) headers['Content-Type'] = op.contentType ?? 'application/json';
    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    if (op.requiresFacilityHeaders && cfg.settings.facilityRegistryCode) {
      headers['X-Facility-Id'] = cfg.settings.facilityRegistryCode;
      headers['X-Facility-Id-Type'] = cfg.settings.facilityIdType || 'fr-code';
    }
    const started = Date.now();
    let res: Response | null = null;
    let networkError: Error | null = null;
    try {
      res = await fetch(url, {
        method: op.method,
        headers,
        body: req.body === undefined ? undefined : op.contentType === 'application/x-www-form-urlencoded' ? new URLSearchParams(req.body as Record<string, string>) : JSON.stringify(req.body),
        signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
      });
    } catch (err) {
      networkError = err as Error;
    }
    const latencyMs = Date.now() - started;
    const base = { requestId, operation: req.operation, method: op.method, path: op.path ?? undefined, latencyMs, retryCount: attempt - 1 };

    if (networkError) {
      await log(provider, ctx, { ...base, status: 'failure', errorCode: 'NETWORK', errorMessage: networkError.message.slice(0, 200) });
      if (attempt < maxAttempts) {
        await sleep(2 ** attempt * 250);
        continue;
      }
      throw new AppError(503, `${provider.toUpperCase()}_UNREACHABLE`, `${provider.toUpperCase()} HIE could not be reached. Please retry.`);
    }

    const body = await readBody(res!);
    if (res!.status === 401 && !forcedRefresh) {
      // Token revoked/expired early: renew once.
      forcedRefresh = true;
      attempt -= 1;
      continue;
    }
    if (!res!.ok) {
      const err = errorFor(provider, res!.status, body);
      await log(provider, ctx, { ...base, status: 'failure', httpStatus: res!.status, errorCode: err.code, errorMessage: err.message });
      if (TRANSIENT.has(res!.status) && attempt < maxAttempts) {
        const retryAfter = Number(res!.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2 ** attempt * 250);
        continue;
      }
      throw err;
    }
    const externalReference = body && typeof body === 'object' ? String((body as Record<string, unknown>).id ?? (body as Record<string, unknown>).reference ?? '') || undefined : undefined;
    await log(provider, ctx, { ...base, status: 'success', httpStatus: res!.status, externalReference });
    return { status: res!.status, data: body as T, latencyMs, requestId };
  }
}
