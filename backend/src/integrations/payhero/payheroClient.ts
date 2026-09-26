import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';

/**
 * Pay Hero (https://backend.payhero.co.ke, API v2): M-Pesa STK prompts into a registered payment channel (the
 * account holder's paybill, till or bank account). Authentication is the Basic Authorization token from
 * Pay Hero → API Keys, stored encrypted and sent only from the server.
 */
const baseUrl = (cfg: ResolvedIntegration) => (cfg.settings.baseUrl || 'https://backend.payhero.co.ke').replace(/\/+$/, '');
const authHeader = (cfg: ResolvedIntegration) => {
  const token = (cfg.secrets.authToken ?? '').trim().replace(/^Basic\s+/i, '');
  if (!token) throw new AppError(503, 'PAYHERO_NOT_CONFIGURED', 'The Pay Hero authorization token is not saved');
  return `Basic ${token}`;
};

async function call<T>(cfg: ResolvedIntegration, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(cfg)}${path}`, {
      method,
      headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(503, 'PAYHERO_UNAVAILABLE', 'Pay Hero could not be reached. Try again shortly.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error_message?: string; message?: string };
  if (res.status === 401 || res.status === 403) throw new AppError(502, 'PAYHERO_AUTH_ERROR', 'Pay Hero refused the authorization token. Copy it again from Pay Hero → API Keys.');
  if (!res.ok) throw new AppError(502, 'PAYHERO_ERROR', data.error_message || data.message || `Pay Hero request failed (HTTP ${res.status})`);
  return data;
}

/** Pay Hero takes the local format, e.g. 0712345678. */
const localPhone = (msisdn: string) => (msisdn.startsWith('254') ? `0${msisdn.slice(3)}` : msisdn);

export function channelId(cfg: ResolvedIntegration) {
  const id = Number(cfg.settings.channelId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(503, 'PAYHERO_NOT_CONFIGURED', 'Pay Hero has no payment channel ID saved');
  return id;
}

/** POST /api/v2/payments: sends the STK prompt. Pay Hero answers QUEUED; the outcome arrives at callback_url. */
export async function payheroStkPush(cfg: ResolvedIntegration, input: { phone: string; amount: number; externalReference: string; customerName?: string; callbackUrl: string }) {
  const r = await call<{ success?: boolean; status?: string; reference?: string; CheckoutRequestID?: string }>(cfg, 'POST', '/api/v2/payments', {
    amount: Math.ceil(input.amount),
    phone_number: localPhone(input.phone),
    channel_id: channelId(cfg),
    provider: 'm-pesa',
    external_reference: input.externalReference,
    ...(input.customerName ? { customer_name: input.customerName.slice(0, 60) } : {}),
    callback_url: input.callbackUrl,
    ...(cfg.settings.credentialId ? { credential_id: cfg.settings.credentialId } : {}),
  });
  if (!r.success || !r.reference) throw new AppError(502, 'PAYHERO_ERROR', 'Pay Hero did not accept the payment request');
  return { reference: r.reference, checkoutRequestId: r.CheckoutRequestID, status: r.status };
}

export interface PayheroStatus { status: 'QUEUED' | 'SUCCESS' | 'FAILED' | string; providerReference?: string; reference?: string }

/** GET /api/v2/transaction-status?reference=: QUEUED (no result yet), SUCCESS or FAILED. */
export async function payheroTransactionStatus(cfg: ResolvedIntegration, reference: string): Promise<PayheroStatus> {
  const r = await call<{ status?: string; provider_reference?: string; third_party_reference?: string; reference?: string }>(cfg, 'GET', `/api/v2/transaction-status?reference=${encodeURIComponent(reference)}`);
  return { status: String(r.status ?? '').toUpperCase(), providerReference: (r.provider_reference || r.third_party_reference || undefined)?.toUpperCase(), reference: r.reference };
}

/** GET /api/v2/payment_channels: used by the connection test to confirm the saved channel belongs to this account. */
export async function payheroChannels(cfg: ResolvedIntegration) {
  const r = await call<{ payment_channels?: Array<{ id: number; channel_type?: string; short_code?: string; account_number?: string; description?: string; is_active?: boolean }> }>(cfg, 'GET', '/api/v2/payment_channels');
  return r.payment_channels ?? [];
}

/** The callback Pay Hero posts to callback_url once the customer has answered the prompt. */
export interface PayheroCallback {
  status?: boolean;
  response?: { Amount?: number; CheckoutRequestID?: string; ExternalReference?: string; MerchantRequestID?: string; MpesaReceiptNumber?: string; Phone?: string; ResultCode?: number; ResultDesc?: string; Status?: string };
}
