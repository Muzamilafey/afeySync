import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { TenantModels } from '../../models/tenant';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { nextNumber, round2 } from '../common/helpers';

type InvoiceDoc = NonNullable<Awaited<ReturnType<TenantModels['Invoice']['findOne']>>>;
type Id = string | Types.ObjectId;

/** Standard price lists. A service without a price on a list falls back to its cash price. */
export const STANDARD_PRICE_LISTS = ['cash', 'sha', 'insurance', 'foreigner'] as const;
export const isForeigner = (nationality?: string | null) => !!nationality && !/^\s*kenya/i.test(nationality);
/** SHA and insurance payers use their own lists; a cash-paying non-Kenyan pays the foreigner rate. */
export const priceListFor = (payerType?: string | null, nationality?: string | null) =>
  payerType === 'sha' ? 'sha' : payerType === 'insurance' || payerType === 'corporate' ? 'insurance' : isForeigner(nationality) ? 'foreigner' : 'cash';

export async function resolvePrice(m: TenantModels, serviceCode: string, priceList: string) {
  const item = await m.ServiceItem.findOne({ code: serviceCode.toUpperCase(), active: true }).lean();
  if (!item) return null;
  // A scheme's own list falls back to the general insurance list, then to cash.
  const chain = (STANDARD_PRICE_LISTS as readonly string[]).includes(priceList) ? [priceList, 'cash'] : [priceList, 'insurance', 'cash'];
  const price = chain.map((l) => item.prices.find((p) => p.priceList === l)).find(Boolean);
  return { item, unitPrice: price?.amount ?? null };
}

type PayerTerms = { type?: string | null; schemeId?: unknown; coverage?: string | null; copay?: { type?: string | null; value?: number | null } | null } | null | undefined;

/**
 * Splits a scheme patient's bill: the copay is the patient's share, the rest is the insurer's or
 * employer's. Under capitation the scheme's share is covered by its monthly fee, so it is not owed per visit.
 */
export function schemeSplit(payer: PayerTerms, amount: number) {
  if (!payer?.schemeId || !['insurance', 'corporate'].includes(payer.type ?? '')) return { patientShare: amount, payerShare: 0, capitation: 0 };
  const v = Math.max(0, payer.copay?.value ?? 0);
  const copay = payer.copay?.type === 'fixed' ? Math.min(v, amount) : payer.copay?.type === 'percent' ? round2((amount * Math.min(v, 100)) / 100) : 0;
  const covered = round2(amount - copay);
  return payer.coverage === 'capitation' ? { patientShare: copay, payerShare: 0, capitation: covered } : { patientShare: copay, payerShare: covered, capitation: 0 };
}

/** Recompute totals and payment status from lines, adjustments, payments and credit notes. */
export async function recalcInvoice(m: TenantModels, inv: InvoiceDoc) {
  const lines = inv.lines.filter((l) => !l.voided);
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = round2(inv.adjustments.filter((a) => a.type === 'discount').reduce((s, a) => s + a.amount, 0));
  const waiver = round2(inv.adjustments.filter((a) => a.type === 'waiver').reduce((s, a) => s + a.amount, 0));
  const afterAdjustments = round2(Math.max(0, gross - discount - waiver));
  const split = schemeSplit(inv.payer, afterAdjustments);
  const net = round2(afterAdjustments - split.capitation);
  const payments = await m.Payment.find({ invoiceId: inv._id, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).lean();
  const paid = round2(payments.reduce((s, p) => s + p.amount - (p.refundedAmount ?? 0), 0));
  const credits = await m.CreditNote.find({ invoiceId: inv._id, type: 'credit' }).lean();
  const credited = round2(credits.reduce((s, c) => s + c.amount, 0));
  const balance = round2(net - paid - credited);
  inv.totals = { gross, discount, waiver, net, paid, credited, balance, ...split };
  if (inv.status !== 'void') {
    if ((net > 0 || split.capitation > 0) && balance <= 0) inv.status = 'paid';
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
    const patient = await m.Patient.findById(input.patientId).select('nationality').lean();
    const scheme = visit?.payer?.schemeId && ['insurance', 'corporate'].includes(payerType) ? await m.PayerScheme.findById(visit.payer.schemeId).lean() : null;
    const inv = await m.Invoice.create({
      invoiceNumber: await nextNumber(m, 'invoice', 'INV'),
      patientId: input.patientId,
      visitId: input.visitId,
      branchId: input.branchId,
      payer: scheme
        ? { type: payerType, priceList: scheme.priceList, scheme: scheme.name, schemeId: scheme._id, coverage: scheme.coverage, copay: { type: scheme.copay?.type ?? 'none', value: scheme.copay?.value ?? 0 }, memberNumber: visit?.payer?.memberNumber }
        : { type: payerType, priceList: priceListFor(payerType, patient?.nationality), scheme: visit?.payer?.scheme, memberNumber: visit?.payer?.memberNumber },
      createdBy: input.createdBy,
    });
    await m.Visit.updateOne({ _id: input.visitId }, { invoiceId: inv._id });
    return inv;
  }
  const walkIn = await m.Patient.findById(input.patientId).select('nationality').lean();
  return m.Invoice.create({ invoiceNumber: await nextNumber(m, 'invoice', 'INV'), patientId: input.patientId, branchId: input.branchId, payer: { type: 'cash', priceList: priceListFor('cash', walkIn?.nationality) }, createdBy: input.createdBy });
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

/** Records a cashier payment on an invoice (cash, card, bank, M-Pesa receipt or insurance), with the usual checks. */
export async function takePayment(req: Request, m: TenantModels, inv: InvoiceDoc, body: { method: 'cash' | 'card' | 'bank' | 'insurance' | 'mpesa'; amount: number; reference?: string; idempotencyKey: string; notes?: string }) {
  if (['card', 'bank', 'mpesa', 'insurance'].includes(body.method) && !body.reference) throw badRequest('A transaction reference is required for this payment method');
  if (body.method === 'mpesa' && (await m.Payment.exists({ 'mpesa.receiptNumber': body.reference!.toUpperCase() }))) throw conflict('This M-Pesa receipt has already been used', undefined, 'DUPLICATE_RECEIPT');
  assertPayable(inv, body.amount);
  const p = await m.Payment.create({
    invoiceId: inv._id,
    patientId: inv.patientId,
    branchId: inv.branchId,
    method: body.method,
    amount: round2(body.amount),
    reference: body.reference,
    idempotencyKey: body.idempotencyKey,
    status: 'pending',
    receivedBy: req.user!.id,
    receivedByName: req.user!.name,
    notes: body.notes,
    ...(body.method === 'mpesa' ? { mpesa: { receiptNumber: body.reference!.toUpperCase() } } : {}),
  });
  await completePayment(m, p);
  return p;
}

export function assertPayable(inv: InvoiceDoc, amount: number) {
  if (inv.status === 'void') throw conflict('Invoice is void', undefined, 'INVOICE_VOID');
  if (amount <= 0) throw badRequest('Amount must be positive');
  if (amount > round2(inv.totals?.balance ?? 0) + 0.001) throw new AppError(422, 'OVERPAYMENT', `Amount exceeds the outstanding balance (${inv.totals?.balance ?? 0})`);
}
