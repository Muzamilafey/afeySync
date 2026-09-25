import crypto from 'node:crypto';
import { meta } from '../../models/meta';
import { AppError, conflict } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { MODULES, clearEntitlementCache, type ModuleKey } from '../plans/planService';
import { DEFAULT_CONTRACT_TEMPLATE, currentAssets, getBusiness, type Business } from './business';

export type DocType = 'quotation' | 'invoice' | 'contract';
export type BillingDoc = NonNullable<Awaited<ReturnType<ReturnType<typeof meta>['BillingDocument']['findOne']>>>;

const PREFIX: Record<DocType, string> = { quotation: 'QUO', invoice: 'INV', contract: 'AGR' };
export const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
export const CYCLE_LABEL: Record<string, string> = { monthly: 'month', quarterly: 'quarter', annual: 'year' };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const kes = (n: number, currency = 'KES') => `${currency} ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }) : '—');

/** Sequential, gap-tolerant numbers per type and year: INV-2026-0001. */
export async function nextNumber(type: DocType, at = new Date()) {
  const year = at.getUTCFullYear();
  const key = `${PREFIX[type]}-${year}`;
  const c = await meta().PlatformCounter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  return `${key}-${String(c!.seq).padStart(4, '0')}`;
}

export interface LineIn { description: string; quantity: number; unitPrice: number; kind?: 'subscription' | 'setup' | 'service' | 'other'; planKey?: string; billingCycle?: string; periods?: number }

/** Totals are always computed on the server. VAT applies only when the owner is VAT-registered. */
export function computeTotals(lines: LineIn[], business: Business) {
  const out = lines.map((l) => ({ ...l, quantity: l.quantity, unitPrice: round2(l.unitPrice), amount: round2(l.quantity * l.unitPrice), kind: l.kind ?? 'service' }));
  const subtotal = round2(out.reduce((s, l) => s + l.amount, 0));
  const vatRate = business.vatRegistered ? business.vatRate : 0;
  const vatAmount = round2((subtotal * vatRate) / 100);
  return { lines: out, subtotal, vatRate, vatAmount, total: round2(subtotal + vatAmount) };
}

/** Fills the contract template. Unknown placeholders are left visible so they are noticed in review. */
export function renderContractBody(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}

export async function contractVars(doc: BillingDoc, business: Business) {
  const plan = doc.contract?.planKey ? await meta().SubscriptionPlan.findOne({ key: doc.contract.planKey }).lean() : null;
  const cycle = doc.contract?.billingCycle ?? 'monthly';
  return {
    plan,
    vars: {
      'provider.name': business.legalName || business.companyName,
      'provider.kraPin': business.kraPin ?? '',
      'customer.name': doc.customer?.name ?? '',
      'plan.name': plan?.name ?? doc.contract?.planKey ?? '',
      'plan.modules': plan ? (plan.modules ?? []).map((m) => MODULES[m as ModuleKey]?.label ?? m).join(', ') : '',
      fee: kes(doc.contract?.amount ?? 0, doc.currency ?? 'KES'),
      cycle: CYCLE_LABEL[cycle] ?? cycle,
      startDate: fmtDate(doc.contract?.startDate),
      termMonths: String(doc.contract?.termMonths ?? 12),
      dueDays: String(business.invoiceDueDays),
    } as Record<string, string>,
  };
}

/** The canonical content that the signature covers; printed (shortened) on the PDF for verification. */
export function contentHash(doc: BillingDoc) {
  const canonical = JSON.stringify({
    t: doc.type, n: doc.number, c: doc.customer, l: doc.lines, s: doc.subtotal, v: doc.vatAmount, tot: doc.total, cur: doc.currency,
    i: doc.issueDate, d: doc.dueDate, u: doc.validUntil, k: doc.contract, notes: doc.notes, terms: doc.terms,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Issues a draft: freezes the content, dates and business details, and — when auto-signing is on —
 * applies the owner's current signature and stamp. Issued documents are never edited; they are voided
 * and replaced instead.
 */
export async function issueDocument(doc: BillingDoc, actor: { name: string }) {
  if (doc.status !== 'draft') throw conflict('Only drafts can be issued', undefined, 'INVALID_TRANSITION');
  if (!doc.customer?.name) throw new AppError(422, 'CUSTOMER_REQUIRED', 'Add the customer before issuing');
  if (doc.type !== 'contract' && !(doc.lines ?? []).length) throw new AppError(422, 'LINES_REQUIRED', 'Add at least one line before issuing');
  if (doc.type !== 'contract' && !((doc.total ?? 0) > 0)) throw new AppError(422, 'ZERO_TOTAL', 'The total is zero. Check the prices (a plan priced “on request” has no price) before issuing.');
  if (doc.type === 'contract' && !((doc.contract?.amount ?? 0) > 0)) throw new AppError(422, 'ZERO_TOTAL', 'Enter the agreed fee before issuing.');
  const business = await getBusiness();
  const assets = await currentAssets();
  if (business.autoSign && !assets.signature) throw new AppError(422, 'SIGNATURE_REQUIRED', 'Upload your signature (and stamp) in Billing → Settings before issuing documents, or turn off automatic signing.');
  const now = new Date();
  doc.issueDate = now;
  if (doc.type === 'invoice' && !doc.dueDate) doc.dueDate = new Date(now.getTime() + business.invoiceDueDays * 86_400_000);
  if (doc.type === 'quotation' && !doc.validUntil) doc.validUntil = new Date(now.getTime() + business.quotationValidDays * 86_400_000);
  if (doc.type === 'contract') {
    const { vars } = await contractVars(doc, business);
    doc.set('contract.body', renderContractBody(business.contractTemplate || DEFAULT_CONTRACT_TEMPLATE, vars));
  }
  doc.balance = doc.type === 'invoice' ? round2((doc.total ?? 0) - (doc.amountPaid ?? 0)) : 0;
  doc.status = 'issued';
  const { contractTemplate: _t, ...snapshot } = business;
  doc.set('signing', {
    signedAt: business.autoSign ? now : undefined,
    signatoryName: business.signatoryName,
    signatoryTitle: business.signatoryTitle,
    signatureAssetId: business.autoSign ? assets.signature?._id : undefined,
    stampAssetId: business.autoSign ? assets.stamp?._id : undefined,
    logoAssetId: assets.logo?._id,
    business: snapshot,
  });
  doc.set('signing.hash', contentHash(doc));
  doc.history.push({ at: now, action: business.autoSign ? 'issued_and_signed' : 'issued', byName: actor.name });
  await doc.save();
  return doc;
}

/**
 * Records a completed payment against an invoice and, once a subscription invoice is fully paid,
 * extends the facility's subscription. Safe to call repeatedly for the same document.
 */
export async function applyPayment(docId: unknown, amount: number, note: string) {
  const { BillingDocument } = meta();
  const doc = await BillingDocument.findById(docId);
  if (!doc || doc.type !== 'invoice') return null;
  doc.amountPaid = round2((doc.amountPaid ?? 0) + amount);
  doc.balance = round2(Math.max(0, (doc.total ?? 0) - doc.amountPaid));
  if (doc.status !== 'void') doc.status = doc.balance <= 0 ? 'paid' : 'partially_paid';
  doc.history.push({ at: new Date(), action: 'payment', note: `${kes(amount, doc.currency ?? 'KES')} ${note}${doc.amountPaid > (doc.total ?? 0) ? ' (overpayment recorded)' : ''}` });
  await doc.save();
  if (doc.status === 'paid') await applySubscription(doc).catch((err) => logger.error({ err, doc: doc.number }, 'subscription extension failed'));
  return doc;
}

async function applySubscription(doc: BillingDoc) {
  if (!doc.tenantId || doc.subscriptionAppliedAt) return;
  const line = (doc.lines ?? []).find((l) => l.kind === 'subscription' && l.planKey);
  if (!line) return;
  const { TenantSubscription, SubscriptionPlan } = meta();
  const plan = await SubscriptionPlan.findOne({ key: line.planKey }).lean();
  if (!plan) return;
  const months = (CYCLE_MONTHS[line.billingCycle ?? 'monthly'] ?? 1) * Math.max(1, Math.round(line.periods ?? line.quantity ?? 1));
  const sub = await TenantSubscription.findOne({ tenantId: doc.tenantId }).sort({ createdAt: -1 });
  const now = new Date();
  // Paid time starts when the current paid period ends; a trial is replaced from today.
  const from = sub && sub.status === 'active' && sub.endsAt && sub.endsAt > now ? sub.endsAt : now;
  const endsAt = new Date(from);
  endsAt.setMonth(endsAt.getMonth() + months);
  const update = { plan: plan.key, status: 'active' as const, billingCycle: (line.billingCycle ?? 'monthly') as 'monthly' | 'quarterly' | 'annual', amount: line.unitPrice, maxBranches: Math.max(plan.maxBranches, sub?.maxBranches ?? 1), maxUsers: Math.max(plan.maxUsers, sub?.maxUsers ?? 1), endsAt };
  if (sub) {
    sub.set(update);
    await sub.save();
  } else await TenantSubscription.create({ tenantId: doc.tenantId, startsAt: now, ...update });
  doc.subscriptionAppliedAt = now;
  doc.history.push({ at: now, action: 'subscription_extended', note: `${plan.name} until ${fmtDate(endsAt)}` });
  await doc.save();
  clearEntitlementCache(String(doc.tenantId));
  await meta().PlatformAuditLog.create({ actorType: 'system', action: 'subscription.paid_extension', resource: 'subscription', resourceId: String(doc.tenantId), tenantId: doc.tenantId, newValue: { invoice: doc.number, plan: plan.key, endsAt } }).catch(() => undefined);
}
