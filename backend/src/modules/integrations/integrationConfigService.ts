import { env } from '../../config/env';
import { meta, PROVIDERS, type Provider } from '../../models/meta';
import { AppError, badRequest, forbidden } from '../../utils/errors';
import { IntegrationSecretService, type EncryptedValue } from './secretService';
import { PROVIDER_DEFINITIONS } from './providers';

export const DISABLED_MESSAGE = 'This integration is currently disabled by AfeySync platform administration.';

export interface ResolvedIntegration {
  provider: Provider;
  source: 'tenant' | 'platform';
  configId: string;
  environment: string;
  settings: Record<string, string>;
  secrets: Record<string, string>;
}

type ConfigDoc = NonNullable<Awaited<ReturnType<ReturnType<typeof meta>['IntegrationConfig']['findOne']>>>;

function secretsMap(doc: ConfigDoc): Map<string, EncryptedValue> {
  return (doc.secrets as unknown as Map<string, EncryptedValue>) ?? new Map();
}

/** Browser-safe view of a configuration. Secrets are reduced to "configured" + a masked hint. */
export function toPublicConfig(doc: ConfigDoc | null, provider: Provider) {
  const def = PROVIDER_DEFINITIONS[provider];
  const secrets = doc ? secretsMap(doc) : new Map<string, EncryptedValue>();
  return {
    provider,
    label: def.label,
    platformOnly: Boolean(def.platformOnly),
    exists: Boolean(doc),
    enabled: doc?.enabled ?? false,
    environment: doc?.environment ?? def.environments[0],
    environments: def.environments,
    settings: { ...(doc?.settings ?? {}) },
    settingFields: def.settings,
    secretFields: def.secrets.map((s) => ({ ...s, ...IntegrationSecretService.mask(secrets.get(s.key)) })),
    allowTenantCredentials: doc?.allowTenantCredentials ?? false,
    useTenantConfig: doc?.useTenantConfig ?? false,
    health: doc?.health ?? { status: 'unknown' },
    updatedAt: (doc as unknown as { updatedAt?: Date })?.updatedAt,
  };
}

export function assertProvider(p: string): Provider {
  if (!(PROVIDERS as readonly string[]).includes(p)) throw badRequest('Unknown integration provider');
  return p as Provider;
}

function validateUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest(`${label} must be a valid URL`);
  }
  const localDev = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localDev) throw badRequest(`${label} must use HTTPS`);
}

export interface ConfigUpdate {
  enabled?: boolean;
  environment?: 'sandbox' | 'uat' | 'production';
  settings?: Record<string, string>;
  /** Only provided keys are replaced; empty string clears a secret. Omitted keys are kept. */
  secrets?: Record<string, string>;
  allowTenantCredentials?: boolean;
  useTenantConfig?: boolean;
}

export async function upsertConfig(scope: 'platform' | 'tenant', provider: Provider, tenantId: string | null, update: ConfigUpdate, actorId?: string) {
  const def = PROVIDER_DEFINITIONS[provider];
  const { IntegrationConfig } = meta();
  let doc = await IntegrationConfig.findOne({ scope, tenantId, provider });
  const before = doc ? toPublicConfig(doc, provider) : null;
  if (!doc) doc = new IntegrationConfig({ scope, tenantId, provider, settings: {}, secrets: {} });

  if (update.environment) {
    if (!def.environments.includes(update.environment)) throw badRequest(`Environment ${update.environment} is not supported for ${def.label}`);
    doc.environment = update.environment;
  }
  if (update.settings) {
    const allowed = new Set(def.settings.map((s) => s.key));
    const next: Record<string, string> = { ...(doc.settings ?? {}) };
    for (const [k, v] of Object.entries(update.settings)) {
      if (!allowed.has(k)) throw badRequest(`Unknown setting "${k}" for ${def.label}`);
      if (typeof v !== 'string') throw badRequest(`Setting "${k}" must be a string`);
      if (v && /url$/i.test(k)) validateUrl(v, k);
      next[k] = v.trim();
    }
    doc.settings = next;
    doc.markModified('settings');
  }
  if (update.secrets) {
    const allowed = new Set(def.secrets.map((s) => s.key));
    const map = secretsMap(doc);
    for (const [k, v] of Object.entries(update.secrets)) {
      if (!allowed.has(k)) throw badRequest(`Unknown secret "${k}" for ${def.label}`);
      if (v === '') map.delete(k);
      else if (typeof v === 'string') map.set(k, IntegrationSecretService.encrypt(v));
    }
    doc.markModified('secrets');
  }
  if (scope === 'platform' && update.allowTenantCredentials !== undefined) doc.allowTenantCredentials = update.allowTenantCredentials;
  if (scope === 'platform' && def.facilityCredentialsOnly) doc.allowTenantCredentials = true;
  if (def.platformOnly) {
    if (scope !== 'platform') throw forbidden('This integration belongs to the platform owner', 'PLATFORM_ONLY_INTEGRATION');
    doc.allowTenantCredentials = false;
  }
  if (scope === 'tenant' && update.useTenantConfig !== undefined) doc.useTenantConfig = update.useTenantConfig;
  if (update.enabled !== undefined) {
    if (update.enabled && !(scope === 'platform' && def.facilityCredentialsOnly)) {
      const settings = { ...defaultsFor(provider, doc.environment ?? def.environments[0]), ...(doc.settings ?? {}) };
      const missing = [
        ...def.settings.filter((s) => s.required && !settings[s.key]).map((s) => s.label),
        ...def.secrets.filter((s) => s.required && !secretsMap(doc!).has(s.key)).map((s) => s.label),
      ];
      if (missing.length) throw badRequest(`Cannot enable ${def.label}: missing ${missing.join(', ')}`);
    }
    doc.enabled = update.enabled;
  }
  if (actorId) doc.updatedBy = actorId as never;
  await doc.save();
  return { before, after: toPublicConfig(doc, provider), doc };
}

function defaultsFor(provider: Provider, environment: string): Record<string, string> {
  const def = PROVIDER_DEFINITIONS[provider];
  const out: Record<string, string> = {};
  for (const s of def.settings) if (s.default) out[s.key] = s.default;
  const base = def.defaultBaseUrls?.[environment as 'uat'];
  if (base) out.baseUrl = base;
  return out;
}

function materialize(doc: ConfigDoc, provider: Provider, source: 'tenant' | 'platform'): ResolvedIntegration {
  const secrets: Record<string, string> = {};
  for (const [k, v] of secretsMap(doc)) secrets[k] = IntegrationSecretService.decrypt(v);
  return {
    provider,
    source,
    configId: String(doc._id),
    environment: doc.environment ?? 'uat',
    settings: { ...defaultsFor(provider, doc.environment ?? 'uat'), ...((doc.settings as Record<string, string>) ?? {}) },
    secrets,
  };
}

/**
 * Credential resolution priority:
 *   1. tenant-specific credential (only if the platform allows it and the tenant opted in)
 *   2. platform credential
 *   3. provider disabled
 * The platform switch always wins: a globally disabled provider is disabled for every tenant.
 */
export async function resolveIntegration(provider: Provider, tenantId: string | null): Promise<ResolvedIntegration> {
  const { IntegrationConfig, Tenant } = meta();
  const platform = await IntegrationConfig.findOne({ scope: 'platform', tenantId: null, provider });
  if (!platform?.enabled) throw new AppError(503, 'INTEGRATION_DISABLED', DISABLED_MESSAGE);
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).select('integrations').lean();
    const flags = (tenant?.integrations ?? {}) as Record<string, boolean>;
    if (provider !== 'storage' && !flags[provider]) {
      throw new AppError(503, 'INTEGRATION_NOT_ENABLED_FOR_FACILITY', `${PROVIDER_DEFINITIONS[provider].label} is not enabled for this facility. Contact AfeySync platform administration.`);
    }
    if (platform.allowTenantCredentials) {
      const tenantCfg = await IntegrationConfig.findOne({ scope: 'tenant', tenantId, provider });
      if (tenantCfg?.enabled && tenantCfg.useTenantConfig) return materialize(tenantCfg, provider, 'tenant');
    }
  }
  return materialize(platform, provider, 'platform');
}

/** What a facility is allowed to see about integrations: enablement only, never credentials. */
export async function integrationStatusForTenant(tenantId: string) {
  const { IntegrationConfig, Tenant } = meta();
  const [platformCfgs, tenant, tenantCfgs] = await Promise.all([
    IntegrationConfig.find({ scope: 'platform', tenantId: null }).select('provider enabled allowTenantCredentials health.status').lean(),
    Tenant.findById(tenantId).select('integrations').lean(),
    IntegrationConfig.find({ scope: 'tenant', tenantId }).select('provider enabled useTenantConfig').lean(),
  ]);
  const flags = (tenant?.integrations ?? {}) as Record<string, boolean>;
  const out: Record<string, { enabled: boolean; message?: string; tenantCredentialsAllowed: boolean; usingFacilityConfig: boolean; health?: string }> = {};
  for (const provider of ['sha', 'dha', 'mpesa', 'africastalking', 'talksasa', 'smtp', 'slade360'] as const) {
    const p = platformCfgs.find((c) => c.provider === provider);
    const t = tenantCfgs.find((c) => c.provider === provider);
    const enabled = Boolean(p?.enabled && flags[provider]);
    out[provider] = {
      enabled,
      message: !p?.enabled ? DISABLED_MESSAGE : !flags[provider] ? 'Not enabled for this facility.' : undefined,
      tenantCredentialsAllowed: Boolean(p?.allowTenantCredentials),
      usingFacilityConfig: Boolean(p?.allowTenantCredentials && t?.enabled && t?.useTenantConfig),
      health: p?.health?.status,
    };
  }
  return out;
}

export async function assertTenantCredentialsAllowed(provider: Provider) {
  if (PROVIDER_DEFINITIONS[provider].platformOnly) throw forbidden('This integration belongs to the platform owner', 'PLATFORM_ONLY_INTEGRATION');
  const platform = await meta().IntegrationConfig.findOne({ scope: 'platform', tenantId: null, provider }).lean();
  if (!platform?.allowTenantCredentials) throw forbidden('Facility-level credentials are not permitted for this integration', 'TENANT_CREDENTIALS_NOT_ALLOWED');
}

export async function recordHealth(configId: string, ok: boolean, latencyMs: number, error?: string) {
  const now = new Date();
  await meta().IntegrationConfig.updateOne(
    { _id: configId },
    {
      $set: {
        'health.status': ok ? 'connected' : 'failed',
        'health.lastTestAt': now,
        'health.lastLatencyMs': latencyMs,
        ...(ok ? { 'health.lastSuccessAt': now, 'health.lastError': null } : { 'health.lastFailureAt': now, 'health.lastError': error?.slice(0, 300) }),
      },
    },
  );
}

/** Import bootstrap credentials from environment variables into encrypted platform config (first boot only). */
export async function bootstrapPlatformConfigsFromEnv() {
  const { IntegrationConfig } = meta();
  const candidates: Array<{ provider: Provider; settings: Record<string, string | undefined>; secrets: Record<string, string | undefined>; environment?: string }> = [
    { provider: 'dha', settings: { baseUrl: env.DHA_BASE_URL, facilityRegistryCode: env.DHA_FACILITY_ID, facilityIdType: env.DHA_FACILITY_ID_TYPE }, secrets: { clientId: env.DHA_CLIENT_ID, clientSecret: env.DHA_CLIENT_SECRET } },
    { provider: 'sha', settings: { baseUrl: env.SHA_BASE_URL, facilityRegistryCode: env.SHA_FACILITY_ID }, secrets: { clientId: env.SHA_CLIENT_ID, clientSecret: env.SHA_CLIENT_SECRET } },
    { provider: 'mpesa', environment: env.MPESA_ENVIRONMENT, settings: { shortcode: env.MPESA_SHORTCODE, till: env.MPESA_TILL, paybill: env.MPESA_PAYBILL }, secrets: { consumerKey: env.MPESA_CONSUMER_KEY, consumerSecret: env.MPESA_CONSUMER_SECRET, passkey: env.MPESA_PASSKEY } },
    { provider: 'africastalking', settings: { username: env.AT_USERNAME, senderId: env.AT_SENDER_ID }, secrets: { apiKey: env.AT_API_KEY } },
    { provider: 'talksasa', environment: 'production', settings: { baseUrl: env.TALKSASA_BASE_URL, senderId: env.TALKSASA_SENDER_ID }, secrets: { apiToken: env.TALKSASA_API_TOKEN } },
    { provider: 'smtp', settings: { host: env.SMTP_HOST, port: env.SMTP_PORT, encryption: env.SMTP_ENCRYPTION, fromEmail: env.SMTP_FROM }, secrets: { username: env.SMTP_USERNAME, password: env.SMTP_PASSWORD } },
  ];
  for (const c of candidates) {
    const secrets = Object.fromEntries(Object.entries(c.secrets).filter(([, v]) => v)) as Record<string, string>;
    if (!Object.keys(secrets).length) continue;
    if (await IntegrationConfig.exists({ scope: 'platform', tenantId: null, provider: c.provider })) continue;
    const settings = Object.fromEntries(Object.entries(c.settings).filter(([, v]) => v)) as Record<string, string>;
    const environment = (['sandbox', 'uat', 'production'].includes(c.environment ?? '') ? c.environment : undefined) as ConfigUpdate['environment'];
    await upsertConfig('platform', c.provider, null, { settings, secrets, environment });
  }
}
