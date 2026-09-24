import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';

const baseUrl = (cfg: ResolvedIntegration) => (cfg.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const tokens = new Map<string, { token: string; exp: number }>();

/** Daraja OAuth: GET /oauth/v1/generate?grant_type=client_credentials with Basic auth. */
export async function darajaToken(cfg: ResolvedIntegration): Promise<string> {
  const key = `${cfg.configId}:${cfg.secrets.consumerKey}`;
  const hit = tokens.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const basic = Buffer.from(`${cfg.secrets.consumerKey}:${cfg.secrets.consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl(cfg)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string };
  if (!res.ok || !data.access_token) throw new AppError(502, 'MPESA_AUTH_ERROR', 'M-Pesa authentication failed');
  tokens.set(key, { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3599) * 1000 });
  return data.access_token;
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export const darajaTimestamp = (d = new Date()) => {
  const eat = new Date(d.getTime() + 3 * 3600_000); // Africa/Nairobi (UTC+3, no DST)
  return eat.toISOString().replace(/[-:TZ]/g, '').slice(0, 14);
};

/** STK Push: POST /mpesa/stkpush/v1/processrequest */
export async function stkPush(cfg: ResolvedIntegration, input: { phone: string; amount: number; accountReference: string; description: string; callbackUrl: string }) {
  const token = await darajaToken(cfg);
  const timestamp = darajaTimestamp();
  const shortcode = cfg.settings.shortcode;
  const res = await fetch(`${baseUrl(cfg)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(shortcode, cfg.secrets.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: cfg.settings.transactionType || 'CustomerPayBillOnline',
      Amount: Math.ceil(input.amount),
      PartyA: input.phone,
      PartyB: cfg.settings.till || shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok || data.ResponseCode !== '0') throw new AppError(502, 'MPESA_STK_FAILED', data.errorMessage || data.ResponseDescription || 'STK push failed');
  return { merchantRequestId: data.MerchantRequestID, checkoutRequestId: data.CheckoutRequestID, customerMessage: data.CustomerMessage };
}
