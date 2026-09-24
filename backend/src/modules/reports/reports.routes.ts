import { Router, type Request } from 'express';
import { h } from '../../utils/asyncHandler';
import { forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, round2 } from '../common/helpers';

/**
 * Reports are computed server-side per request (date range + branch scope). Aggregation is done with
 * projected finds + in-process grouping so the same code runs on MongoDB and MongoDB-compatible engines.
 */
type Col = { key: string; label: string };
type Result = { columns: Col[]; rows: Array<Record<string, unknown>>; summary?: Record<string, unknown> };
type Range = { $gte: Date; $lte: Date };
interface Report { title: string; group: string; permission: string; run: (req: Request, range: Range) => Promise<Result> }

const LIMIT = 100_000;
const eatDay = (d: Date) => new Date(new Date(d).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
function countBy<T>(rows: T[], key: (r: T) => string | undefined | null, val: (r: T) => number = () => 1) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? 'Unknown';
    out.set(k, round2((out.get(k) ?? 0) + val(r)));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}
const cols = (...pairs: Array<[string, string]>): Col[] => pairs.map(([key, label]) => ({ key, label }));

const REPORTS: Record<string, Report> = {
  opd: {
    title: 'OPD attendance', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const visits = await m.Visit.find({ ...branchFilter(req), createdAt: range }).select('createdAt type payer.type').limit(LIMIT).lean();
      const byDay = countBy(visits, (v) => eatDay(v.createdAt!));
      return { columns: cols(['date', 'Date'], ['visits', 'Visits']), rows: byDay.sort().map(([date, visits]) => ({ date, visits })), summary: { total: visits.length, byType: Object.fromEntries(countBy(visits, (v) => v.type)), byPayer: Object.fromEntries(countBy(visits, (v) => v.payer?.type)) } };
    },
  },
  diagnoses: {
    title: 'Top diagnoses (finalized consultations)', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const rows = await req.tenant!.models.Consultation.find({ ...branchFilter(req), status: 'final', finalizedAt: range }).select('diagnoses').limit(LIMIT).lean();
      const dx = rows.flatMap((c) => c.diagnoses.filter((d) => d.type !== 'secondary'));
      return { columns: cols(['diagnosis', 'Diagnosis'], ['cases', 'Cases']), rows: countBy(dx, (d) => `${d.code ? `${d.code} ` : ''}${d.display}`).slice(0, 50).map(([diagnosis, cases]) => ({ diagnosis, cases })), summary: { consultations: rows.length } };
    },
  },
  inpatient: {
    title: 'Admissions, discharges & length of stay', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const [adm, dis] = await Promise.all([
        m.Admission.find({ ...branchFilter(req), admittedAt: range }).select('admittedAt').limit(LIMIT).lean(),
        m.Admission.find({ ...branchFilter(req), 'discharge.at': range }).select('admittedAt discharge.at discharge.outcome').limit(LIMIT).lean(),
      ]);
      const los = dis.map((a) => (new Date(a.discharge!.at!).getTime() - new Date(a.admittedAt).getTime()) / 86400_000);
      return { columns: cols(['outcome', 'Discharge outcome'], ['count', 'Patients']), rows: countBy(dis, (a) => a.discharge?.outcome).map(([outcome, count]) => ({ outcome, count })), summary: { admissions: adm.length, discharges: dis.length, averageLengthOfStayDays: los.length ? round2(los.reduce((s, x) => s + x, 0) / los.length) : 0, deaths: dis.filter((a) => a.discharge?.outcome === 'deceased').length } };
    },
  },
  bed_occupancy: {
    title: 'Bed occupancy (current)', group: 'Clinical', permission: 'reports.view',
    async run(req) {
      const beds = await req.tenant!.models.Bed.find(branchFilter(req)).populate('wardId', 'name').select('status category wardId').lean();
      const wards = new Map<string, { ward: string; total: number; occupied: number }>();
      for (const b of beds) {
        const name = (b.wardId as unknown as { name: string })?.name ?? '—';
        const w = wards.get(name) ?? { ward: name, total: 0, occupied: 0 };
        w.total += 1;
        if (b.status === 'occupied') w.occupied += 1;
        wards.set(name, w);
      }
      return { columns: cols(['ward', 'Ward'], ['total', 'Beds'], ['occupied', 'Occupied'], ['rate', 'Occupancy %']), rows: [...wards.values()].map((w) => ({ ...w, rate: w.total ? round2((w.occupied / w.total) * 100) : 0 })), summary: { byCategory: Object.fromEntries(countBy(beds.filter((b) => b.status === 'occupied'), (b) => b.category)) } };
    },
  },
  maternity: {
    title: 'Deliveries & ANC', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const [del, anc] = await Promise.all([m.Delivery.find({ ...branchFilter(req), deliveredAt: range }).select('mode babies bloodLossMl').limit(LIMIT).lean(), m.AncVisit.find({ ...branchFilter(req), createdAt: range }).select('contactNumber').limit(LIMIT).lean()]);
      const babies = del.flatMap((d) => d.babies);
      return {
        columns: cols(['mode', 'Mode of delivery'], ['count', 'Deliveries']),
        rows: countBy(del, (d) => d.mode).map(([mode, count]) => ({ mode, count })),
        summary: { deliveries: del.length, liveBirths: babies.filter((b) => b.outcome === 'live_birth').length, stillbirths: babies.filter((b) => /stillbirth/.test(b.outcome ?? '')).length, lowBirthWeight: babies.filter((b) => (b.birthWeightGrams ?? 9999) < 2500).length, pph: del.filter((d) => (d.bloodLossMl ?? 0) >= 500).length, ancFirstContacts: anc.filter((a) => a.contactNumber === 1).length, ancRevisits: anc.filter((a) => (a.contactNumber ?? 0) > 1).length },
      };
    },
  },
  mch: {
    title: 'Immunizations & family planning', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const [imm, fp] = await Promise.all([m.Immunization.find({ ...branchFilter(req), givenAt: range }).select('vaccine dose').limit(LIMIT).lean(), m.FpVisit.find({ ...branchFilter(req), createdAt: range }).select('method visitType').limit(LIMIT).lean()]);
      return { columns: cols(['antigen', 'Vaccine / dose'], ['given', 'Doses given']), rows: countBy(imm, (i) => `${i.vaccine} ${i.dose}`).map(([antigen, given]) => ({ antigen, given })), summary: { fpVisits: fp.length, fpByMethod: Object.fromEntries(countBy(fp, (f) => f.method)), fpNewClients: fp.filter((f) => f.visitType === 'new').length } };
    },
  },
  laboratory: {
    title: 'Laboratory workload & turnaround', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const orders = await req.tenant!.models.LabOrder.find({ ...branchFilter(req), createdAt: range }).select('createdAt items.testName items.status items.releasedAt items.critical').limit(LIMIT).lean();
      const items = orders.flatMap((o) => o.items.map((i) => ({ ...i, orderedAt: o.createdAt })));
      const tat = new Map<string, number[]>();
      for (const i of items) if (i.releasedAt) tat.set(i.testName ?? '?', [...(tat.get(i.testName ?? '?') ?? []), (new Date(i.releasedAt).getTime() - new Date(i.orderedAt!).getTime()) / 60_000]);
      return {
        columns: cols(['test', 'Test'], ['ordered', 'Ordered'], ['released', 'Released'], ['avgTatMinutes', 'Avg TAT (min)']),
        rows: countBy(items, (i) => i.testName).map(([test, ordered]) => ({ test, ordered, released: items.filter((i) => i.testName === test && i.status === 'released').length, avgTatMinutes: tat.get(test)?.length ? Math.round(tat.get(test)!.reduce((s, x) => s + x, 0) / tat.get(test)!.length) : null })),
        summary: { tests: items.length, rejected: items.filter((i) => i.status === 'rejected').length, critical: items.filter((i) => i.critical).length },
      };
    },
  },
  radiology: {
    title: 'Imaging by modality', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const rows = await req.tenant!.models.RadiologyRequest.find({ ...branchFilter(req), createdAt: range }).select('modality status').limit(LIMIT).lean();
      return { columns: cols(['modality', 'Modality'], ['requests', 'Requests'], ['verified', 'Reported & verified']), rows: countBy(rows, (r) => r.modality).map(([modality, requests]) => ({ modality, requests, verified: rows.filter((r) => r.modality === modality && r.status === 'verified').length })) };
    },
  },
  pharmacy: {
    title: 'Dispensing by item', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const mv = await req.tenant!.models.StockMovement.find({ ...branchFilter(req), type: 'dispense', createdAt: range }).populate('itemId', 'name').select('itemId quantity').limit(LIMIT).lean();
      return { columns: cols(['item', 'Item'], ['quantity', 'Quantity dispensed']), rows: countBy(mv, (x) => (x.itemId as unknown as { name: string })?.name, (x) => -x.quantity).map(([item, quantity]) => ({ item, quantity })) };
    },
  },
  dental: {
    title: 'Dental procedures', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const v = await req.tenant!.models.DentalVisit.find({ ...branchFilter(req), createdAt: range }).select('treatmentPlan').limit(LIMIT).lean();
      const done = v.flatMap((x) => x.treatmentPlan.filter((t) => t.status === 'done'));
      return { columns: cols(['procedure', 'Procedure'], ['count', 'Done']), rows: countBy(done, (t) => t.procedure).map(([procedure, count]) => ({ procedure, count })), summary: { visits: v.length } };
    },
  },
  mortuary: {
    title: 'Mortuary admissions & releases', group: 'Clinical', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const [adm, rel] = await Promise.all([m.MortuaryCase.find({ ...branchFilter(req), admittedAt: range }).select('placeOfDeath').lean(), m.MortuaryCase.countDocuments({ ...branchFilter(req), releasedAt: range })]);
      return { columns: cols(['place', 'Place of death'], ['count', 'Admissions']), rows: countBy(adm, (c) => c.placeOfDeath).map(([place, count]) => ({ place, count })), summary: { admissions: adm.length, releases: rel } };
    },
  },
  revenue: {
    title: 'Revenue (collections) by day and method', group: 'Finance', permission: 'billing.view',
    async run(req, range) {
      const pays = await req.tenant!.models.Payment.find({ ...branchFilter(req), createdAt: range, status: { $in: ['completed', 'partially_refunded', 'refunded'] } }).select('createdAt method amount refundedAmount').limit(LIMIT).lean();
      const days = [...new Set(pays.map((p) => eatDay(p.createdAt!)))].sort();
      const methods = [...new Set(pays.map((p) => p.method))];
      return { columns: [{ key: 'date', label: 'Date' }, ...methods.map((mm) => ({ key: mm, label: mm.toUpperCase() })), { key: 'total', label: 'Total' }], rows: days.map((d) => { const rows = pays.filter((p) => eatDay(p.createdAt!) === d); return { date: d, ...Object.fromEntries(methods.map((mm) => [mm, round2(rows.filter((r) => r.method === mm).reduce((s, r) => s + r.amount, 0))])), total: round2(rows.reduce((s, r) => s + r.amount, 0)) }; }), summary: { total: round2(pays.reduce((s, p) => s + p.amount, 0)), refunded: round2(pays.reduce((s, p) => s + (p.refundedAmount ?? 0), 0)) } };
    },
  },
  charges: {
    title: 'Charges by service category', group: 'Finance', permission: 'billing.view',
    async run(req, range) {
      const inv = await req.tenant!.models.Invoice.find({ ...branchFilter(req), createdAt: range, status: { $ne: 'void' } }).select('lines payer.type').limit(LIMIT).lean();
      const lines = inv.flatMap((i) => i.lines.filter((l) => !l.voided));
      return { columns: cols(['category', 'Category'], ['amount', 'Amount (KES)']), rows: countBy(lines, (l) => l.category, (l) => l.amount).map(([category, amount]) => ({ category, amount })), summary: { byPayer: Object.fromEntries(countBy(inv, (i) => i.payer?.type, (i) => i.lines.filter((l) => !l.voided).reduce((s, l) => s + l.amount, 0))) } };
    },
  },
  insurance: {
    title: 'Outstanding balances by payer', group: 'Finance', permission: 'billing.view',
    async run(req) {
      const inv = await req.tenant!.models.Invoice.find({ ...branchFilter(req), status: { $in: ['open', 'issued', 'partially_paid'] }, 'totals.balance': { $gt: 0 } }).select('payer totals.balance').limit(LIMIT).lean();
      return { columns: cols(['payer', 'Payer'], ['balance', 'Outstanding (KES)']), rows: countBy(inv, (i) => `${i.payer?.type ?? 'cash'}${i.payer?.scheme ? ` · ${i.payer.scheme}` : ''}`, (i) => i.totals?.balance ?? 0).map(([payer, balance]) => ({ payer, balance })) };
    },
  },
  sha_claims: {
    title: 'SHA authorizations, preauths & claims', group: 'Finance', permission: 'sha.view',
    async run(req, range) {
      const tx = await req.tenant!.models.ShaTransaction.find({ ...branchFilter(req), createdAt: range }).select('kind status amounts').limit(LIMIT).lean();
      const keys = [...new Set(tx.map((t) => `${t.kind}|${t.status}`))];
      return { columns: cols(['kind', 'Type'], ['status', 'Status'], ['count', 'Count'], ['claimed', 'Claimed'], ['approved', 'Approved'], ['paid', 'Paid']), rows: keys.map((k) => { const [kind, status] = k.split('|'); const r = tx.filter((t) => t.kind === kind && t.status === status); return { kind, status, count: r.length, claimed: round2(r.reduce((s, t) => s + (t.amounts?.claimed ?? 0), 0)), approved: round2(r.reduce((s, t) => s + (t.amounts?.approved ?? 0), 0)), paid: round2(r.reduce((s, t) => s + (t.amounts?.paid ?? 0), 0)) }; }) };
    },
  },
  expenses: {
    title: 'Expenses by category', group: 'Finance', permission: 'finance.view',
    async run(req, range) {
      const e = await req.tenant!.models.Expense.find({ ...branchFilter(req), date: range, status: 'approved' }).select('category amount').lean();
      return { columns: cols(['category', 'Category'], ['amount', 'Amount (KES)']), rows: countBy(e, (x) => x.category, (x) => x.amount).map(([category, amount]) => ({ category, amount })) };
    },
  },
  inventory: {
    title: 'Stock valuation & expiry exposure', group: 'Supply', permission: 'inventory.view',
    async run(req) {
      const batches = await req.tenant!.models.Batch.find({ ...branchFilter(req), quantity: { $gt: 0 } }).populate('itemId', 'name').select('itemId quantity unitCost expiryDate').limit(LIMIT).lean();
      const now = Date.now();
      const items = new Map<string, { item: string; quantity: number; value: number; expired: number; expiring90: number }>();
      for (const b of batches) {
        const name = (b.itemId as unknown as { name: string })?.name ?? '?';
        const r = items.get(name) ?? { item: name, quantity: 0, value: 0, expired: 0, expiring90: 0 };
        r.quantity += b.quantity;
        r.value = round2(r.value + b.quantity * (b.unitCost ?? 0));
        const t = new Date(b.expiryDate).getTime();
        if (t < now) r.expired += b.quantity;
        else if (t < now + 90 * 86400_000) r.expiring90 += b.quantity;
        items.set(name, r);
      }
      return { columns: cols(['item', 'Item'], ['quantity', 'On hand'], ['value', 'Value (KES)'], ['expired', 'Expired'], ['expiring90', 'Expiring ≤90d']), rows: [...items.values()].sort((a, b) => b.value - a.value), summary: { totalValue: round2([...items.values()].reduce((s, r) => s + r.value, 0)) } };
    },
  },
  procurement: {
    title: 'Purchase orders', group: 'Supply', permission: 'procurement.view',
    async run(req, range) {
      const po = await req.tenant!.models.PurchaseOrder.find({ ...branchFilter(req), createdAt: range }).select('status total').lean();
      return { columns: cols(['status', 'Status'], ['count', 'POs'], ['value', 'Value (KES)']), rows: countBy(po, (p) => p.status).map(([status, count]) => ({ status, count, value: round2(po.filter((p) => p.status === status).reduce((s, p) => s + (p.total ?? 0), 0)) })) };
    },
  },
  productivity: {
    title: 'Provider productivity', group: 'Management', permission: 'reports.view',
    async run(req, range) {
      const m = req.tenant!.models;
      const [cons, lab, rx, vit] = await Promise.all([
        m.Consultation.find({ ...branchFilter(req), status: 'final', finalizedAt: range }).select('providerName').lean(),
        m.LabOrder.find({ ...branchFilter(req), 'items.resultedAt': range }).select('items.resultedByName items.resultedAt').lean(),
        m.Prescription.find({ ...branchFilter(req), 'dispenses.at': range }).select('dispenses.byName dispenses.at').lean(),
        m.Vitals.find({ ...branchFilter(req), recordedAt: range }).select('recordedByName').lean(),
      ]);
      const staff = new Map<string, { staff: string; consultations: number; labResults: number; dispenses: number; vitals: number }>();
      const bump = (name: string | null | undefined, k: 'consultations' | 'labResults' | 'dispenses' | 'vitals') => { if (!name) return; const r = staff.get(name) ?? { staff: name, consultations: 0, labResults: 0, dispenses: 0, vitals: 0 }; r[k] += 1; staff.set(name, r); };
      cons.forEach((c) => bump(c.providerName, 'consultations'));
      lab.forEach((o) => o.items.filter((i) => i.resultedAt && i.resultedAt >= range.$gte && i.resultedAt <= range.$lte).forEach((i) => bump(i.resultedByName, 'labResults')));
      rx.forEach((r) => r.dispenses.filter((d) => d.at && d.at >= range.$gte && d.at <= range.$lte).forEach((d) => bump(d.byName, 'dispenses')));
      vit.forEach((v) => bump(v.recordedByName, 'vitals'));
      return { columns: cols(['staff', 'Staff'], ['consultations', 'Consultations'], ['labResults', 'Lab results'], ['dispenses', 'Dispenses'], ['vitals', 'Vitals']), rows: [...staff.values()].sort((a, b) => b.consultations + b.labResults + b.dispenses - (a.consultations + a.labResults + a.dispenses)) };
    },
  },
};

const router = Router();
router.use(authenticateTenant);

router.get('/', requirePermission('reports.view'), (req, res) => {
  res.json({ success: true, data: Object.entries(REPORTS).filter(([, r]) => req.permissions!.has(r.permission)).map(([key, r]) => ({ key, title: r.title, group: r.group })) });
});

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

router.get(
  '/:key',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const r = REPORTS[String(req.params.key)];
    if (!r) throw notFound('Report not found');
    if (!req.permissions!.has(r.permission)) throw forbidden(`Missing permission: ${r.permission}`);
    const from = req.query.from ?? new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
    const range = dayRange(from, req.query.to ?? new Date().toISOString().slice(0, 10)) as Range;
    const result = await r.run(req, range);
    if (req.query.format === 'csv') {
      if (!req.permissions!.has('reports.export')) throw forbidden('Missing permission: reports.export');
      await audit(req, { action: 'report.export', resource: 'report', resourceId: String(req.params.key), newValue: { from: range.$gte, to: range.$lte } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-${range.$gte.toISOString().slice(0, 10)}.csv"`);
      return res.send([result.columns.map((c) => csvCell(c.label)).join(','), ...result.rows.map((row) => result.columns.map((c) => csvCell(row[c.key])).join(','))].join('\n'));
    }
    res.json({ success: true, data: { key: req.params.key, title: r.title, range: { from: range.$gte, to: range.$lte }, ...result } });
  }),
);

export default router;
