import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../utils/crypto';
import { IntegrationSecretService } from '../integrations/secretService';
import { resolveIntegration } from '../integrations/integrationConfigService';
import { registerC2BUrls, stkPush, stkQuery, toMsisdn } from '../../integrations/mpesa/mpesaService';
import { loadTenant } from '../tenants/tenantLoader';
import { assertPayable, completePayment, recalcInvoice } from './billingService';
import { loadScoped, round2 } from '../common/helpers';
import { logger } from '../../utils/logger';
import { enqueueJob } from '../../jobs/queue';

/** Per-tenant M-Pesa callback endpoint (secret URL token, stored hashed + encrypted for URL rebuilding). */
async function mpesaEndpoint(tenantId: string) {
  const { CallbackEndpoint } = meta();
  const existing = await CallbackEndpoint.findOne({ provider: 'mpesa', tenantId, active: true });
  if (existing?.tokenEncrypted?.ciphertext) return IntegrationSecretService.decrypt(existing.tokenEncrypted.ciphertext);
  const token = randomToken(32);
  await CallbackEndpoint.create({ provider: 'mpesa', tenantId, tokenHash: sha256(token), tokenEncrypted: IntegrationSecretService.encrypt(token), active: true });
  return token;
}
const base = () => `${env.API_URL.replace(/\/$/, '')}/api/v1/payments/mpesa`;

/* ------------------------------------------------------------ Authenticated (cashier) */
export const mpesaRouter = Router();
mpesaRouter.use(authenticateTenant);

mpesaRouter.post(
  '/stk',
  requirePermission('billing.create'),
  h(async (req, res) => {
    const body = parse(z.object({ invoiceId: z.string(), phone: z.string().min(9).max(15), amount: z.number().positive().max(250_000), idempotencyKey: z.string().min(8).max(100) }), req.body);
    const m = req.tenant!.models;
    const replay = await m.Payment.findOne({ idempotencyKey: body.idempotencyKey }).lean();
    if (replay) return res.json({ success: true, data: replay, idempotentReplay: true });
    const inv = await loadScoped(req, m.Invoice, body.invoiceId, 'Invoice');
    assertPayable(inv, body.amount);
    const phone = toMsisdn(body.phone);
    // Duplicate protection: one in-flight STK per invoice+phone per 2 minutes.
    if (await m.Payment.exists({ invoiceId: inv._id, 'mpesa.phone': phone, status: 'pending', createdAt: { $gte: new Date(Date.now() - 120_000) } })) {
      throw conflict('An M-Pesa prompt was already sent to this phone for this invoice. Wait for it to complete.', undefined, 'STK_IN_PROGRESS');
    }
    const cfg = await resolveIntegration('mpesa', req.tenant!.id);
    const token = await mpesaEndpoint(req.tenant!.id);
    const r = await stkPush(cfg, { phone, amount: body.amount, accountReference: inv.invoiceNumber, description: 'Hospital bill', callbackUrl: `${base()}/callback/${token}` });
    const p = await m.Payment.create({
      invoiceId: inv._id,
      patientId: inv.patientId,
      branchId: inv.branchId,
      method: 'mpesa',
      amount: Math.ceil(body.amount),
      idempotencyKey: body.idempotencyKey,
      status: 'pending',
      receivedBy: req.user!.id,
      receivedByName: req.user!.name,
      mpesa: { checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId, phone },
    });
    await audit(req, { action: 'billing.mpesa_stk', resource: 'payment', resourceId: String(p._id), newValue: { invoice: inv.invoiceNumber, amount: body.amount } });
    res.status(201).json({ success: true, data: p, message: r.customerMessage });
  }),
);

/** Transaction status lookup for a pending STK payment. */
mpesaRouter.post(
  '/:paymentId/query',
  requirePermission('billing.create'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const p = await loadScoped(req, m.Payment, req.params.paymentId, 'Payment');
    if (p.status !== 'pending' || !p.mpesa?.checkoutRequestId) return res.json({ success: true, data: p });
    const cfg = await resolveIntegration('mpesa', req.tenant!.id);
    const q = await stkQuery(cfg, p.mpesa.checkoutRequestId);
    // Only a definitive failure is applied from a query; success is applied from the signed-off callback (it carries the receipt number).
    if (q.resultCode !== undefined && q.resultCode !== 0) {
      p.status = 'failed';
      p.set('mpesa.resultCode', q.resultCode);
      p.set('mpesa.resultDesc', q.resultDesc);
      await p.save();
    }
    res.json({ success: true, data: p, query: q });
  }),
);

mpesaRouter.post(
  '/c2b/register',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const cfg = await resolveIntegration('mpesa', req.tenant!.id);
    const token = await mpesaEndpoint(req.tenant!.id);
    const r = await registerC2BUrls(cfg, `${base()}/c2b/${token}/confirmation`, `${base()}/c2b/${token}/validation`);
    await audit(req, { action: 'billing.mpesa_c2b_register', resource: 'integration', resourceId: 'mpesa' });
    res.json({ success: true, data: r });
  }),
);

/* ------------------------------------------------------------ Public Safaricom callbacks */
export const mpesaPublicRouter = Router();
mpesaPublicRouter.use(rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false }));

async function tenantForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const ep = await meta().CallbackEndpoint.findOne({ provider: 'mpesa', tokenHash: sha256(token), active: true }).lean();
  if (!ep?.tenantId) return null;
  return loadTenant(String(ep.tenantId), { requireActive: false });
}

const ack = { ResultCode: 0, ResultDesc: 'Accepted' };
type Item = { Name: string; Value?: string | number };

mpesaPublicRouter.post(
  '/payments/mpesa/callback/:token',
  h(async (req: Request, res) => {
    const tenant = await tenantForToken(String(req.params.token));
    if (!tenant) return res.status(404).json({ ResultCode: 1, ResultDesc: 'Unknown endpoint' });
    const cb = (req.body?.Body?.stkCallback ?? {}) as { CheckoutRequestID?: string; MerchantRequestID?: string; ResultCode?: number; ResultDesc?: string; CallbackMetadata?: { Item?: Item[] } };
    if (!cb.CheckoutRequestID) return res.json(ack);
    const m = tenant.models;
    const p = await m.Payment.findOne({ 'mpesa.checkoutRequestId': cb.CheckoutRequestID });
    if (!p) {
      logger.warn({ tenant: tenant.slug }, 'M-Pesa callback for unknown CheckoutRequestID');
      return res.json(ack);
    }
    if (p.status !== 'pending') return res.json(ack); // idempotent: already applied
    const item = (n: string) => cb.CallbackMetadata?.Item?.find((i) => i.Name === n)?.Value;
    p.set('mpesa.resultCode', Number(cb.ResultCode));
    p.set('mpesa.resultDesc', cb.ResultDesc);
    if (Number(cb.ResultCode) === 0) {
      const receipt = String(item('MpesaReceiptNumber') ?? '').toUpperCase();
      const amount = Number(item('Amount'));
      if (!receipt || (await m.Payment.exists({ 'mpesa.receiptNumber': receipt, _id: { $ne: p._id } }))) {
        p.status = 'failed';
        p.notes = 'Duplicate or missing M-Pesa receipt in callback';
        await p.save();
        return res.json(ack);
      }
      p.set('mpesa.receiptNumber', receipt);
      p.set('mpesa.transactionDate', String(item('TransactionDate') ?? ''));
      p.reference = receipt;
      if (!Number.isNaN(amount) && amount > 0) p.amount = round2(amount);
      await completePayment(m, p);
      await m.AuditLog.create({ actorType: 'integration', action: 'billing.mpesa_confirmed', resource: 'payment', resourceId: String(p._id), newValue: { receipt, amount: p.amount } });
      const patient = await m.Patient.findById(p.patientId).select('phone consent').lean();
      if (patient?.phone && patient.consent?.sms !== false) {
        await enqueueJob('SMS', `receipt:${tenant.id}:${p._id}`, { to: patient.phone, message: `${tenant.name}: Payment of KES ${p.amount} received. Receipt ${p.receiptNumber}, M-Pesa ${receipt}. Thank you.` }, tenant.id);
      }
    } else {
      p.status = 'failed';
      await p.save();
    }
    res.json(ack);
  }),
);

/** C2B validation: accept payments to the paybill (unmatched references are reconciled manually). */
mpesaPublicRouter.post(
  '/payments/mpesa/c2b/:token/validation',
  h(async (req, res) => {
    const tenant = await tenantForToken(String(req.params.token));
    if (!tenant) return res.status(404).json({ ResultCode: 'C2B00016', ResultDesc: 'Rejected' });
    res.json({ ResultCode: '0', ResultDesc: 'Accepted' });
  }),
);

mpesaPublicRouter.post(
  '/payments/mpesa/c2b/:token/confirmation',
  h(async (req, res) => {
    const tenant = await tenantForToken(String(req.params.token));
    if (!tenant) return res.status(404).json({ ResultCode: 1, ResultDesc: 'Unknown endpoint' });
    const b = req.body as { TransID?: string; TransAmount?: string; BillRefNumber?: string; MSISDN?: string; FirstName?: string; TransTime?: string };
    if (!b.TransID) return res.json(ack);
    const m = tenant.models;
    const receipt = b.TransID.toUpperCase();
    if (await m.Payment.exists({ 'mpesa.receiptNumber': receipt })) return res.json(ack); // duplicate delivery
    const ref = String(b.BillRefNumber ?? '').trim().toUpperCase();
    let inv = ref ? await m.Invoice.findOne({ invoiceNumber: ref, status: { $in: ['open', 'issued', 'partially_paid'] } }) : null;
    if (!inv && ref) {
      const patient = await m.Patient.findOne({ patientNumber: ref }).select('_id').lean();
      if (patient) inv = await m.Invoice.findOne({ patientId: patient._id, status: { $in: ['open', 'issued', 'partially_paid'] }, 'totals.balance': { $gt: 0 } }).sort({ createdAt: 1 });
    }
    const amount = round2(Number(b.TransAmount));
    const mainBranch = await m.Branch.findOne({ isMain: true }).select('_id').lean();
    const fits = inv && amount <= (inv.totals?.balance ?? 0) + 0.001;
    const p = await m.Payment.create({
      invoiceId: fits ? inv!._id : undefined,
      patientId: fits ? inv!.patientId : undefined,
      branchId: fits ? inv!.branchId : mainBranch?._id,
      method: 'mpesa',
      amount,
      reference: receipt,
      idempotencyKey: `c2b:${receipt}`,
      status: 'pending',
      receivedByName: 'M-Pesa C2B',
      mpesa: { receiptNumber: receipt, phone: b.MSISDN, billRefNumber: ref, payerName: b.FirstName, transactionDate: b.TransTime },
    });
    await completePayment(m, p);
    if (fits) await recalcInvoice(m, inv!);
    await m.AuditLog.create({ actorType: 'integration', action: 'billing.mpesa_c2b', resource: 'payment', resourceId: String(p._id), newValue: { receipt, amount, billRef: ref, allocated: Boolean(fits) } });
    res.json(ack);
  }),
);

export { notFound };
