import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';

const baseUrl = (cfg: ResolvedIntegration) =>
  cfg.environment === 'production' ? 'https://api.africastalking.com' : 'https://api.sandbox.africastalking.com';

/** Africa's Talking SMS: POST /version1/messaging (form-encoded, apiKey header). */
export async function sendSms(cfg: ResolvedIntegration, to: string[], message: string) {
  const body = new URLSearchParams({ username: cfg.settings.username, to: to.join(','), message });
  if (cfg.settings.senderId) body.set('from', cfg.settings.senderId);
  const res = await fetch(`${baseUrl(cfg)}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: cfg.secrets.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: Array<{ status: string; messageId: string; number: string }> } };
  if (!res.ok) throw new AppError(502, 'SMS_PROVIDER_ERROR', `SMS provider returned HTTP ${res.status}`);
  return data.SMSMessageData?.Recipients ?? [];
}

/** Connectivity/credential check: GET /version1/user?username=... */
export async function checkAccount(cfg: ResolvedIntegration) {
  const res = await fetch(`${baseUrl(cfg)}/version1/user?username=${encodeURIComponent(cfg.settings.username)}`, {
    headers: { apiKey: cfg.secrets.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AppError(502, 'SMS_AUTH_ERROR', `Africa's Talking returned HTTP ${res.status}`);
  return true;
}
