import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { conflict, forbidden } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, round2 } from '../common/helpers';

const router = Router();
router.use(authenticateTenant);

router.post(
  '/expenses',
  requirePermission('finance.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ category: z.string().min(2).max(60), description: z.string().max(500).optional(), amount: z.number().positive().max(100_000_000), paidTo: z.string().max(160).optional(), method: z.enum(['cash', 'mpesa', 'bank', 'cheque', 'card']).optional(), reference: z.string().max(80).optional(), date: z.coerce.date().default(() => new Date()) }), req.body);
    const m = req.tenant!.models;
    const e = await m.Expense.create({ ...body, expenseNumber: await nextNumber(m, 'expense', 'EXP'), branchId: req.branch!.id, recordedBy: req.user!.id });
    await audit(req, { action: 'finance.expense_create', resource: 'expense', resourceId: String(e._id), newValue: body });
    res.status(201).json({ success: true, data: e });
  }),
);

router.post(
  '/expenses/:id/:decision',
  requirePermission('finance.manage'),
  h(async (req, res) => {
    const decision = String(req.params.decision);
    if (!['approve', 'reject'].includes(decision)) throw forbidden();
    const e = await loadScoped(req, req.tenant!.models.Expense, req.params.id, 'Expense');
    if (e.status !== 'pending') throw conflict(`Expense is ${e.status}`);
    if (String(e.recordedBy) === req.user!.id) throw forbidden('Expenses must be approved by someone other than the person who recorded them', 'SEGREGATION_OF_DUTIES');
    e.status = decision === 'approve' ? 'approved' : 'rejected';
    e.approvedBy = req.user!.id as never;
    await e.save();
    await audit(req, { action: `finance.expense_${decision}`, resource: 'expense', resourceId: String(e._id) });
    res.json({ success: true, data: e });
  }),
);

router.get(
  '/expenses',
  requirePermission('finance.view'),
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { ...branchFilter(req), date: dayRange(req.query.from ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), req.query.to ?? new Date().toISOString().slice(0, 10)) };
    if (req.query.status) filter.status = String(req.query.status);
    const m = req.tenant!.models;
    const [items, total] = await Promise.all([m.Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(), m.Expense.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

/** Income statement-style summary on a cash basis plus receivables aging. */
router.get(
  '/summary',
  requireAnyPermission('finance.view', 'reports.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const bf = branchFilter(req);
    const range = dayRange(req.query.from ?? new Date(new Date().setDate(1)).toISOString().slice(0, 10), req.query.to ?? new Date().toISOString().slice(0, 10));
    const [payments, refunds, expenses, openInvoices, shaTx] = await Promise.all([
      m.Payment.find({ ...bf, createdAt: range, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).select('method amount').lean(),
      m.CreditNote.find({ ...bf, createdAt: range, type: 'refund' }).select('amount').lean(),
      m.Expense.find({ ...bf, date: range, status: 'approved' }).select('category amount').lean(),
      m.Invoice.find({ ...bf, status: { $in: ['open', 'issued', 'partially_paid'] }, 'totals.balance': { $gt: 0 } }).select('createdAt totals.balance payer.type').lean(),
      m.ShaTransaction.find({ ...bf, kind: { $in: ['claim', 'emergency_claim'] }, status: { $in: ['submitted', 'pending', 'approved', 'intervention_required'] } }).select('status amounts').lean(),
    ]);
    const sumBy = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: round2((acc[key(r)] ?? 0) + val(r)) }), {});
    const collections = round2(payments.reduce((s, p) => s + p.amount, 0));
    const refundTotal = round2(refunds.reduce((s, r) => s + r.amount, 0));
    const expenseTotal = round2(expenses.reduce((s, e) => s + e.amount, 0));
    const now = Date.now();
    const bucket = (d: Date) => { const days = (now - new Date(d).getTime()) / 86400_000; return days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'; };
    res.json({
      success: true,
      data: {
        period: { from: range.$gte, to: range.$lte },
        collections,
        collectionsByMethod: sumBy(payments, (p) => p.method, (p) => p.amount),
        refunds: refundTotal,
        expenses: expenseTotal,
        expensesByCategory: sumBy(expenses, (e) => e.category, (e) => e.amount),
        netCash: round2(collections - refundTotal - expenseTotal),
        receivables: { total: round2(openInvoices.reduce((s, i) => s + (i.totals?.balance ?? 0), 0)), aging: sumBy(openInvoices, (i) => bucket(i.createdAt!), (i) => i.totals?.balance ?? 0), byPayer: sumBy(openInvoices, (i) => i.payer?.type ?? 'cash', (i) => i.totals?.balance ?? 0) },
        shaReceivables: { claimed: round2(shaTx.reduce((s, t) => s + (t.amounts?.claimed ?? 0), 0)), approved: round2(shaTx.reduce((s, t) => s + (t.amounts?.approved ?? 0), 0)), byStatus: sumBy(shaTx, (t) => t.status, (t) => t.amounts?.claimed ?? 0) },
      },
    });
  }),
);

export default router;
