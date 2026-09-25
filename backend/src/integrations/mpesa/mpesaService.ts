import crypto from 'node:crypto';
import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';

const baseUrl = (cfg: ResolvedIntegration) => (cfg.settings.baseUrl || (cfg.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke')).replace(/\/+$/, '');
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

/** STK Push status query: POST /mpesa/stkpushquery/v1/query */
export async function stkQuery(cfg: ResolvedIntegration, checkoutRequestId: string) {
  const token = await darajaToken(cfg);
  const timestamp = darajaTimestamp();
  const res = await fetch(`${baseUrl(cfg)}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: cfg.settings.shortcode, Password: stkPassword(cfg.settings.shortcode, cfg.secrets.passkey, timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok && !data.ResultCode) throw new AppError(502, 'MPESA_QUERY_FAILED', data.errorMessage || 'STK query failed');
  return { resultCode: data.ResultCode !== undefined ? Number(data.ResultCode) : undefined, resultDesc: data.ResultDesc };
}

/** C2B URL registration: POST /mpesa/c2b/v1/registerurl */
export async function registerC2BUrls(cfg: ResolvedIntegration, confirmationUrl: string, validationUrl: string) {
  const token = await darajaToken(cfg);
  const res = await fetch(`${baseUrl(cfg)}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ShortCode: cfg.settings.paybill || cfg.settings.till || cfg.settings.shortcode, ResponseType: 'Completed', ConfirmationURL: confirmationUrl, ValidationURL: validationUrl }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) throw new AppError(502, 'MPESA_C2B_REGISTER_FAILED', data.errorMessage || `HTTP ${res.status}`);
  return data;
}

/**
 * SecurityCredential for B2C: the initiator password encrypted with Safaricom's public certificate
 * (RSA, PKCS#1 v1.5) and base64-encoded. The certificate is supplied by the platform owner per environment.
 */
export function securityCredential(initiatorPassword: string, certificatePem: string) {
  return crypto.publicEncrypt({ key: certificatePem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(initiatorPassword)).toString('base64');
}

export function b2cReady(cfg: ResolvedIntegration) {
  return cfg.settings.b2cEnabled === 'true' && Boolean(cfg.settings.b2cShortcode && cfg.settings.b2cInitiatorName && cfg.secrets.b2cInitiatorPassword && cfg.secrets.b2cCertificate);
}

/** B2C payment request: POST /mpesa/b2c/v3/paymentrequest (asynchronous; result arrives at ResultURL). */
export async function b2cPayment(cfg: ResolvedIntegration, input: { originatorConversationId: string; phone: string; amount: number; remarks: string; occasion?: string; resultUrl: string; timeoutUrl: string }) {
  const token = await darajaToken(cfg);
  const res = await fetch(`${baseUrl(cfg)}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      OriginatorConversationID: input.originatorConversationId,
      InitiatorName: cfg.settings.b2cInitiatorName,
      SecurityCredential: securityCredential(cfg.secrets.b2cInitiatorPassword, cfg.secrets.b2cCertificate),
      CommandID: 'BusinessPayment',
      Amount: Math.floor(input.amount),
      PartyA: cfg.settings.b2cShortcode,
      PartyB: input.phone,
      Remarks: input.remarks.slice(0, 100),
      QueueTimeOutURL: input.timeoutUrl,
      ResultURL: input.resultUrl,
      Occasion: (input.occasion ?? '').slice(0, 100),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok || data.ResponseCode !== '0') throw new AppError(502, 'MPESA_B2C_FAILED', data.errorMessage || data.ResponseDescription || `B2C request failed (HTTP ${res.status})`);
  return { conversationId: data.ConversationID, originatorConversationId: data.OriginatorConversationID };
}

/** Normalize a Kenyan MSISDN to 2547XXXXXXXX / 2541XXXXXXXX as Daraja expects. */
export function toMsisdn(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid Safaricom phone number');
}
