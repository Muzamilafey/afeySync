import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { parse, pagination } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid, round2 } from '../common/helpers';
import { postCharge, priceListFor, recalcInvoice, takePayment } from '../billing/billingService';
import { accessiblePatient } from '../frontdesk/visits.routes';
import { allocateFefo } from './stockService';
import { allergyConflicts } from './allergyCheck';
import { billingCodeOf } from './itemPrices';
import type { TenantModels } from '../../models/tenant';
import { checkStk, sendStkForInvoice } from '../billing/mpesa.routes';
import { promptGateway } from '../../integrations/payments/promptGateway';
import { toMsisdn } from '../../integrations/mpesa/mpesaService';

/**
 * Pharmacy point of sale: counter sales to walk-in customers and patients bringing an outside
 * prescription. Prices come from the price list on the server; stock leaves in expiry order (FEFO);
 * every sale is an invoice, so the cashier, receipts, refunds and reports all see it.
 */
const router = Router();
router.use(authenticateTenant);

/** The branch's shared "walk-in customer" account for anonymous counter sales (hidden from patient lists). */
async function walkInAccount(m: TenantModels, branchId: string) {
  const branch = await m.Branch.findById(branchId).select('branchCode').lean();
  const number = `WALKIN-${(branch as { branchCode?: string } | null)?.branchCode ?? branchId.slice(-6)}`.toUpperCase();
  const existing = await m.Patient.findOne({ patientNumber: number });
  if (existing) return existing;
  try {
    return await m.Patient.create({ patientNumber: number, firstName: 'Walk-in', lastName: 'Customer', gender: 'unknown', registeredBranchId: branchId, branchIds: [branchId], walkInAccount: true });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return (await m.Patient.findOne({ patientNumber: number }))!;
    throw err;
  }
}

const saleSchema = z.object({
  locationId: z.string(),
  patientId: z.string().optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(20).regex(/^[0-9+ ]*$/, 'Enter a valid phone number').optional(),
  externalPrescription: z.object({ prescriber: z.string().trim().max(120).optional(), facility: z.string().trim().max(160).optional(), reference: z.string().trim().max(60).optional() }).optional(),
  lines: z.array(z.object({ itemId: z.string(), quantity: z.number().int('Whole units only').min(1).max(100_000) })).min(1, 'Add at least one item').max(60),
  overrideAllergy: z.object({ reason: z.string().trim().min(5).max(300) }).optional(),
  payment: z
    .object({ method: z.enum(['cash', 'card', 'bank', 'mpesa']), reference: z.string().trim().max(80).optional(), idempotencyKey: z.string().min(8).max(100) })
    .optional(),
  /** Send an M-Pesa prompt to the customer's phone instead of taking payment at the counter. */
  mpesaPrompt: z.object({ phone: z.string().trim().min(9).max(20), idempotencyKey: z.string().min(8).max(100) }).optional(),
});

const promptSchema = z.object({ phone: z.string().trim().min(9).max(20), idempotencyKey: z.string().min(8).max(100) });

/** Sends the prompt for a sale's balance; a failure to reach Safaricom leaves the sale awaiting payment, never paid. */
async function promptForSale(req: Request, m: TenantModels, sale: { saleNumber?: string | null; invoiceId?: unknown; paymentMethod?: string | null; save: () => Promise<unknown> }, input: z.infer<typeof promptSchema>) {
  const inv = await m.Invoice.findById(sale.invoiceId);
  if (!inv) throw notFound('Invoice not found');
  const r = await sendStkForInvoice(req, inv, { phone: input.phone, amount: inv.totals?.balance ?? 0, idempotencyKey: input.idempotencyKey, description: 'Pharmacy', notes: `Pharmacy sale ${sale.saleNumber}` });
  sale.paymentMethod = 'mpesa';
  await sale.save();
  return r;
}

router.post(
  '/sales',
  requirePermission('pharmacy.sell'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(saleSchema, req.body);
    const m = req.tenant!.models;
    if (body.payment && !req.user!.permissions.has('billing.create')) throw forbidden('You can make the sale, but payment must be taken at the cashier (Billing & Cashier).');
    if (body.payment && body.mpesaPrompt) throw badRequest('Choose one way to pay');
    // Checked before any stock moves: the facility must have M-Pesa set up, and the number must be a Safaricom line.
    if (body.mpesaPrompt) {
      toMsisdn(body.mpesaPrompt.phone);
      await promptGateway('facility', req.tenant!.id);
    }
    const loc = await loadScoped(req, m.StockLocation, body.locationId, 'Stock location');
    const codes = [...new Set(body.lines.map((l) => l.itemId))];
    if (codes.length !== body.lines.length) throw badRequest('Each item can appear only once; change its quantity instead');
    const items = await m.Item.find({ _id: { $in: codes.map((c) => oid(c, 'Item')) }, active: true }).lean();
    if (items.length !== codes.length) throw notFound('One of the items was not found or is inactive');

    const patient = body.patientId ? await accessiblePatient(req, body.patientId) : await walkInAccount(m, String(loc.branchId));
    if (!body.patientId && !body.customerName) throw badRequest('Enter the customer’s name, or choose a registered patient');
    // Allergy check for registered patients (walk-in customers have no record to check).
    if (body.patientId) {
      const hits = items.flatMap((i) => allergyConflicts(patient.allergies ?? [], [i.name, i.genericName ?? '', i.brand ?? '']).map((a) => `${i.name} ↔ allergy to ${a}`));
      if (hits.length && !body.overrideAllergy) throw new AppError(422, 'ALLERGY_ALERT', `Possible allergy conflict: ${hits.join('; ')}`, hits);
    }
    // Prices must exist before anything is taken from stock.
    const priceList = priceListFor('cash', patient.nationality);
    const services = await m.ServiceItem.find({ code: { $in: items.map(billingCodeOf) }, active: true }).lean();
    const priceOf = (code: string) => {
      const sv = services.find((x) => x.code === code);
      return sv?.prices.find((p) => p.priceList === priceList)?.amount ?? sv?.prices.find((p) => p.priceList === 'cash')?.amount;
    };
    const unpriced = items.filter((i) => priceOf(billingCodeOf(i)) == null);
    if (unpriced.length) throw new AppError(422, 'PRICE_NOT_SET', `Set a selling price first for: ${unpriced.map((i) => i.name).join(', ')}`);

    const taken: Array<{ itemId: string; alloc: Awaited<ReturnType<typeof allocateFefo>> }> = [];
    try {
      for (const l of body.lines) taken.push({ itemId: l.itemId, alloc: await allocateFefo(m, { itemId: l.itemId, locationId: loc._id, quantity: l.quantity }) });
    } catch (err) {
      for (const t of taken) for (const a of t.alloc) await m.Batch.updateOne({ _id: a.batchId }, { $inc: { quantity: a.quantity } });
      if (err instanceof AppError && err.code === 'INSUFFICIENT_STOCK') {
        const short = items.find((i) => String(i._id) === body.lines[taken.length]?.itemId);
        throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough ${short?.name ?? 'stock'}: ${err.message}`, err.details);
      }
      throw err;
    }

    const saleNumber = await nextNumber(m, 'possale', 'POS');
    const inv = await m.Invoice.create({ invoiceNumber: await nextNumber(m, 'invoice', 'INV'), patientId: patient._id, branchId: loc.branchId, payer: { type: 'cash', priceList }, createdBy: req.user!.id });
    const lines = [];
    for (const l of body.lines) {
      const item = items.find((i) => String(i._id) === l.itemId)!;
      const alloc = taken.find((t) => t.itemId === l.itemId)!.alloc;
      await postCharge(req, m, { patientId: patient._id, branchId: loc.branchId, serviceCode: billingCodeOf(item), quantity: l.quantity, description: `${item.name}${item.strength ? ` ${item.strength}` : ''}`, source: 'pos', sourceId: `${saleNumber}:${item._id}`, invoiceId: inv._id });
      const unitPrice = priceOf(billingCodeOf(item))!;
      lines.push({ itemId: item._id, name: `${item.name}${item.strength ? ` ${item.strength}` : ''}`, quantity: l.quantity, unitPrice, amount: round2(unitPrice * l.quantity), batches: alloc.map((a) => ({ batchId: a.batchId, batchNumber: a.batchNumber, expiryDate: a.expiryDate, quantity: a.quantity })) });
      for (const a of alloc) await m.StockMovement.create({ itemId: item._id, batchId: a.batchId, locationId: loc._id, branchId: loc.branchId, type: 'dispense', quantity: -a.quantity, reference: saleNumber, by: req.user!.id });
    }
    const fresh = (await m.Invoice.findById(inv._id))!;
    fresh.status = 'issued';
    fresh.issuedAt = new Date();
    await recalcInvoice(m, fresh);
    const sale = await m.PharmacySale.create({
      saleNumber, branchId: loc.branchId, locationId: loc._id, patientId: patient._id, walkIn: !body.patientId,
      customerName: body.patientId ? [patient.firstName, patient.lastName].join(' ') : body.customerName, customerPhone: body.customerPhone ?? (body.patientId ? patient.phone : undefined),
      externalPrescription: body.externalPrescription, lines, total: fresh.totals?.net ?? 0, invoiceId: inv._id, invoiceNumber: inv.invoiceNumber,
      soldBy: req.user!.id, soldByName: req.user!.name,
    });
    let receipt: string | undefined;
    if (body.payment && (fresh.totals?.balance ?? 0) > 0) {
      const p = await takePayment(req, m, fresh, { method: body.payment.method, amount: fresh.totals!.balance, reference: body.payment.reference, idempotencyKey: body.payment.idempotencyKey, notes: `Pharmacy sale ${saleNumber}` });
      receipt = p.receiptNumber ?? undefined;
      sale.status = 'paid';
      sale.paymentMethod = body.payment.method;
      await sale.save();
    }
    let mpesa: { paymentId?: string; message?: string; error?: string } | undefined;
    if (body.mpesaPrompt && (fresh.totals?.balance ?? 0) > 0) {
      try {
        const r = await promptForSale(req, m, sale, body.mpesaPrompt);
        mpesa = { paymentId: String(r.payment._id), message: r.message };
      } catch (err) {
        // The sale stands (stock has left the shelf); the prompt can be sent again or the customer can pay another way.
        mpesa = { error: (err as Error).message };
      }
    }
    await audit(req, { action: 'pharmacy.pos_sale', resource: 'pharmacy_sale', resourceId: String(sale._id), newValue: { saleNumber, total: sale.total, lines: lines.map((l) => ({ item: l.name, qty: l.quantity })), external: body.externalPrescription, allergyOverride: body.overrideAllergy?.reason } });
    res.status(201).json({ success: true, data: { sale, receiptNumber: receipt, mpesa } });
  }),
);

/** Marks sales paid once their invoice is settled elsewhere (cashier, M-Pesa prompt). */
async function refreshPaid(m: TenantModels, sales: Array<{ _id: unknown; status?: string | null; invoiceId?: unknown }>) {
  const waiting = sales.filter((s) => s.status === 'awaiting_payment' && s.invoiceId);
  if (!waiting.length) return;
  const paid = await m.Invoice.find({ _id: { $in: waiting.map((s) => s.invoiceId as Types.ObjectId) }, status: 'paid' }).select('_id').lean();
  const ids = new Set(paid.map((p) => String(p._id)));
  for (const s of waiting) if (ids.has(String(s.invoiceId))) {
    s.status = 'paid';
    await m.PharmacySale.updateOne({ _id: s._id, status: 'awaiting_payment' }, { status: 'paid' });
  }
}

router.get(
  '/sales',
  requireAnyPermission('pharmacy.sell', 'pharmacy.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req), createdAt: dayRange(req.query.from, req.query.to ?? req.query.from) };
    if (req.query.status) filter.status = String(req.query.status);
    const [rows, total] = await Promise.all([m.PharmacySale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.PharmacySale.countDocuments(filter)]);
    await refreshPaid(m, rows);
    res.json({ success: true, data: rows, meta: { page, limit, total } });
  }),
);

router.get(
  '/sales/:id',
  requireAnyPermission('pharmacy.sell', 'pharmacy.view', 'billing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const sale = await loadScoped(req, m.PharmacySale, req.params.id, 'Sale');
    await refreshPaid(m, [sale]);
    const [invoice, payments, location] = await Promise.all([
      m.Invoice.findById(sale.invoiceId).select('invoiceNumber status totals').lean(),
      m.Payment.find({ invoiceId: sale.invoiceId, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).select('receiptNumber method amount reference completedAt receivedByName').lean(),
      m.StockLocation.findById(sale.locationId).select('name').lean(),
    ]);
    res.json({ success: true, data: { sale, invoice, payments, location } });
  }),
);

/** Sends (or re-sends) an M-Pesa prompt for a sale that is still awaiting payment. */
router.post(
  '/sales/:id/mpesa',
  requirePermission('pharmacy.sell'),
  h(async (req, res) => {
    const body = parse(promptSchema, req.body);
    const m = req.tenant!.models;
    const sale = await loadScoped(req, m.PharmacySale, req.params.id, 'Sale');
    await refreshPaid(m, [sale]);
    if (sale.status !== 'awaiting_payment') throw conflict(sale.status === 'paid' ? 'This sale is already paid' : 'This sale can no longer be paid', undefined, 'SALE_NOT_PAYABLE');
    const r = await promptForSale(req, m, sale, body);
    res.status(r.replay ? 200 : 201).json({ success: true, data: { paymentId: String(r.payment._id), payment: r.payment }, message: r.message });
  }),
);

/** Where the sale's latest M-Pesa prompt stands. With ?check=1 a still-pending prompt is looked up with Safaricom. */
router.get(
  '/sales/:id/mpesa',
  requireAnyPermission('pharmacy.sell', 'billing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const sale = await loadScoped(req, m.PharmacySale, req.params.id, 'Sale');
    let p = await m.Payment.findOne({ invoiceId: sale.invoiceId, 'mpesa.checkoutRequestId': { $exists: true } }).sort({ createdAt: -1 });
    if (p && req.query.check === '1' && p.status === 'pending' && Date.now() - p.createdAt!.getTime() > 20_000) p = (await checkStk(req, p)).payment;
    await refreshPaid(m, [sale]);
    res.json({ success: true, data: { saleStatus: sale.status, payment: p && { _id: p._id, status: p.status, amount: p.amount, phone: p.mpesa?.phone ? `***${p.mpesa.phone.slice(-3)}` : undefined, receiptNumber: p.receiptNumber, mpesaReceipt: p.mpesa?.receiptNumber, resultDesc: p.mpesa?.resultDesc } } });
  }),
);

/** Items brought back: stock goes back to the batches it came from and the bill is reduced; money is refunded at the cashier. */
router.post(
  '/sales/:id/return',
  requirePermission('pharmacy.sell'),
  h(async (req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(5, 'Give the reason').max(300), lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().min(1) })).min(1) }), req.body);
    const m = req.tenant!.models;
    const sale = await loadScoped(req, m.PharmacySale, req.params.id, 'Sale');
    const inv = await m.Invoice.findById(sale.invoiceId);
    if (!inv) throw notFound('Invoice not found');
    const returned: Array<{ lineId: unknown; quantity: number; amount: number }> = [];
    for (const r of body.lines) {
      const line = sale.lines.id(oid(r.lineId, 'Line'));
      if (!line) throw notFound('Sale line not found');
      if (r.quantity > line.quantity - (line.returnedQuantity ?? 0)) throw new AppError(422, 'RETURN_EXCEEDS_SOLD', `Only ${line.quantity - (line.returnedQuantity ?? 0)} of ${line.name} can be returned`);
      // Put units back, newest-expiry batch first (the reverse of how they left).
      let left = r.quantity;
      for (const b of [...line.batches].reverse()) {
        if (left <= 0) break;
        const back = Math.min(left, b.quantity ?? 0);
        if (!back) continue;
        await m.Batch.updateOne({ _id: b.batchId }, { $inc: { quantity: back } });
        await m.StockMovement.create({ itemId: line.itemId, batchId: b.batchId, locationId: sale.locationId, branchId: sale.branchId, type: 'return', quantity: back, reference: sale.saleNumber, reason: body.reason, by: req.user!.id });
        left -= back;
      }
      line.returnedQuantity = (line.returnedQuantity ?? 0) + r.quantity;
      const invLine = inv.lines.find((l) => l.source === 'pos' && l.sourceId === `${sale.saleNumber}:${line.itemId}` && !l.voided);
      if (invLine) {
        invLine.quantity = Math.max(0, invLine.quantity - r.quantity);
        invLine.amount = round2(invLine.quantity * invLine.unitPrice);
      }
      returned.push({ lineId: line._id, quantity: r.quantity, amount: round2(r.quantity * (line.unitPrice ?? 0)) });
    }
    await recalcInvoice(m, inv);
    sale.returns.push({ at: new Date(), byName: req.user!.name, reason: body.reason, lines: returned } as never);
    if (sale.lines.every((l) => (l.returnedQuantity ?? 0) >= l.quantity)) sale.status = 'returned';
    await sale.save();
    const refundDue = round2(Math.max(0, -(inv.totals?.balance ?? 0)));
    await audit(req, { action: 'pharmacy.pos_return', resource: 'pharmacy_sale', resourceId: String(sale._id), newValue: { ...body, refundDue } });
    res.json({ success: true, data: { sale, refundDue, message: refundDue > 0 ? `Refund KES ${refundDue} to the customer from Billing & Cashier (${inv.invoiceNumber}).` : 'Items returned to stock.' } });
  }),
);

/**
 * Z-report (end of day) for the pharmacy: counter sales and takings by payment method and by person,
 * returns, and the dispensing summary for prescriptions (OPD and wards).
 */
router.get(
  '/z-report',
  requireAnyPermission('pharmacy.sell', 'pharmacy.view', 'billing.view'),
  requireBranch,
  h(async (req, res) => {
    const m = req.tenant!.models;
    const range = dayRange(req.query.date, req.query.date);
    const branchId = req.branch!.id;
    const sales = await m.PharmacySale.find({ branchId, createdAt: range }).lean();
    await refreshPaid(m, sales);
    const invoiceIds = sales.map((s) => s.invoiceId).filter(Boolean) as Types.ObjectId[];
    const payments = await m.Payment.find({ invoiceId: { $in: invoiceIds }, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).select('method amount refundedAmount receivedByName').lean();
    const byMethod: Record<string, number> = {};
    for (const p of payments) byMethod[p.method] = round2((byMethod[p.method] ?? 0) + p.amount - (p.refundedAmount ?? 0));
    const bySeller = new Map<string, { name: string; sales: number; value: number }>();
    const itemsSold = new Map<string, { name: string; quantity: number; value: number }>();
    let returnsValue = 0;
    for (const s of sales) {
      const k = s.soldByName ?? 'Unknown';
      const e = bySeller.get(k) ?? { name: k, sales: 0, value: 0 };
      e.sales += 1;
      e.value = round2(e.value + (s.total ?? 0));
      bySeller.set(k, e);
      for (const l of s.lines) {
        const qty = l.quantity - (l.returnedQuantity ?? 0);
        const it = itemsSold.get(String(l.itemId)) ?? { name: l.name ?? '', quantity: 0, value: 0 };
        it.quantity += qty;
        it.value = round2(it.value + qty * (l.unitPrice ?? 0));
        itemsSold.set(String(l.itemId), it);
        returnsValue = round2(returnsValue + (l.returnedQuantity ?? 0) * (l.unitPrice ?? 0));
      }
    }
    const rxs = await m.Prescription.find({ branchId, 'dispenses.at': range }).select('rxNumber admissionId dispenses').lean();
    const dispByPerson = new Map<string, { name: string; prescriptions: number; units: number }>();
    let opd = 0;
    let ward = 0;
    for (const rx of rxs) {
      const today = rx.dispenses.filter((d) => d.at && d.at >= range.$gte && d.at <= range.$lte);
      if (!today.length) continue;
      if (rx.admissionId) ward += 1;
      else opd += 1;
      for (const d of today) {
        const k = d.byName ?? 'Unknown';
        const e = dispByPerson.get(k) ?? { name: k, prescriptions: 0, units: 0 };
        e.prescriptions += 1;
        e.units += d.lines.reduce((s, l) => s + (l.quantity ?? 0), 0);
        dispByPerson.set(k, e);
      }
    }
    res.json({
      success: true,
      data: {
        date: range.$gte,
        sales: { count: sales.length, gross: round2(sales.reduce((s, x) => s + (x.total ?? 0), 0)), paid: sales.filter((s) => s.status !== 'awaiting_payment').length, awaitingPayment: sales.filter((s) => s.status === 'awaiting_payment').length, returnsValue },
        collections: { byMethod, total: round2(Object.values(byMethod).reduce((a, b) => a + b, 0)) },
        bySeller: [...bySeller.values()],
        itemsSold: [...itemsSold.values()].filter((i) => i.quantity > 0).sort((a, b) => b.value - a.value),
        dispensing: { opdPrescriptions: opd, wardRequests: ward, byPerson: [...dispByPerson.values()] },
      },
    });
  }),
);

export default router;
export type { Request };
