import type { Provider } from '../../models/meta';
import { meta } from '../../models/meta';
import { AppError, badRequest } from '../../utils/errors';
import { fetchToken, hieRequestWithConfig } from '../../integrations/hie/hieClient';
import { createTransport, sendMail } from '../../integrations/smtp/smtpService';
import { checkAccount } from '../../integrations/africastalking/smsService';
import { darajaToken } from '../../integrations/mpesa/mpesaService';
import { IntegrationSecretService, type EncryptedValue } from './secretService';
import { recordHealth, type ResolvedIntegration } from './integrationConfigService';
import { PROVIDER_DEFINITIONS } from './providers';
import { defaultRedirectUri, discovery } from '../auth/google/googleOidc';

/** Materialize a config document for testing even if it is not yet enabled. */
export async function loadConfigForTest(scope: 'platform' | 'tenant', provider: Provider, tenantId: string | null): Promise<ResolvedIntegration> {
  const doc = await meta().IntegrationConfig.findOne({ scope, tenantId, provider });
  if (!doc) throw badRequest('Save the configuration before testing it', undefined, 'INTEGRATION_NOT_CONFIGURED');
  const def = PROVIDER_DEFINITIONS[provider];
  const defaults: Record<string, string> = {};
  for (const s of def.settings) if (s.default) defaults[s.key] = s.default;
  const base = def.defaultBaseUrls?.[(doc.environment ?? 'uat') as 'uat'];
  if (base) defaults.baseUrl = base;
  const secrets: Record<string, string> = {};
  for (const [k, v] of (doc.secrets as unknown as Map<string, EncryptedValue>) ?? new Map()) secrets[k] = IntegrationSecretService.decrypt(v);
  return { provider, source: scope, configId: String(doc._id), environment: doc.environment ?? 'uat', settings: { ...defaults, ...(doc.settings as Record<string, string>) }, secrets };
}

export type TestKind = 'auth' | 'registry' | 'eligibility' | 'terminology' | 'email';

export async function testIntegration(cfg: ResolvedIntegration, kind: TestKind = 'auth', opts: { tenantId?: string | null; to?: string; sample?: { type: string; number: string } } = {}) {
  const started = Date.now();
  const ctx = { tenantId: opts.tenantId ?? null };
  try {
    let detail: Record<string, unknown> = {};
    switch (cfg.provider) {
      case 'dha':
      case 'sha': {
        await fetchToken(cfg.provider, cfg, ctx, true);
        detail.token = 'VALID';
        if (kind === 'registry' || kind === 'eligibility') {
          if (!opts.sample) throw badRequest('Provide a sample identification type and number for this test');
          const op = kind === 'registry' ? 'registry.client.search' : 'sha.eligibility';
          const res = await hieRequestWithConfig(cfg.provider, cfg, ctx, { operation: op, query: { identification_type: opts.sample.type, identification_number: opts.sample.number } }).catch((e: AppError) => {
            if (e.code?.endsWith('_NOT_FOUND')) return { status: 404 };
            throw e;
          });
          detail[kind] = `HTTP ${res.status}`;
        }
        if (kind === 'terminology') {
          await hieRequestWithConfig(cfg.provider, cfg, ctx, { operation: 'terminology.search', query: { q: 'malaria' } });
          detail.terminology = 'OK';
        }
        detail.facility = cfg.settings.facilityRegistryCode ? 'CONFIGURED' : 'NOT SET';
        break;
      }
      case 'google': {
        if (!cfg.settings.clientId || !cfg.secrets.clientSecret) throw badRequest('Client ID and secret are required');
        const d = await discovery({ clientId: cfg.settings.clientId, clientSecret: cfg.secrets.clientSecret, discoveryUrl: cfg.settings.discoveryUrl, redirectUri: cfg.settings.redirectUri || defaultRedirectUri() });
        detail = { issuer: d.issuer, redirectUri: cfg.settings.redirectUri || defaultRedirectUri(), note: 'Discovery OK. Complete a real sign-in to verify the client credentials.' };
        break;
      }
      case 'smtp': {
        await createTransport(cfg).verify();
        if (kind === 'email') {
          if (!opts.to) throw badRequest('Recipient email required');
          const r = await sendMail(cfg, { to: opts.to, subject: 'AfeySync SMTP test', text: 'This is a test email from AfeySync. Your SMTP configuration works.' });
          detail.messageId = r.messageId;
        }
        break;
      }
      case 'africastalking':
        await checkAccount(cfg);
        break;
      case 'mpesa':
        await darajaToken(cfg);
        detail.token = 'VALID';
        break;
      default:
        break;
    }
    const latencyMs = Date.now() - started;
    await recordHealth(cfg.configId, true, latencyMs);
    return { ok: true, latencyMs, ...detail };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof AppError ? err.message : 'Connection test failed';
    await recordHealth(cfg.configId, false, latencyMs, err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message);
    if (err instanceof AppError && err.status === 400) throw err;
    return { ok: false, latencyMs, error: { code: err instanceof AppError ? err.code : 'TEST_FAILED', message } };
  }
}
