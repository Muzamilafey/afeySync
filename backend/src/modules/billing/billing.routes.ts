import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse, parsePatch } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { SERVICE_CATEGORIES } from '../../models/tenant/billing';
import { actor, dayRange, loadScoped, nextNumber, oid, round2 } from '../common/helpers';
import { assertPayable, completePayment, openInvoiceFor, postCharge, recalcInvoice } from './billingService';
import { randomToken } from '../../utils/crypto';
import { forbidden } from '../../utils/errors';

const router = Router();
router.use(authenticateTenant);

/* ------------------------------------------------------------ Service catalog & price lists */
const serviceSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-_.]+$/),
  name: z.string().trim().min(2).max(160),
  category: z.enum(SERVICE_CATEGORIES),
  department: z.string().max(80).optional(),
  prices: z.array(z.object({ priceList: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/), amount: z.number().min(0).max(10_000_000) })).min(1),
  shaInterventionCode: z.string().max(40).optional(),
  active: z.boolean().optional(),
});

router.get(
  '/services',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const { ServiceItem } = req.tenant!.models;
    const filter: Record<string, unknown> = {};
    const q = String(req.query.q ?? '').trim();
    if (q) filter.$or = [{ code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) }, { name: new RegExp(escapeRegex(q), 'i') }];
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.active !== 'all') filter.active = true;
    res.json({ success: true, data: await ServiceItem.find(filter).sort({ category: 1, name: 1 }).limit(Math.min(500, Number(req.query.limit) || 200)).lean() });
  }),
);

router.post(
  '/services',
  requirePermission('billing.prices'),
  h(async (req, res) => {
    const body = parse(serviceSchema, req.body);
    const { ServiceItem } = req.tenant!.models;
    if (await ServiceItem.exists({ code: body.code.toUpperCase() })) throw conflict('Service code already exists');
    const s = await ServiceItem.create({ ...body, code: body.code.toUpperCase() });
    await audit(req, { action: 'billing.service_create', resource: 'service_item', resourceId: String(s._id), newValue: body });
    res.status(201).json({ success: true, data: s });
  }),
);

router.patch(
  '/services/:id',
  requirePermission('billing.prices'),
  h(async (req, res) => {
    const body = parsePatch(serviceSchema.omit({ code: true }).partial(), req.body);
    const { ServiceItem } = req.tenant!.models;
    const s = await ServiceItem.findById(oid(req.params.id, 'Service'));
    if (!s) throw notFound('Service not found');
    const before = s.toObject();
    s.set(body);
    await s.save();
    await audit(req, { action: 'billing.price_change', resource: 'service_item', resourceId: String(s._id), oldValue: before, newValue: s.toObject() });
    res.json({ success: true, data: s });
  }),
);

/* ------------------------------------------------------------ Invoices */
router.get(
  '/invoices',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const { Invoice } = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
    if (req.query.visitId) filter.visitId = oid(req.query.visitId, 'Visit');
    if (req.query.q) filter.invoiceNumber = String(req.query.q).toUpperCase();
    if (req.query.from || req.query.to) filter.createdAt = dayRange(req.query.from, req.query.to);
    if (req.query.outstanding === 'true') filter['totals.balance'] = { $gt: 0 };
    const [items, total] = await Promise.all([
      Invoice.find(filter).select('-lines').populate('patientId', 'patientNumber firstName lastName phone').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/invoices/:id',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const inv = await loadScoped(req, req.tenant!.models.Invoice, req.params.id, 'Invoice');
    const { Payment, CreditNote, Patient } = req.tenant!.models;
    const [payments, creditNotes, patient] = await Promise.all([
      Payment.find({ invoiceId: inv._id }).sort({ createdAt: 1 }).lean(),
      CreditNote.find({ invoiceId: inv._id }).sort({ createdAt: 1 }).lean(),
      Patient.findById(inv.patientId).select('patientNumber firstName middleName lastName phone clientRegistryId shaNumber sha').lean(),
    ]);
    res.json({ success: true, data: { ...inv.toObject(), patient, payments, creditNotes } });
  }),
);

/** Manual invoice / walk-in charges (e.g. over-the-counter services). */
router.post(
  '/invoices',
  requirePermission('billing.create'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientId: z.string(), visitId: z.string().optional(), lines: z.array(z.object({ serviceCode: z.string(), quantity: z.number().positive().max(10_000) })).min(1).max(100) }), req.body);
    const m = req.tenant!.models;
    const patient = await m.Patient.findById(oid(body.patientId, 'Patient')).lean();
    if (!patient || !canAccessAnyBranch(req, patient.branchIds ?? [])) throw notFound('Patient not found');
    if (body.visitId) await loadScoped(req, m.Visit, body.visitId, 'Visit');
    const inv = await openInvoiceFor(m, { patientId: patient._id, visitId: body.visitId, branchId: req.branch!.id, createdBy: req.user!.id });
    for (const l of body.lines) {
      const r = await postCharge(req, m, { patientId: patient._id, visitId: body.visitId, branchId: req.branch!.id, serviceCode: l.serviceCode, quantity: l.quantity, source: 'manual', sourceId: `${inv._id}:${randomToken(6)}`, invoiceId: inv._id });
      if (!r.invoice) throw notFound();
    }
    const fresh = await m.Invoice.findById(inv._id);
    await audit(req, { action: 'billing.invoice_create', resource: 'invoice', resourceId: String(inv._id), newValue: body });
    res.status(201).json({ success: true, data: fresh });
  }),
);

router.post(
  '/invoices/:id/lines',
  requirePermission('billing.create'),
  h(async (req, res) => {
    const body = parse(z.object({ serviceCode: z.string().min(2), quantity: z.number().positive().max(10_000).default(1) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if (inv.status === 'void' || inv.status === 'paid') throw conflict(`Cannot add charges to a ${inv.status} invoice`);
    const r = await postCharge(req, m, { patientId: inv.patientId, visitId: inv.visitId, branchId: inv.branchId, serviceCode: body.serviceCode, quantity: body.quantity, source: 'manual', sourceId: `${inv._id}:${randomToken(6)}`, invoiceId: inv._id });
    await audit(req, { action: 'billing.line_add', resource: 'invoice', resourceId: String(inv._id), newValue: body });
    res.status(201).json({ success: true, data: r.invoice });
  }),
);

router.post(
  '/invoices/:id/lines/:lineId/void',
  requirePermission('billing.waive'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    const line = inv.lines.id(oid(req.params.lineId, 'Line'));
    if (!line || line.voided) throw notFound('Line not found');
    line.voided = true;
    line.voidReason = reason;
    line.voidedBy = req.user!.id as never;
    await recalcInvoice(m, inv);
    if ((inv.totals?.balance ?? 0) < 0) throw new AppError(422, 'LINE_ALREADY_PAID', 'This line is covered by payments; issue a refund or credit note instead');
    await audit(req, { action: 'billing.line_void', resource: 'invoice', resourceId: String(inv._id), newValue: { lineId: req.params.lineId, reason } });
    res.json({ success: true, data: inv });
  }),
);

router.post(
  '/invoices/:id/lines/:lineId/reprice',
  requirePermission('billing.prices'),
  h(async (req, res) => {
    const { unitPrice, reason } = parse(z.object({ unitPrice: z.number().min(0).max(10_000_000), reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if (inv.status === 'void' || inv.status === 'paid') throw conflict(`Cannot reprice a ${inv.status} invoice`);
    const line = inv.lines.id(oid(req.params.lineId, 'Line'));
    if (!line || line.voided) throw notFound('Line not found');
    const before = { unitPrice: line.unitPrice, amount: line.amount };
    line.unitPrice = unitPrice;
    line.amount = round2(unitPrice * line.quantity - (line.discount ?? 0));
    line.description = line.description.replace(' [PRICE NOT SET]', '');
    await recalcInvoice(m, inv);
    await audit(req, { action: 'billing.line_reprice', resource: 'invoice', resourceId: String(inv._id), oldValue: before, newValue: { unitPrice, reason } });
    res.json({ success: true, data: inv });
  }),
);

/** Discounts and waivers require explicit permission, a reason, and are recorded with the approver. */
router.post(
  '/invoices/:id/adjustments',
  requirePermission('billing.waive'),
  h(async (req, res) => {
    const body = parse(z.object({ type: z.enum(['discount', 'waiver']), amount: z.number().positive(), reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if (inv.status === 'void') throw conflict('Invoice is void');
    if (body.amount > (inv.totals?.balance ?? 0) + 0.001) throw new AppError(422, 'ADJUSTMENT_EXCEEDS_BALANCE', 'Adjustment exceeds outstanding balance');
    inv.adjustments.push({ ...body, approvedBy: req.user!.id, approvedByName: req.user!.name } as never);
    await recalcInvoice(m, inv);
    await audit(req, { action: `billing.${body.type}`, resource: 'invoice', resourceId: String(inv._id), newValue: body });
    res.json({ success: true, data: inv });
  }),
);

router.post(
  '/invoices/:id/issue',
  requirePermission('billing.create'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if (inv.status !== 'open') throw conflict('Only open invoices can be issued');
    inv.status = 'issued';
    inv.issuedAt = new Date();
    await recalcInvoice(m, inv);
    await audit(req, { action: 'billing.invoice_issue', resource: 'invoice', resourceId: String(inv._id) });
    res.json({ success: true, data: inv });
  }),
);

router.post(
  '/invoices/:id/void',
  requirePermission('billing.refund'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if ((inv.totals?.paid ?? 0) > 0) throw conflict('Invoice has payments; refund them first', undefined, 'INVOICE_HAS_PAYMENTS');
    inv.status = 'void';
    await inv.save();
    await audit(req, { action: 'billing.invoice_void', resource: 'invoice', resourceId: String(inv._id), newValue: { reason } });
    res.json({ success: true, data: inv });
  }),
);

router.post(
  '/invoices/:id/credit-notes',
  requirePermission('billing.refund'),
  h(async (req, res) => {
    const body = parse(z.object({ amount: z.number().positive(), reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, req.params.id, 'Invoice');
    if (body.amount > (inv.totals?.balance ?? 0) + 0.001) throw new AppError(422, 'CREDIT_EXCEEDS_BALANCE', 'Credit exceeds outstanding balance');
    const cn = await m.CreditNote.create({ creditNoteNumber: await nextNumber(m, 'creditnote', 'CN'), invoiceId: inv._id, patientId: inv.patientId, branchId: inv.branchId, type: 'credit', amount: body.amount, reason: body.reason, approvedBy: req.user!.id, approvedByName: req.user!.name });
    await recalcInvoice(m, inv);
    await audit(req, { action: 'billing.credit_note', resource: 'invoice', resourceId: String(inv._id), newValue: body });
    res.status(201).json({ success: true, data: cn });
  }),
);

/* ------------------------------------------------------------ Payments (cashier) */
router.post(
  '/payments',
  requirePermission('billing.create'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        invoiceId: z.string(),
        method: z.enum(['cash', 'card', 'bank', 'insurance', 'mpesa']),
        amount: z.number().positive().max(100_000_000),
        reference: z.string().max(80).optional(),
        idempotencyKey: z.string().min(8).max(100),
        notes: z.string().max(300).optional(),
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const replay = await m.Payment.findOne({ idempotencyKey: body.idempotencyKey }).lean();
    if (replay) return res.status(200).json({ success: true, data: replay, idempotentReplay: true });
    if (['card', 'bank', 'mpesa', 'insurance'].includes(body.method) && !body.reference) throw badRequest('A transaction reference is required for this payment method');
    if (body.method === 'mpesa' && (await m.Payment.exists({ 'mpesa.receiptNumber': body.reference!.toUpperCase() }))) throw conflict('This M-Pesa receipt has already been used', undefined, 'DUPLICATE_RECEIPT');
    const inv = await loadScoped(req, m.Invoice, body.invoiceId, 'Invoice');
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
    await audit(req, { action: 'billing.payment', resource: 'payment', resourceId: String(p._id), newValue: { invoice: inv.invoiceNumber, method: body.method, amount: body.amount, receipt: p.receiptNumber } });
    res.status(201).json({ success: true, data: p });
  }),
);

router.get(
  '/payments',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const { Payment } = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.method) filter.method = String(req.query.method);
    if (req.query.invoiceId) filter.invoiceId = oid(req.query.invoiceId, 'Invoice');
    if (req.query.from || req.query.to) filter.createdAt = dayRange(req.query.from, req.query.to);
    if (req.query.q) filter.$or = [{ receiptNumber: String(req.query.q).toUpperCase() }, { reference: String(req.query.q) }, { 'mpesa.receiptNumber': String(req.query.q).toUpperCase() }];
    const [items, total] = await Promise.all([Payment.find(filter).populate('patientId', 'patientNumber firstName lastName').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Payment.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/payments/:id/receipt',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const p = await loadScoped(req, m.Payment, req.params.id, 'Payment');
    if (!p.receiptNumber) throw notFound('No receipt for this payment');
    const [inv, patient, branch] = await Promise.all([m.Invoice.findById(p.invoiceId).lean(), m.Patient.findById(p.patientId).select('patientNumber firstName lastName').lean(), m.Branch.findById(p.branchId ?? undefined).select('branchName phone physicalAddress').lean()]);
    res.json({ success: true, data: { payment: p, invoice: inv, patient, branch, facility: req.tenant!.name } });
  }),
);

router.post(
  '/payments/:id/refund',
  requirePermission('billing.refund'),
  h(async (req, res) => {
    const body = parse(z.object({ amount: z.number().positive(), reason: z.string().min(5).max(300), method: z.enum(['cash', 'mpesa', 'bank', 'card']) }), req.body);
    const m = req.tenant!.models;
    const p = await loadScoped(req, m.Payment, req.params.id, 'Payment');
    if (!['completed', 'partially_refunded'].includes(p.status)) throw conflict('Only completed payments can be refunded');
    const refundable = round2(p.amount - (p.refundedAmount ?? 0));
    if (body.amount > refundable + 0.001) throw new AppError(422, 'REFUND_EXCEEDS_PAYMENT', `Maximum refundable is ${refundable}`);
    if (String(p.receivedBy) === req.user!.id && req.user!.branchAccess !== 'all') throw forbidden('A refund must be approved by someone other than the cashier who received the payment', 'SEGREGATION_OF_DUTIES');
    p.refundedAmount = round2((p.refundedAmount ?? 0) + body.amount);
    p.status = p.refundedAmount >= p.amount ? 'refunded' : 'partially_refunded';
    await p.save();
    const cn = await m.CreditNote.create({ creditNoteNumber: await nextNumber(m, 'creditnote', 'CN'), invoiceId: p.invoiceId ?? undefined, paymentId: p._id, patientId: p.patientId ?? undefined, branchId: p.branchId, type: 'refund', amount: body.amount, method: body.method, reason: body.reason, approvedBy: req.user!.id, approvedByName: req.user!.name });
    const inv = await m.Invoice.findById(p.invoiceId);
    if (inv) await recalcInvoice(m, inv);
    await audit(req, { action: 'billing.refund', resource: 'payment', resourceId: String(p._id), newValue: body });
    res.status(201).json({ success: true, data: cn });
  }),
);

/** Reconciliation: allocate an unallocated (e.g. C2B) payment to an invoice. */
router.post(
  '/payments/:id/allocate',
  requirePermission('billing.create'),
  h(async (req, res) => {
    const { invoiceId } = parse(z.object({ invoiceId: z.string() }), req.body);
    const m = req.tenant!.models;
    const p = await m.Payment.findById(oid(req.params.id, 'Payment'));
    if (!p) throw notFound('Payment not found');
    if (p.status !== 'unallocated') throw conflict('Payment is already allocated');
    const inv = await loadScoped(req, m.Invoice, invoiceId, 'Invoice');
    assertPayable(inv, p.amount);
    p.invoiceId = inv._id;
    p.patientId = inv.patientId;
    p.branchId = inv.branchId;
    await completePayment(m, p);
    await audit(req, { action: 'billing.payment_allocate', resource: 'payment', resourceId: String(p._id), newValue: { invoice: inv.invoiceNumber } });
    res.json({ success: true, data: p });
  }),
);

/* ------------------------------------------------------------ Cashier summary */
router.get(
  '/summary',
  requirePermission('billing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const bf = branchFilter(req);
    const range = dayRange(req.query.from, req.query.to);
    const match = { ...bf, createdAt: range, status: { $in: ['completed', 'partially_refunded', 'refunded'] } };
    const [byMethod, byCashier, refunds, outstanding, unallocated] = await Promise.all([
      m.Payment.aggregate([{ $match: match }, { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      m.Payment.aggregate([{ $match: match }, { $group: { _id: '$receivedByName', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      m.CreditNote.aggregate([{ $match: { ...bf, createdAt: range, type: 'refund' } }, { $group: { _id: '$method', total: { $sum: '$amount' } } }]),
      m.Invoice.aggregate([{ $match: { ...bf, status: { $in: ['open', 'issued', 'partially_paid'] }, 'totals.balance': { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$totals.balance' }, count: { $sum: 1 } } }]),
      m.Payment.countDocuments({ status: 'unallocated' }),
    ]);
    res.json({ success: true, data: { byMethod, byCashier, refunds, outstanding: outstanding[0] ?? { total: 0, count: 0 }, unallocatedPayments: unallocated } });
  }),
);

export default router;
export { Types };
