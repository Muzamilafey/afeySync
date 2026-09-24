import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { TenantModels } from '../../models/tenant';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { nextNumber, round2 } from '../common/helpers';

type InvoiceDoc = NonNullable<Awaited<ReturnType<TenantModels['Invoice']['findOne']>>>;
type Id = string | Types.ObjectId;

export const priceListFor = (payerType?: string | null) => (payerType === 'sha' ? 'sha' : payerType === 'insurance' || payerType === 'corporate' ? 'insurance' : 'cash');

export async function resolvePrice(m: TenantModels, serviceCode: string, priceList: string) {
  const item = await m.ServiceItem.findOne({ code: serviceCode.toUpperCase(), active: true }).lean();
  if (!item) return null;
  const price = item.prices.find((p) => p.priceList === priceList) ?? item.prices.find((p) => p.priceList === 'cash');
  return { item, unitPrice: price?.amount ?? null };
}

/** Recompute totals and payment status from lines, adjustments, payments and credit notes. */
export async function recalcInvoice(m: TenantModels, inv: InvoiceDoc) {
  const lines = inv.lines.filter((l) => !l.voided);
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = round2(inv.adjustments.filter((a) => a.type === 'discount').reduce((s, a) => s + a.amount, 0));
  const waiver = round2(inv.adjustments.filter((a) => a.type === 'waiver').reduce((s, a) => s + a.amount, 0));
  const net = round2(Math.max(0, gross - discount - waiver));
  const payments = await m.Payment.find({ invoiceId: inv._id, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).lean();
  const paid = round2(payments.reduce((s, p) => s + p.amount - (p.refundedAmount ?? 0), 0));
  const credits = await m.CreditNote.find({ invoiceId: inv._id, type: 'credit' }).lean();
  const credited = round2(credits.reduce((s, c) => s + c.amount, 0));
  const balance = round2(net - paid - credited);
  inv.totals = { gross, discount, waiver, net, paid, credited, balance };
  if (inv.status !== 'void') {
    if (net > 0 && balance <= 0) inv.status = 'paid';
    else if (paid > 0) inv.status = 'partially_paid';
    else if (inv.status === 'paid' || inv.status === 'partially_paid') inv.status = inv.issuedAt ? 'issued' : 'open';
  }
  await inv.save();
  return inv;
}

/** One open invoice per visit (or per patient+branch for walk-ins without a visit). */
export async function openInvoiceFor(m: TenantModels, input: { patientId: Id; visitId?: Id | null; branchId: Id; createdBy?: Id }) {
  if (input.visitId) {
    const existing = await m.Invoice.findOne({ visitId: input.visitId, status: { $ne: 'void' } }).sort({ createdAt: -1 });
    if (existing) return existing;
    const visit = await m.Visit.findById(input.visitId).lean();
    const payerType = visit?.payer?.type ?? 'cash';
    const inv = await m.Invoice.create({
      invoiceNumber: await nextNumber(m, 'invoice', 'INV'),
      patientId: input.patientId,
      visitId: input.visitId,
      branchId: input.branchId,
      payer: { type: payerType, priceList: priceListFor(payerType), scheme: visit?.payer?.scheme, memberNumber: visit?.payer?.memberNumber },
      createdBy: input.createdBy,
    });
    await m.Visit.updateOne({ _id: input.visitId }, { invoiceId: inv._id });
    return inv;
  }
  return m.Invoice.create({ invoiceNumber: await nextNumber(m, 'invoice', 'INV'), patientId: input.patientId, branchId: input.branchId, createdBy: input.createdBy });
}

export interface ChargeInput {
  patientId: Id;
  visitId?: Id | null;
  branchId: Id;
  serviceCode: string;
  quantity?: number;
  description?: string;
  /** Idempotency: a charge for the same source+sourceId is posted only once. */
  source: string;
  sourceId: string;
  unitPriceOverride?: number;
  invoiceId?: Id;
}

/**
 * Central charge posting used by every clinical module. Missing prices never block clinical care:
 * the line is posted at 0 and flagged "[PRICE NOT SET]" so billing staff can reprice it.
 */
/** Invoice holding a live (non-voided) line for this source. Filtered in code to stay portable across MongoDB-compatible engines. */
async function invoiceWithSourceLine(m: TenantModels, source: string, sourceId: string) {
  const candidates = await m.Invoice.find({ 'lines.sourceId': sourceId, status: { $ne: 'void' } });
  return candidates.find((inv) => inv.lines.some((l) => l.source === source && l.sourceId === sourceId && !l.voided)) ?? null;
}

export async function postCharge(req: Request | null, m: TenantModels, input: ChargeInput) {
  const existing = await invoiceWithSourceLine(m, input.source, input.sourceId);
  if (existing) return { invoice: existing, duplicate: true };
  const inv = input.invoiceId ? await m.Invoice.findById(input.invoiceId) : await openInvoiceFor(m, { patientId: input.patientId, visitId: input.visitId, branchId: input.branchId, createdBy: req?.user?.id });
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'void') throw conflict('Invoice is void', undefined, 'INVOICE_VOID');
  const priced = await resolvePrice(m, input.serviceCode, inv.payer?.priceList ?? 'cash');
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPriceOverride ?? priced?.unitPrice ?? 0;
  const unpriced = input.unitPriceOverride === undefined && (priced?.unitPrice == null);
  inv.lines.push({
    serviceCode: input.serviceCode.toUpperCase(),
    description: `${input.description ?? priced?.item.name ?? input.serviceCode}${unpriced ? ' [PRICE NOT SET]' : ''}`,
    category: priced?.item.category ?? 'other',
    quantity,
    unitPrice,
    amount: round2(quantity * unitPrice),
    source: input.source,
    sourceId: input.sourceId,
    addedBy: req?.user?.id,
  } as never);
  await recalcInvoice(m, inv);
  return { invoice: inv, duplicate: false, unpriced };
}

/** Void the (non-paid) charge that originated from a source, e.g. a cancelled lab test. */
export async function voidChargeForSource(m: TenantModels, source: string, sourceId: string, reason: string, by?: Id) {
  const inv = await invoiceWithSourceLine(m, source, sourceId);
  if (!inv) return null;
  const line = inv.lines.find((l) => l.source === source && l.sourceId === sourceId && !l.voided)!;
  line.voided = true;
  line.voidReason = reason;
  line.voidedBy = by as never;
  await recalcInvoice(m, inv);
  return inv;
}

export async function completePayment(m: TenantModels, payment: NonNullable<Awaited<ReturnType<TenantModels['Payment']['findOne']>>>) {
  if (!payment.receiptNumber) payment.receiptNumber = await nextNumber(m, 'receipt', 'RCT');
  payment.status = payment.invoiceId ? 'completed' : 'unallocated';
  payment.completedAt = new Date();
  await payment.save();
  if (payment.invoiceId) {
    const inv = await m.Invoice.findById(payment.invoiceId);
    if (inv) await recalcInvoice(m, inv);
  }
  return payment;
}

export function assertPayable(inv: InvoiceDoc, amount: number) {
  if (inv.status === 'void') throw conflict('Invoice is void', undefined, 'INVOICE_VOID');
  if (amount <= 0) throw badRequest('Amount must be positive');
  if (amount > round2(inv.totals?.balance ?? 0) + 0.001) throw new AppError(422, 'OVERPAYMENT', `Amount exceeds the outstanding balance (${inv.totals?.balance ?? 0})`);
}
