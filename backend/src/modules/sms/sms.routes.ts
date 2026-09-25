import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { notFound } from '../../utils/errors';
import { authenticatePlatform, authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { audit, platformAudit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { resolveIntegration } from '../integrations/integrationConfigService';
import { requestSmsTopupStk, refreshStk, smsAccountRef } from '../platformBilling/platformMpesa';
import { creditWallet, ensureWallet, getSmsSettings, MAX_TOPUP_KES, saveSmsSettings, smsSettingsSchema } from './smsWallet';

const DAY = 86_400_000;

async function usedLast30Days(tenantId: string) {
  const rows = await meta().SmsLedger.find({ tenantId, type: { $in: ['debit', 'refund'] }, createdAt: { $gte: new Date(Date.now() - 30 * DAY) } }).select('credits').lean();
  return -rows.reduce((n, r) => n + r.credits, 0);
}

async function paybillInfo() {
  try {
    const cfg = await resolveIntegration('mpesa_billing', null);
    return { available: true, paybill: cfg.settings.paybill || cfg.settings.shortcode || null };
  } catch {
    return { available: false, paybill: null };
  }
}

/* ------------------------------------------------------------------ Facility: SMS wallet */
export const smsWalletRouter = Router();
smsWalletRouter.use(authenticateTenant);
const canManage = requireAnyPermission('subscription.view', 'admin.settings');

smsWalletRouter.get(
  '/',
  canManage,
  h(async (req, res) => {
    const tenantId = req.tenant!.id;
    await ensureWallet(tenantId);
    const [w, settings, pay, used, welcome] = await Promise.all([
      meta().SmsWallet.findOne({ tenantId }).lean(),
      getSmsSettings(),
      paybillInfo(),
      usedLast30Days(tenantId),
      meta().SmsLedger.findOne({ key: `welcome:${tenantId}` }).select('credits createdAt').lean(),
    ]);
    const balance = w?.balance ?? 0;
    res.json({
      success: true,
      data: {
        balance,
        status: balance <= 0 ? 'empty' : balance <= settings.lowBalanceCredits ? 'low' : 'ok',
        pricePerSms: settings.pricePerSms,
        lowBalanceCredits: settings.lowBalanceCredits,
        minTopupKes: settings.minTopupKes,
        maxTopupKes: MAX_TOPUP_KES,
        usedLast30Days: used,
        welcome: welcome ? { credits: welcome.credits, at: (welcome as { createdAt?: Date }).createdAt } : null,
        mpesa: { available: pay.available, paybill: pay.paybill, accountRef: smsAccountRef(req.tenant!.slug) },
      },
    });
  }),
);

smsWalletRouter.get(
  '/ledger',
  canManage,
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query, 100);
    const filter = { tenantId: req.tenant!.id };
    const [items, total] = await Promise.all([
      meta().SmsLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('type credits balanceAfter note byName createdAt').lean(),
      meta().SmsLedger.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

smsWalletRouter.post(
  '/topup',
  canManage,
  h(async (req, res) => {
    const body = parse(z.object({ amount: z.number().int().positive(), phone: z.string().trim().min(9).max(20) }), req.body);
    const r = await requestSmsTopupStk({ id: req.tenant!.id, slug: req.tenant!.slug }, body.amount, body.phone, req.user!.name);
    await audit(req, { action: 'sms.topup_requested', resource: 'sms_wallet', resourceId: r.paymentId, newValue: { amount: body.amount, credits: r.credits } });
    res.status(201).json({ success: true, data: r });
  }),
);

smsWalletRouter.get(
  '/topup/:id',
  canManage,
  h(async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound('Top-up not found');
    const p = await meta().PlatformPayment.findOne({ _id: req.params.id, purpose: 'sms_topup', tenantId: req.tenant!.id }).select('_id').lean();
    if (!p) throw notFound('Top-up not found');
    const cur = await refreshStk(p._id);
    res.json({ success: true, data: { status: cur?.status, amount: cur?.amount, credits: cur?.smsCredits, receipt: cur?.reference ?? null, message: cur?.mpesa?.resultDesc ?? null } });
  }),
);

/* ------------------------------------------------------------------ Owner: pricing and wallets */
export const smsOwnerRouter = Router();
smsOwnerRouter.use(authenticatePlatform);
const ownerPerm = requirePermission('owner.subscriptions');

smsOwnerRouter.get('/settings', ownerPerm, h(async (_req, res) => res.json({ success: true, data: await getSmsSettings() })));

smsOwnerRouter.put(
  '/settings',
  ownerPerm,
  h(async (req, res) => {
    const before = await getSmsSettings();
    const body = parse(smsSettingsSchema, req.body);
    await saveSmsSettings(body);
    await platformAudit(req, { action: 'sms.settings', resource: 'platform_settings', resourceId: 'sms.wallet', oldValue: before, newValue: body });
    res.json({ success: true, data: body });
  }),
);

smsOwnerRouter.get(
  '/wallets',
  ownerPerm,
  h(async (_req, res) => {
    const [tenants, wallets, settings] = await Promise.all([
      meta().Tenant.find({ status: { $in: ['active', 'suspended'] } }).select('name slug status').sort({ name: 1 }).lean(),
      meta().SmsWallet.find({}).lean(),
      getSmsSettings(),
    ]);
    const since = new Date(Date.now() - 30 * DAY);
    const ledger = await meta().SmsLedger.find({ createdAt: { $gte: since }, type: { $in: ['debit', 'refund', 'topup'] } }).select('tenantId type credits').lean();
    res.json({
      success: true,
      data: tenants.map((t) => {
        const id = String(t._id);
        const w = wallets.find((x) => String(x.tenantId) === id);
        const mine = ledger.filter((l) => String(l.tenantId) === id);
        const balance = w?.balance ?? 0;
        return {
          tenantId: id, name: t.name, slug: t.slug, status: t.status, balance,
          walletStatus: balance <= 0 ? 'empty' : balance <= settings.lowBalanceCredits ? 'low' : 'ok',
          usedLast30Days: -mine.filter((l) => l.type !== 'topup').reduce((n, l) => n + l.credits, 0),
          toppedUpLast30Days: mine.filter((l) => l.type === 'topup').reduce((n, l) => n + l.credits, 0),
        };
      }),
    });
  }),
);

smsOwnerRouter.get(
  '/wallets/:tenantId/ledger',
  ownerPerm,
  h(async (req, res) => {
    if (!isValidObjectId(req.params.tenantId)) throw notFound('Facility not found');
    res.json({ success: true, data: await meta().SmsLedger.find({ tenantId: req.params.tenantId }).sort({ createdAt: -1 }).limit(200).lean() });
  }),
);

/** Manual credit or correction (e.g. a paybill payment with a wrong account number, or a goodwill gift). */
smsOwnerRouter.post(
  '/wallets/:tenantId/adjust',
  ownerPerm,
  h(async (req, res) => {
    const tenantId = String(req.params.tenantId);
    if (!isValidObjectId(tenantId) || !(await meta().Tenant.exists({ _id: tenantId }))) throw notFound('Facility not found');
    const body = parse(z.object({ credits: z.number().int().refine((n) => n !== 0, 'must not be zero').refine((n) => Math.abs(n) <= 1_000_000, 'is too large'), note: z.string().trim().min(3).max(200) }), req.body);
    await ensureWallet(tenantId);
    const r = await creditWallet(tenantId, body.credits, 'adjustment', `adjust:${tenantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, { note: body.note, byName: req.platformUser!.name });
    await platformAudit(req, { action: 'sms.wallet_adjust', resource: 'sms_wallet', resourceId: tenantId, tenantId, newValue: body });
    res.json({ success: true, data: { balance: 'balance' in r ? r.balance : null } });
  }),
);
