import crypto from 'node:crypto';
import { meta } from '../../models/meta';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { resolveIntegration, type ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { getOperation } from '../hie/contractService';

/**
 * Slade360 / HealthCloud provider EDI client (server-side only). Credentials are the facility's own,
 * encrypted at rest and never returned to the browser. OAuth tokens are cached per configuration;
 * a 401 invalidates the token and the request is retried exactly once.
 */
export interface SladeCtx { tenantId: string; userId?: string; branchId?: string; requestId?: string }
export interface SladeRequest { operation: string; query?: Record<string, string | number | undefined>; pathParams?: Record<string, string>; body?: unknown; idempotencyKey?: string }

const SANDBOX_AUTH_URL = 'https://accounts.multitenant.slade360.co.ke/oauth2/token/';
const tokens = new Map<string, { token: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

export function clearSladeTokens() {
  tokens.clear();
  inflight.clear();
}

export async function sladeConfig(tenantId: string): Promise<ResolvedIntegration> {
  let cfg: ResolvedIntegration;
  try {
    cfg = await resolveIntegration('slade360', tenantId);
  } catch (err) {
    if (err instanceof AppError) throw new AppError(err.status, err.code, err.message.replace('Slade360 / HealthCloud (private insurance EDI)', 'Slade360'));
    throw err;
  }
  if (!cfg.secrets.clientId || !cfg.secrets.clientSecret || !cfg.settings.grantType) {
    throw new AppError(503, 'SLADE_NOT_CONFIGURED', 'Slade360 credentials are not configured for this facility (Admin → Integrations → Slade360).');
  }
  return cfg;
}

const authUrl = (cfg: ResolvedIntegration) => cfg.settings.authUrl || (cfg.environment === 'sandbox' ? SANDBOX_AUTH_URL : '');

async function log(ctx: SladeCtx, entry: Record<string, unknown>) {
  try {
    await meta().IntegrationLog.create({ provider: 'slade360', tenantId: ctx.tenantId, userId: ctx.userId, branchId: ctx.branchId, ...entry });
  } catch (err) {
    logger.warn({ err }, 'integration log write failed');
  }
}

export async function sladeToken(cfg: ResolvedIntegration, ctx: SladeCtx, force = false): Promise<string> {
  const key = `${cfg.configId}:${cfg.secrets.clientId}`;
  const hit = tokens.get(key);
  if (!force && hit && hit.exp - 60_000 > Date.now()) return hit.token;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const url = authUrl(cfg);
      if (!url) throw new AppError(503, 'SLADE_NOT_CONFIGURED', 'The Slade360 token URL is not configured for production.');
      const form = new URLSearchParams({ grant_type: cfg.settings.grantType, client_id: cfg.secrets.clientId, client_secret: cfg.secrets.clientSecret });
      if (cfg.secrets.username) form.set('username', cfg.secrets.username);
      if (cfg.secrets.password) form.set('password', cfg.secrets.password);
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        await log(ctx, { operation: 'auth.token', method: 'POST', status: 'failure', errorCode: 'NETWORK', errorMessage: (err as Error).message.slice(0, 200), latencyMs: Date.now() - started, requestId: crypto.randomUUID() });
        throw new AppError(503, 'SLADE_UNREACHABLE', 'Slade360 could not be reached');
      }
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      await log(ctx, { operation: 'auth.token', method: 'POST', status: res.ok && body.access_token ? 'success' : 'failure', httpStatus: res.status, latencyMs: Date.now() - started, requestId: crypto.randomUUID() });
      if (!res.ok || !body.access_token) throw new AppError(502, 'SLADE_AUTH_ERROR', 'Slade360 authentication failed. Check the facility credentials, grant type and environment.');
      tokens.set(key, { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 });
      return body.access_token;
    })().finally(() => inflight.delete(key)));
  }
  return inflight.get(key)!;
}

function mapError(status: number, body: unknown): AppError {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const detail = [o.detail, o.message, o.error, Array.isArray(o.non_field_errors) ? o.non_field_errors.join('; ') : undefined].find((x) => typeof x === 'string') as string | undefined;
  const fieldErrors = Object.entries(o).filter(([k, v]) => Array.isArray(v) && k !== 'non_field_errors').map(([k, v]) => `${k}: ${(v as unknown[]).join(', ')}`).join('; ');
  const msg = (detail ?? fieldErrors) || `Slade360 responded ${status}`;
  if (status === 400 || status === 422) return new AppError(422, 'SLADE_VALIDATION_ERROR', msg, o);
  if (status === 401 || status === 403) return new AppError(502, 'SLADE_AUTH_ERROR', msg);
  if (status === 404) return new AppError(404, 'SLADE_NOT_FOUND', msg);
  if (status === 409) return new AppError(409, 'SLADE_DUPLICATE', msg);
  if (status === 429) return new AppError(429, 'SLADE_RATE_LIMITED', 'Slade360 rate limit reached. Retry shortly.');
  return new AppError(503, 'SLADE_UNAVAILABLE', msg);
}

export async function sladeRequest<T = unknown>(ctx: SladeCtx, req: SladeRequest, cfgIn?: ResolvedIntegration): Promise<T> {
  const cfg = cfgIn ?? (await sladeConfig(ctx.tenantId));
  const op = await getOperation('slade360', cfg.environment, req.operation);
  let path = op.path!;
  for (const [k, v] of Object.entries(req.pathParams ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(v));
  if (/\{[^}]+\}/.test(path)) throw new AppError(400, 'VALIDATION_ERROR', `Missing path parameter for ${req.operation}`);
  const url = new URL(cfg.settings.baseUrl.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const multipart = req.body instanceof FormData;
  const requestId = ctx.requestId ? `${ctx.requestId}:${crypto.randomUUID().slice(0, 8)}` : crypto.randomUUID();
  let forced = false;
  for (let attempt = 1; ; attempt += 1) {
    const token = await sladeToken(cfg, ctx, forced);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Request-Id': requestId };
    if (req.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { method: op.method, headers, body: req.body === undefined ? undefined : multipart ? (req.body as FormData) : JSON.stringify(req.body), signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      await log(ctx, { requestId, operation: req.operation, method: op.method, path: op.path, status: 'failure', errorCode: 'NETWORK', latencyMs: Date.now() - started, retryCount: attempt - 1 });
      if (op.idempotent && attempt < 2) continue;
      throw new AppError(503, 'SLADE_UNREACHABLE', 'Slade360 could not be reached. Please retry.');
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    await log(ctx, { requestId, operation: req.operation, method: op.method, path: op.path, status: res.ok ? 'success' : 'failure', httpStatus: res.status, latencyMs: Date.now() - started, retryCount: attempt - 1 });
    if (res.status === 401 && !forced) {
      forced = true; // token expired or revoked: refresh once
      continue;
    }
    if (res.ok) {
      await meta().IntegrationConfig.updateOne({ _id: cfg.configId }, { 'health.lastSuccessAt': new Date(), 'health.status': 'connected' }).catch(() => null);
      return body as T;
    }
    if (op.idempotent && res.status >= 502 && attempt < 2) continue;
    await meta().IntegrationConfig.updateOne({ _id: cfg.configId }, { 'health.lastFailureAt': new Date(), 'health.lastError': `HTTP ${res.status}` }).catch(() => null);
    throw mapError(res.status, body);
  }
}
