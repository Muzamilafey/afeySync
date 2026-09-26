import { meta } from '../../models/meta';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { randomToken, sha256 } from '../../utils/crypto';
import { hieRequestWithConfig } from '../../integrations/hie/hieClient';
import { resolveIntegration, type ResolvedIntegration } from '../integrations/integrationConfigService';
import { IntegrationSecretService } from '../integrations/secretService';

/**
 * Registers where the HIE pushes status changes (Status Callbacks API): one endpoint per entity type (claim,
 * preauth, authorization), each with a status_changed operation. Minors-biometrics outcomes are delivered to the
 * same registered endpoint. The URL carries AfeySync's secret path token; auth_type is `none` because the HIE
 * provisions any other credential out of band.
 *
 * Facility credentials → registered per facility. Platform credentials → registered once for the platform; the
 * receiver then identifies each facility by its Facility Registry code.
 */
export const CALLBACK_ENTITIES = ['claim', 'preauth', 'authorization'] as const;
type Entity = (typeof CALLBACK_ENTITIES)[number];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (d: unknown): Obj[] => (Array.isArray(d) ? d.filter(isObj) : isObj(d) && Array.isArray(d.data) ? (d.data as unknown[]).filter(isObj) : []);

interface Scope { tenantId: string | null; userId?: string; requestId?: string }

async function scopeConfig(scope: Scope) {
  const cfg = await resolveIntegration('sha', scope.tenantId);
  if (scope.tenantId && cfg.source !== 'tenant') {
    throw new AppError(409, 'SHA_CALLBACKS_PLATFORM_MANAGED', 'This facility uses AfeySync\'s SHA connection. Status callbacks for it are registered by AfeySync (platform owner), not per facility.');
  }
  const tenant = scope.tenantId ? await meta().Tenant.findById(scope.tenantId).select('dhaRegistry').lean() : null;
  const frCode = tenant?.dhaRegistry?.facilityRegistryCode ?? cfg.settings.facilityRegistryCode ?? undefined;
  // The HIE resolves tenants by tenant ID or tenant code (normally the client ID); listing also accepts the FR code.
  const hieTenant = cfg.settings.tenantCode || cfg.secrets.clientId;
  if (!hieTenant) throw new AppError(422, 'SHA_TENANT_CODE_REQUIRED', 'Enter the HIE tenant ID or tenant code in the SHA integration settings first.');
  return { cfg, frCode, hieTenant };
}

/** Our receiver URL for this scope; the path token is created once and kept encrypted so it can be re-registered. */
async function receiverUrl(tenantId: string | null) {
  const { CallbackEndpoint } = meta();
  let ep = await CallbackEndpoint.findOne({ provider: 'sha', tenantId, active: true, tokenEncrypted: { $exists: true } });
  let token: string;
  if (ep?.tokenEncrypted?.ciphertext) token = IntegrationSecretService.decrypt(ep.tokenEncrypted.ciphertext);
  else {
    token = randomToken(32);
    ep = await CallbackEndpoint.create({ provider: 'sha', tenantId, tokenHash: sha256(token), tokenEncrypted: IntegrationSecretService.encrypt(token), active: true });
  }
  return { ep: ep!, baseUrl: `${env.API_URL.replace(/\/$/, '')}/api/v1/sha/callbacks`, path: `/${token}` };
}

const call = (cfg: ResolvedIntegration, scope: Scope, operation: string, input: { query?: Record<string, string>; body?: unknown; pathParams?: Record<string, string> }) =>
  hieRequestWithConfig('sha', cfg, { tenantId: scope.tenantId, userId: scope.userId, requestId: scope.requestId }, { operation, ...input });

export interface CallbackState { entityType: Entity; registered: boolean; ours: boolean; isActive: boolean; endpointId?: string; operationId?: string; baseUrl?: string }

/** What the HIE currently has registered for this scope (active records only, as the list route returns). */
export async function callbackStatus(scope: Scope): Promise<{ states: CallbackState[]; receiverBase: string }> {
  const { cfg, frCode, hieTenant } = await scopeConfig(scope);
  const { baseUrl, path } = await receiverUrl(scope.tenantId);
  const r = await call(cfg, scope, 'callbacks.endpoints.list', { pathParams: { tenant_id: scope.tenantId && frCode ? frCode : hieTenant } });
  const eps = list(r.data);
  const states = CALLBACK_ENTITIES.map((entityType) => {
    const e = eps.find((x) => x.entity_type === entityType);
    const op = e && Array.isArray(e.operations) ? (e.operations as unknown[]).filter(isObj).find((o) => o.action === 'status_changed') : undefined;
    const target = op ? String(op.path_url_override || `${e!.base_url ?? ''}${op.path ?? ''}`) : '';
    return { entityType, registered: !!op, ours: target === `${baseUrl}${path}`, isActive: e?.is_active === true && op?.is_active !== false, endpointId: e ? String(e.endpoint_id) : undefined, operationId: op ? String(op.operation_id) : undefined, baseUrl: e ? String(e.base_url ?? '') : undefined };
  });
  return { states, receiverBase: baseUrl };
}

/** Creates or repoints the endpoint and status_changed operation for every entity type. Idempotent. */
export async function registerCallbacks(scope: Scope) {
  const { cfg, frCode, hieTenant } = await scopeConfig(scope);
  const { ep, baseUrl, path } = await receiverUrl(scope.tenantId);
  const environment = cfg.environment === 'production' ? 'production' : 'sandbox';
  const existing = list((await call(cfg, scope, 'callbacks.endpoints.list', { pathParams: { tenant_id: scope.tenantId && frCode ? frCode : hieTenant } })).data);
  const out: Array<{ entityType: Entity; endpointId: string; operationId: string; isActive: boolean; at: Date }> = [];
  for (const entityType of CALLBACK_ENTITIES) {
    const headers = { 'X-AfeySync-Entity': entityType };
    let e = existing.find((x) => x.entity_type === entityType);
    if (!e) {
      e = (await call(cfg, scope, 'callbacks.endpoints.register', {
        pathParams: { tenant_id: hieTenant },
        body: { auth_type: 'none', base_url: baseUrl, entity_type: entityType, environment, name: `AfeySync ${entityType} status`, ...(frCode ? { facility_fr_code: frCode } : {}), headers, timeout_ms: 30000 },
      })).data as Obj;
    } else if (e.base_url !== baseUrl || e.is_active !== true) {
      e = (await call(cfg, scope, 'callbacks.endpoints.update', { pathParams: { endpoint_id: String(e.endpoint_id) }, body: { base_url: baseUrl, is_active: true, auth_type: 'none', headers } })).data as Obj;
    }
    const endpointId = String(e.endpoint_id);
    const ops = list((await call(cfg, scope, 'callbacks.operations.list', { pathParams: { tenant_id: frCode ?? hieTenant, endpoint_id: endpointId }, query: { action: 'status_changed' } })).data);
    let op = ops[0];
    const opBody = { action: 'status_changed', method: 'POST', name: `AfeySync ${entityType} status changed`, path, request_content_type: 'application/json', headers };
    if (!op) {
      // The tenant_id segment here backfills facility_fr_code, so it must be the FR code (never a placeholder).
      op = (await call(cfg, scope, 'callbacks.operations.register', { pathParams: { tenant_id: frCode ?? hieTenant, endpoint_id: endpointId }, body: opBody })).data as Obj;
    } else if (op.path !== path || op.method !== 'POST' || op.path_url_override || op.is_active === false) {
      op = (await call(cfg, scope, 'callbacks.operations.update', { pathParams: { operation_id: String(op.operation_id) }, body: { ...opBody, path_url_override: '', is_active: true } })).data as Obj;
    }
    out.push({ entityType, endpointId, operationId: String(op.operation_id), isActive: true, at: new Date() });
  }
  ep.set('hieRegistrations', out);
  ep.set('registeredOperations', out.map((o) => `${o.entityType}:status_changed`));
  await ep.save();
  return out;
}

/** Pauses or resumes delivery without deleting the registrations. */
export async function setCallbacksActive(scope: Scope, active: boolean) {
  const { cfg } = await scopeConfig(scope);
  const ep = await meta().CallbackEndpoint.findOne({ provider: 'sha', tenantId: scope.tenantId, active: true, tokenEncrypted: { $exists: true } });
  const regs = (ep?.hieRegistrations ?? []) as Array<{ endpointId?: string | null }>;
  if (!regs.length) throw new AppError(409, 'SHA_CALLBACKS_NOT_REGISTERED', 'Register the callbacks first');
  for (const r of regs) if (r.endpointId) await call(cfg, scope, 'callbacks.endpoints.update', { pathParams: { endpoint_id: r.endpointId }, body: { is_active: active } });
  ep!.set('hieRegistrations', regs.map((r) => ({ ...(r as object), isActive: active })));
  await ep!.save();
}
