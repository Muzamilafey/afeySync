import { z } from 'zod';
import { meta } from '../../models/meta';
import { logger } from '../../utils/logger';
import { loadTenant } from '../tenants/tenantLoader';
import { notifyEmail, notifyStaff } from '../notifications/notify';

/**
 * Facility SMS wallets. Every SMS a facility sends through AfeySync's SMS gateway costs credits
 * (1 credit = 1 SMS segment). New facilities get free welcome credits once; afterwards the facility
 * tops up with M-Pesa through the platform owner's collection channel. Facilities using their own
 * SMS account (when the owner allows it) are not charged.
 */
export const smsSettingsSchema = z.object({
  pricePerSms: z.number().min(0.1).max(100),
  welcomeCredits: z.number().int().min(0).max(10_000),
  lowBalanceCredits: z.number().int().min(0).max(100_000),
  minTopupKes: z.number().int().min(1).max(100_000),
  /** Sign-in codes may take the balance slightly below zero so nobody is locked out; recovered at the next top-up. */
  otpOverdraftCredits: z.number().int().min(0).max(100),
});
export type SmsSettings = z.infer<typeof smsSettingsSchema>;
export const DEFAULT_SMS_SETTINGS: SmsSettings = { pricePerSms: 1, welcomeCredits: 20, lowBalanceCredits: 5, minTopupKes: 50, otpOverdraftCredits: 5 };
export const MAX_TOPUP_KES = 150_000;

export async function getSmsSettings(): Promise<SmsSettings> {
  const s = await meta().PlatformSettings.findOne({ key: 'sms.wallet' }).lean();
  return { ...DEFAULT_SMS_SETTINGS, ...((s?.value as Partial<SmsSettings>) ?? {}) };
}
export async function saveSmsSettings(v: SmsSettings) {
  await meta().PlatformSettings.updateOne({ key: 'sms.wallet' }, { $set: { value: v } }, { upsert: true });
}

/* ------------------------------------------------------------------ Segments */
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
/** How many SMS segments (credits) a message uses: 160/153 characters in GSM-7, 70/67 otherwise. */
export function smsSegments(message: string) {
  const chars = [...message];
  const gsm = chars.every((c) => GSM.includes(c) || GSM_EXT.includes(c));
  if (gsm) {
    const len = chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  return chars.length <= 70 ? 1 : Math.ceil(chars.length / 67);
}

/* ------------------------------------------------------------------ Ledger */
type EntryType = 'welcome' | 'topup' | 'debit' | 'refund' | 'adjustment';
const isDup = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Adds (or, for a negative adjustment, removes) credits exactly once per key. */
export async function creditWallet(tenantId: string, credits: number, type: EntryType, key: string, extra: { note?: string; paymentId?: string; jobId?: string; byName?: string } = {}) {
  const { SmsLedger, SmsWallet } = meta();
  let entry;
  try {
    entry = await SmsLedger.create({ tenantId, type, credits, key, ...extra });
  } catch (err) {
    if (isDup(err)) return { duplicate: true as const };
    throw err;
  }
  const w = await SmsWallet.findOneAndUpdate(
    { tenantId },
    { $inc: { balance: credits }, ...(credits > 0 ? { $unset: { lowAlertAt: '', emptyAlertAt: '' } } : {}) },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  await SmsLedger.updateOne({ _id: entry._id }, { $set: { balanceAfter: w!.balance } });
  return { duplicate: false as const, balance: w!.balance };
}

/**
 * Takes credits for one send attempt. Refuses when the balance is too low (sign-in codes may use the
 * small overdraft). Returns the new balance, or null when refused.
 */
export async function debitWallet(tenantId: string, credits: number, key: string, opts: { critical?: boolean; jobId?: string; note?: string } = {}) {
  const { SmsLedger, SmsWallet } = meta();
  await ensureWallet(tenantId);
  const settings = await getSmsSettings();
  const floor = credits - (opts.critical ? settings.otpOverdraftCredits : 0);
  const w = await SmsWallet.findOneAndUpdate({ tenantId, balance: { $gte: floor } }, { $inc: { balance: -credits } }, { returnDocument: 'after' }).lean();
  if (!w) {
    void balanceAlerts(tenantId, 0).catch(() => undefined);
    return null;
  }
  try {
    await SmsLedger.create({ tenantId, type: 'debit', credits: -credits, key, balanceAfter: w.balance, jobId: opts.jobId, note: opts.note });
  } catch (err) {
    // The same attempt was already charged: give these credits back.
    await SmsWallet.updateOne({ tenantId }, { $inc: { balance: credits } });
    if (!isDup(err)) throw err;
  }
  void balanceAlerts(tenantId, w.balance).catch((err) => logger.warn({ err }, 'sms balance alert failed'));
  return w.balance;
}

/** Gives the facility its one-time welcome credits (idempotent) and makes sure the wallet exists. */
export async function ensureWallet(tenantId: string) {
  const { SmsWallet, SmsLedger } = meta();
  if (await SmsLedger.exists({ key: `welcome:${tenantId}` })) return;
  const settings = await getSmsSettings();
  await SmsWallet.updateOne({ tenantId }, { $setOnInsert: { tenantId, balance: 0 } }, { upsert: true });
  if (!settings.welcomeCredits) return;
  const r = await creditWallet(tenantId, settings.welcomeCredits, 'welcome', `welcome:${tenantId}`, { note: `Welcome gift: ${settings.welcomeCredits} free SMS` });
  if (!r.duplicate) {
    void walletManagers(tenantId)
      .then(({ m, users }) =>
        notifyStaff(m, users.map((u) => u._id), { event: 'System', title: `${settings.welcomeCredits} free SMS added to your SMS wallet`, body: 'Use them for appointment reminders, receipts and sign-in codes. Top up any time with M-Pesa.', link: '/admin/sms' }),
      )
      .catch(() => undefined);
  }
}

/** Welcome credits for facilities that existed before SMS wallets (runs at start-up). */
export async function backfillWelcomeCredits() {
  const tenants = await meta().Tenant.find({ status: 'active' }).select('_id').lean();
  for (const t of tenants) await ensureWallet(String(t._id)).catch((err) => logger.warn({ err, tenantId: String(t._id) }, 'sms welcome grant failed'));
}

/* ------------------------------------------------------------------ Alerts */
async function walletManagers(tenantId: string) {
  const tenant = await loadTenant(tenantId);
  const m = tenant.models;
  const roleIds = (await m.Role.find({ permissions: { $in: ['subscription.view', 'admin.settings'] } }).select('_id').lean()).map((r) => r._id);
  const users = await m.User.find({ status: 'active', roleIds: { $in: roleIds } }).select('_id email name').lean();
  return { tenant, m, users };
}

/** Tells the facility's administrators once when the balance runs low and once when it runs out. */
export async function balanceAlerts(tenantId: string, balance: number) {
  const settings = await getSmsSettings();
  const kind = balance <= 0 ? 'empty' : balance <= settings.lowBalanceCredits ? 'low' : null;
  if (!kind) return;
  const field = kind === 'empty' ? 'emptyAlertAt' : 'lowAlertAt';
  const claimed = await meta().SmsWallet.findOneAndUpdate({ tenantId, [field]: null }, { $set: { [field]: new Date() } });
  if (!claimed) return;
  const { tenant, m, users } = await walletManagers(tenantId);
  const title = kind === 'empty' ? 'Your SMS wallet is empty: SMS are not being sent' : `Your SMS wallet is running low (${balance} SMS left)`;
  const body = kind === 'empty'
    ? 'Appointment reminders, receipts and other SMS are paused until you top up. Sign-in codes use a small reserve. Top up with M-Pesa in Admin → SMS wallet.'
    : 'Top up with M-Pesa in Admin → SMS wallet so appointment reminders, receipts and sign-in codes keep going out.';
  await notifyStaff(m, users.map((u) => u._id), { event: 'System', title, body, link: '/admin/sms' });
  for (const u of users) await notifyEmail(tenantId, `sms-${kind}:${tenantId}:${Date.now()}:${u._id}`, u.email, `${tenant.name}: ${title}`, `Hello ${u.name},\n\n${title}.\n\n${body}\n\nPrice: KES ${settings.pricePerSms} per SMS.`);
}
