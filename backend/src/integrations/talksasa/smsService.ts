import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';

/**
 * Talksasa Bulk SMS, API v3 (https://bulksms.talksasa.com/api/v3), as documented by Talksasa:
 *   POST /sms/send  { recipient, sender_id, type: "plain", message }  → { status: "success", data } | { status: "error", message }
 *   GET  /balance   → SMS units;  GET /me → profile
 * Authentication: "Authorization: Bearer <api token>", "Accept: application/json".
 */
const DEFAULT_BASE = 'https://bulksms.talksasa.com/api/v3';
const base = (cfg: ResolvedIntegration) => (cfg.settings.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
const headers = (cfg: ResolvedIntegration) => ({ Authorization: `Bearer ${cfg.secrets.apiToken}`, Accept: 'application/json', 'Content-Type': 'application/json' });

interface TalksasaResponse { status?: string; message?: string; data?: unknown }

/** Talksasa expects international numbers without "+", e.g. 254712345678. Kenyan local forms are converted. */
export function talksasaNumber(raw: string) {
  const d = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  return d;
}

async function call(cfg: ResolvedIntegration, path: string, init: RequestInit = {}) {
  if (!cfg.secrets.apiToken) throw new AppError(503, 'SMS_AUTH_ERROR', 'Talksasa API token is not configured');
  let res: Response;
  try {
    res = await fetch(`${base(cfg)}${path}`, { ...init, headers: headers(cfg), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new AppError(502, 'SMS_PROVIDER_UNREACHABLE', 'Talksasa could not be reached');
  }
  const body = (await res.json().catch(() => ({}))) as TalksasaResponse;
  if (res.status === 401 || res.status === 403) throw new AppError(502, 'SMS_AUTH_ERROR', `Talksasa rejected the API token (HTTP ${res.status})`);
  // Talksasa reports failures in the body ({ status: "error", message }), sometimes with HTTP 200.
  if (!res.ok || body.status !== 'success') throw new AppError(502, 'SMS_PROVIDER_ERROR', `Talksasa: ${String(body.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
  return body;
}

export async function sendSms(cfg: ResolvedIntegration, to: string[], message: string) {
  if (!cfg.settings.senderId) throw new AppError(503, 'SMS_AUTH_ERROR', 'Talksasa sender ID is not configured');
  const body = await call(cfg, '/sms/send', {
    method: 'POST',
    body: JSON.stringify({ recipient: to.map(talksasaNumber).join(','), sender_id: cfg.settings.senderId, type: 'plain', message }),
  });
  return body.data ?? null;
}

/** Connection test: the account's SMS unit balance (GET /balance). */
export async function checkAccount(cfg: ResolvedIntegration) {
  const body = await call(cfg, '/balance', { method: 'GET' });
  return body.data ?? null;
}
