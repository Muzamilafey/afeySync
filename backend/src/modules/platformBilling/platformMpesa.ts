import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { meta } from '../../models/meta';
import { AppError, conflict } from '../../utils/errors';
import { h } from '../../utils/asyncHandler';
import { randomToken, sha256 } from '../../utils/crypto';
import { logger } from '../../utils/logger';
import { IntegrationSecretService } from '../integrations/secretService';
import { resolveIntegration, type ResolvedIntegration } from '../integrations/integrationConfigService';
import { registerC2BUrls, stkPush, stkQuery, toMsisdn } from '../../integrations/mpesa/mpesaService';
import { applyPayment, round2, type BillingDoc } from './documentService';
import { creditWallet, getSmsSettings, MAX_TOPUP_KES } from '../sms/smsWallet';

/**
 * The platform owner's M-Pesa collection channel for subscription invoices (integration `mpesa_billing`,
 * configured in Owner → Integrations). Payments are confirmed only by Safaricom's callbacks, which are
 * idempotent and deduplicated by M-Pesa receipt number.
 */
async function endpointToken() {
  const { CallbackEndpoint } = meta();
  const existing = await CallbackEndpoint.findOne({ provider: 'mpesa_billing', tenantId: null, active: true });
  if (existing?.tokenEncrypted?.ciphertext) return IntegrationSecretService.decrypt(existing.tokenEncrypted.ciphertext);
  const token = randomToken(32);
  await CallbackEndpoint.create({ provider: 'mpesa_billing', tokenHash: sha256(token), tokenEncrypted: IntegrationSecretService.encrypt(token), active: true });
  return token;
}
const publicBase = () => `${env.API_URL.replace(/\/$/, '')}/api/v1/payments/platform-mpesa`;

export async function collectionsConfig(): Promise<ResolvedIntegration> {
  const cfg = await resolveIntegration('mpesa_billing', null);
  // Safaricom only calls HTTPS URLs in production; refuse early instead of losing confirmations.
  if (cfg.environment === 'production' && !env.API_URL.startsWith('https://')) throw new AppError(503, 'MPESA_CALLBACK_NOT_HTTPS', 'API_URL must be a public HTTPS address before taking live M-Pesa payments.');
  return cfg;
}

/** Sends an STK prompt for the invoice balance (or a part of it). One pending prompt per invoice at a time. */
export async function requestStk(doc: BillingDoc, phoneIn: string, initiatedBy: string, amountIn?: number) {
  if (doc.type !== 'invoice' || !['issued', 'partially_paid'].includes(doc.status)) throw conflict('Only issued, unpaid invoices can be paid', undefined, 'INVALID_TRANSITION');
  const balance = round2(doc.balance ?? 0);
  if (balance <= 0) throw conflict('This invoice is already paid', undefined, 'ALREADY_PAID');
  // Daraja accepts whole shillings only.
  const amount = Math.ceil(Math.min(amountIn ?? balance, balance));
  if (amount < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Amount must be at least KES 1');
  const phone = toMsisdn(phoneIn);
  const { PlatformPayment } = meta();
  const recent = await PlatformPayment.findOne({ documentId: doc._id, method: 'mpesa_stk', status: 'pending', createdAt: { $gte: new Date(Date.now() - 2 * 60_000) } }).lean();
  if (recent) throw conflict('A payment prompt was sent less than two minutes ago. Complete it on the phone or wait before retrying.', { paymentId: recent._id }, 'STK_PENDING');
  const cfg = await collectionsConfig();
  const token = await endpointToken();
  const r = await stkPush(cfg, { phone, amount, accountReference: doc.number.replace(/-/g, ''), description: 'AfeySync', callbackUrl: `${publicBase()}/callback/${token}` });
  const p = await PlatformPayment.create({ documentId: doc._id, tenantId: doc.tenantId, method: 'mpesa_stk', amount, status: 'pending', mpesa: { checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId, phone }, initiatedBy });
  doc.history.push({ at: new Date(), action: 'mpesa_prompt', byName: initiatedBy, note: `KES ${amount} to ${phone.replace(/^(\d{6})\d{3}/, '$1***')}` });
  await doc.save();
  return { paymentId: String(p._id), customerMessage: r.customerMessage };
}

/** Paybill account reference for a facility's SMS top-ups, e.g. SMSNDABIBI. */
export const smsAccountRef = (slug: string) => `SMS${slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 12);

/** Sends an STK prompt to buy SMS credits for a facility. One pending prompt per facility at a time. */
export async function requestSmsTopupStk(tenant: { id: string; slug: string }, amountIn: number, phoneIn: string, initiatedBy: string) {
  const settings = await getSmsSettings();
  const amount = Math.floor(amountIn);
  if (!(amount >= settings.minTopupKes)) throw new AppError(400, 'VALIDATION_ERROR', `The minimum top-up is KES ${settings.minTopupKes}.`);
  if (amount > MAX_TOPUP_KES) throw new AppError(400, 'VALIDATION_ERROR', `The maximum M-Pesa top-up is KES ${MAX_TOPUP_KES.toLocaleString()}.`);
  const credits = Math.floor(amount / settings.pricePerSms);
  const phone = toMsisdn(phoneIn);
  const { PlatformPayment } = meta();
  const recent = await PlatformPayment.findOne({ purpose: 'sms_topup', tenantId: tenant.id, method: 'mpesa_stk', status: 'pending', createdAt: { $gte: new Date(Date.now() - 2 * 60_000) } }).lean();
  if (recent) throw conflict('A payment prompt was sent less than two minutes ago. Complete it on the phone or wait before retrying.', { paymentId: recent._id }, 'STK_PENDING');
  const cfg = await collectionsConfig();
  const token = await endpointToken();
  const r = await stkPush(cfg, { phone, amount, accountReference: smsAccountRef(tenant.slug), description: 'SMS credits', callbackUrl: `${publicBase()}/callback/${token}` });
  const p = await PlatformPayment.create({ purpose: 'sms_topup', tenantId: tenant.id, smsCredits: credits, smsPrice: settings.pricePerSms, method: 'mpesa_stk', amount, status: 'pending', mpesa: { checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId, phone }, initiatedBy });
  return { paymentId: String(p._id), credits, customerMessage: r.customerMessage };
}

/** Credits the SMS wallet for a confirmed top-up (once per payment), priced at the rate shown when it was requested. */
async function settleSmsTopup(p: { _id: unknown; tenantId?: unknown; amount: number; smsPrice?: number | null; reference?: string | null }) {
  const price = p.smsPrice || (await getSmsSettings()).pricePerSms;
  const credits = Math.floor(p.amount / price);
  await meta().PlatformPayment.updateOne({ _id: p._id }, { $set: { smsCredits: credits } });
  if (p.tenantId && credits > 0) await creditWallet(String(p.tenantId), credits, 'topup', `topup:${String(p._id)}`, { paymentId: String(p._id), note: `M-Pesa ${p.reference ?? ''} · KES ${p.amount}` });
}

/** Status for a pending STK payment. A query can only confirm failure; success always comes from the callback (it carries the receipt). */
export async function refreshStk(paymentId: unknown) {
  const { PlatformPayment } = meta();
  const p = await PlatformPayment.findById(paymentId);
  if (!p) return null;
  if (p.status === 'pending' && p.method === 'mpesa_stk' && p.mpesa?.checkoutRequestId && Date.now() - p.createdAt.getTime() > 45_000) {
    try {
      const q = await stkQuery(await collectionsConfig(), p.mpesa.checkoutRequestId);
      if (q.resultCode !== undefined && q.resultCode !== 0) {
        p.status = 'failed';
        p.set('mpesa.resultCode', q.resultCode);
        p.set('mpesa.resultDesc', q.resultDesc);
        await p.save();
      }
    } catch (err) {
      logger.warn({ err }, 'platform STK query failed');
    }
  }
  return p;
}

export async function registerCollectionsC2B() {
  const cfg = await collectionsConfig();
  const token = await endpointToken();
  return registerC2BUrls(cfg, `${publicBase()}/c2b/${token}/confirmation`, `${publicBase()}/c2b/${token}/validation`);
}

/* ------------------------------------------------------------------ Public Safaricom callbacks */
export const platformMpesaPublicRouter = Router();
platformMpesaPublicRouter.use('/payments/platform-mpesa', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

async function validToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  return Boolean(await meta().CallbackEndpoint.exists({ provider: 'mpesa_billing', tokenHash: sha256(token), active: true }));
}
const ack = { ResultCode: 0, ResultDesc: 'Accepted' };
type Item = { Name: string; Value?: string | number };

async function receiptTaken(receipt: string, exceptId?: unknown) {
  return Boolean(await meta().PlatformPayment.exists({ 'mpesa.receiptNumber': receipt, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }));
}

platformMpesaPublicRouter.post('/payments/platform-mpesa/callback/:token', h(async (req: Request, res) => {
  if (!(await validToken(String(req.params.token)))) return res.status(404).json({ ResultCode: 1, ResultDesc: 'Unknown endpoint' });
  const cb = (req.body?.Body?.stkCallback ?? {}) as { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string; CallbackMetadata?: { Item?: Item[] } };
  if (!cb.CheckoutRequestID) return res.json(ack);
  const { PlatformPayment } = meta();
  const p = await PlatformPayment.findOne({ 'mpesa.checkoutRequestId': cb.CheckoutRequestID });
  if (!p || p.status === 'completed') return res.json(ack); // unknown or already applied: acknowledge, never double count
  const item = (n: string) => cb.CallbackMetadata?.Item?.find((i) => i.Name === n)?.Value;
  p.set('mpesa.resultCode', Number(cb.ResultCode));
  p.set('mpesa.resultDesc', cb.ResultDesc);
  if (Number(cb.ResultCode) !== 0) {
    p.status = 'failed';
    await p.save();
    return res.json(ack);
  }
  const receipt = String(item('MpesaReceiptNumber') ?? '').toUpperCase();
  const amount = Number(item('Amount'));
  if (!receipt || !(amount > 0) || (await receiptTaken(receipt, p._id))) {
    p.status = 'failed';
    p.notes = 'Missing or duplicate M-Pesa receipt, or no amount, in callback. Verify on the M-Pesa statement.';
    await p.save();
    return res.json(ack);
  }
  p.set({ status: 'completed', amount: round2(amount), reference: receipt, receivedAt: new Date(), 'mpesa.receiptNumber': receipt, 'mpesa.transactionDate': String(item('TransactionDate') ?? '') });
  await p.save();
  if (p.purpose === 'sms_topup') await settleSmsTopup(p);
  else await applyPayment(p.documentId, p.amount, `M-Pesa ${receipt}`);
  res.json(ack);
}));

/** C2B validation: accept only references that match an open invoice, so wrong account numbers bounce back to the payer. */
platformMpesaPublicRouter.post('/payments/platform-mpesa/c2b/:token/validation', h(async (req, res) => {
  if (!(await validToken(String(req.params.token)))) return res.status(404).json({ ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
  const ref = String(req.body?.BillRefNumber ?? '');
  const ok = (await invoiceForRef(ref)) || (await tenantForSmsRef(ref));
  res.json(ok ? { ResultCode: '0', ResultDesc: 'Accepted' } : { ResultCode: 'C2B00012', ResultDesc: 'Invalid Account Number' });
}));

platformMpesaPublicRouter.post('/payments/platform-mpesa/c2b/:token/confirmation', h(async (req, res) => {
  if (!(await validToken(String(req.params.token)))) return res.status(404).json({ ResultCode: 1, ResultDesc: 'Unknown endpoint' });
  const b = req.body ?? {};
  const receipt = String(b.TransID ?? '').toUpperCase();
  const amount = Number(b.TransAmount);
  if (!receipt || !(amount > 0) || (await receiptTaken(receipt))) return res.json(ack);
  const smsTenant = await tenantForSmsRef(String(b.BillRefNumber ?? ''));
  if (smsTenant) {
    const price = (await getSmsSettings()).pricePerSms;
    const sp = await meta().PlatformPayment.create({
      purpose: 'sms_topup', tenantId: smsTenant._id, smsPrice: price, method: 'mpesa_c2b', amount: round2(amount), status: 'completed', reference: receipt, receivedAt: new Date(),
      mpesa: { receiptNumber: receipt, billRef: String(b.BillRefNumber ?? '').slice(0, 40), phone: String(b.MSISDN ?? '').slice(0, 20), payerName: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' ').slice(0, 80), transactionDate: String(b.TransTime ?? '') },
    });
    await settleSmsTopup(sp);
    return res.json(ack);
  }
  const doc = await invoiceForRef(String(b.BillRefNumber ?? ''));
  const p = await meta().PlatformPayment.create({
    documentId: doc?._id, tenantId: doc?.tenantId, method: 'mpesa_c2b', amount: round2(amount), status: 'completed', reference: receipt, receivedAt: new Date(),
    mpesa: { receiptNumber: receipt, billRef: String(b.BillRefNumber ?? '').slice(0, 40), phone: String(b.MSISDN ?? '').slice(0, 20), payerName: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' ').slice(0, 80), transactionDate: String(b.TransTime ?? '') },
    notes: doc ? undefined : 'Unmatched paybill payment: allocate it to an invoice manually.',
  });
  if (doc) await applyPayment(doc._id, p.amount, `M-Pesa paybill ${receipt}`);
  res.json(ack);
}));

/** Matches "SMSNDABIBI" / "sms-ndabibi" to the facility's SMS wallet (slug up to 9 characters after SMS). */
async function tenantForSmsRef(ref: string) {
  const norm = ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^SMS[A-Z0-9]{2,}$/.test(norm)) return null;
  const tenants = await meta().Tenant.find({ status: 'active' }).select('_id slug').lean();
  return tenants.find((t) => smsAccountRef(t.slug) === norm) ?? null;
}

/** Matches "INV-2026-0001", "INV20260001" or "inv 2026 0001" to an open invoice. */
async function invoiceForRef(ref: string) {
  const norm = ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^INV(\d{4})(\d{4,})$/.exec(norm);
  if (!m) return null;
  return meta().BillingDocument.findOne({ type: 'invoice', number: `INV-${m[1]}-${m[2]}`, status: { $in: ['issued', 'partially_paid'] } });
}
