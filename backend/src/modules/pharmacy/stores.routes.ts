import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse, pagination } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid, round2 } from '../common/helpers';
import { allocateFefo, stockOnHand } from './stockService';
import { itemSearch } from './pharmacy.routes';

/**
 * Stores: requisitions (a department asks, a manager approves, the store issues, the department
 * confirms), stock takes (count sheets with variances, approved before stock changes), the stock
 * movement report and reorder suggestions for purchase orders (LPOs).
 */
const router = Router();
router.use(authenticateTenant);

const MANAGE = ['inventory.manage', 'pharmacy.stock'];
const REQUEST = ['inventory.view', 'inventory.manage', 'pharmacy.stock', 'pharmacy.dispense', 'nursing.record', 'lab.sample', 'lab.manage', 'dental.manage', 'radiology.manage'];
const loc = (req: Request, id: unknown) => loadScoped(req, req.tenant!.models.StockLocation, id, 'Stock location');

/* ================================================================== Requisitions */
/** What a department needs to raise a requisition, for staff who cannot see the full inventory. */
router.get('/requisition-locations', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const rows = await req.tenant!.models.StockLocation.find({ ...branchFilter(req), active: true }).select('name type branchId').sort({ name: 1 }).lean();
  res.json({ success: true, data: rows });
}));

router.get('/requisition-items', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return void res.json({ success: true, data: [] });
  const rx = new RegExp(escapeRegex(q.slice(0, 60)), 'i');
  const rows = await req.tenant!.models.Item.find({ active: true, $or: [{ name: rx }, { code: rx }, { genericName: rx }, { brand: rx }] }).select('code name strength form unit category packUnit packSize').sort({ name: 1 }).limit(15).lean();
  res.json({ success: true, data: rows });
}));

router.get('/requisitions', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const m = req.tenant!.models;
  const { page, limit, skip } = pagination(req.query, 200);
  const filter: Record<string, unknown> = { ...branchFilter(req) };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.mine === 'true') filter.requestedBy = req.user!.id;
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ reqNumber: rx }, { 'items.name': rx }, { requestedByName: rx }, { notes: rx }];
  }
  const [rows, total] = await Promise.all([
    m.StockRequisition.find(filter).populate('fromLocationId', 'name').populate('toLocationId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    m.StockRequisition.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows, meta: { page, limit, total } });
}));

router.get('/requisitions/:id', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const m = req.tenant!.models;
  const r = await loadScoped(req, m.StockRequisition, req.params.id, 'Requisition');
  const [from, to] = await Promise.all([m.StockLocation.findById(r.fromLocationId).select('name').lean(), m.StockLocation.findById(r.toLocationId).select('name').lean()]);
  res.json({ success: true, data: { ...r.toObject(), fromLocationId: from, toLocationId: to } });
}));

router.post('/requisitions', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const body = parse(z.object({ fromLocationId: z.string(), toLocationId: z.string(), urgency: z.enum(['routine', 'urgent']).default('routine'), notes: z.string().trim().max(500).optional(), items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1).max(1_000_000) })).min(1).max(100) }), req.body);
  if (body.fromLocationId === body.toLocationId) throw badRequest('Choose the store to request from and the department receiving the items');
  const m = req.tenant!.models;
  const [from, to] = [await loc(req, body.fromLocationId), await loc(req, body.toLocationId)];
  if (String(from.branchId) !== String(to.branchId)) throw badRequest('Requisitions are within one branch; use a transfer between branches');
  const items = await m.Item.find({ _id: { $in: body.items.map((i) => oid(i.itemId, 'Item')) } }).lean();
  if (items.length !== new Set(body.items.map((i) => i.itemId)).size) throw badRequest('Unknown or repeated item on the requisition');
  const r = await m.StockRequisition.create({
    reqNumber: await nextNumber(m, 'requisition', 'SRQ'), branchId: from.branchId, fromLocationId: from._id, toLocationId: to._id, urgency: body.urgency, notes: body.notes,
    items: body.items.map((i) => { const it = items.find((x) => String(x._id) === i.itemId)!; return { itemId: it._id, name: `${it.name}${it.strength ? ` ${it.strength}` : ''}`, unit: it.unit, quantity: i.quantity }; }),
    requestedBy: req.user!.id, requestedByName: req.user!.name,
  });
  await audit(req, { action: 'inventory.requisition_create', resource: 'stock_requisition', resourceId: String(r._id), newValue: { reqNumber: r.reqNumber, items: body.items } });
  res.status(201).json({ success: true, data: r });
}));

router.post('/requisitions/:id/decide', requireAnyPermission(...MANAGE), h(async (req, res) => {
  const body = parse(z.object({ approve: z.boolean(), reason: z.string().trim().max(300).optional(), quantities: z.record(z.string(), z.number().int().min(0)).optional() }), req.body);
  const m = req.tenant!.models;
  const r = await loadScoped(req, m.StockRequisition, req.params.id, 'Requisition');
  if (r.status !== 'pending') throw conflict(`This requisition is already ${r.status.replace('_', ' ')}`);
  if (String(r.requestedBy) === req.user!.id) throw forbidden('Someone other than the requester must approve this requisition', 'SEGREGATION_OF_DUTIES');
  if (!body.approve && !body.reason) throw badRequest('Give the reason for rejecting');
  for (const i of r.items) {
    const q = body.quantities?.[String(i._id)];
    i.approvedQuantity = body.approve ? Math.min(i.quantity, q ?? i.quantity) : 0;
  }
  if (body.approve && r.items.every((i) => !i.approvedQuantity)) throw badRequest('Approve at least one item, or reject the requisition');
  r.status = body.approve ? 'approved' : 'rejected';
  r.rejectionReason = body.approve ? undefined : body.reason;
  r.decidedBy = req.user!.id as never;
  r.decidedByName = req.user!.name;
  r.decidedAt = new Date();
  await r.save();
  await audit(req, { action: body.approve ? 'inventory.requisition_approve' : 'inventory.requisition_reject', resource: 'stock_requisition', resourceId: String(r._id), newValue: body });
  res.json({ success: true, data: r });
}));

/** The store issues approved quantities: stock moves from the store to the department, earliest expiry first. */
router.post('/requisitions/:id/issue', requireAnyPermission(...MANAGE), h(async (req, res) => {
  const body = parse(z.object({ quantities: z.record(z.string(), z.number().int().min(0)).optional() }), req.body ?? {});
  const m = req.tenant!.models;
  const r = await loadScoped(req, m.StockRequisition, req.params.id, 'Requisition');
  if (!['approved', 'partially_issued'].includes(r.status)) throw conflict('Only approved requisitions can be issued');
  const ref = `${r.reqNumber}/${r.issues.length + 1}`;
  const lines: Array<{ itemId: Types.ObjectId; batchNumber: string; quantity: number }> = [];
  const done: Array<{ alloc: Awaited<ReturnType<typeof allocateFefo>> }> = [];
  const plan: Array<{ line: (typeof r.items)[number]; qty: number }> = [];
  for (const i of r.items) {
    const outstanding = (i.approvedQuantity ?? 0) - (i.issuedQuantity ?? 0);
    const qty = Math.min(outstanding, body.quantities?.[String(i._id)] ?? outstanding);
    if (qty > 0) plan.push({ line: i, qty });
  }
  if (!plan.length) throw badRequest('Nothing left to issue');
  try {
    for (const p of plan) done.push({ alloc: await allocateFefo(m, { itemId: p.line.itemId, locationId: r.fromLocationId, quantity: p.qty }) });
  } catch (err) {
    for (const d of done) for (const a of d.alloc) await m.Batch.updateOne({ _id: a.batchId }, { $inc: { quantity: a.quantity } });
    if (err instanceof AppError && err.code === 'INSUFFICIENT_STOCK') throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough ${plan[done.length]?.line.name ?? 'stock'} in the store: ${err.message}`);
    throw err;
  }
  for (const [n, p] of plan.entries()) {
    for (const a of done[n].alloc) {
      await m.StockMovement.create({ itemId: p.line.itemId, batchId: a.batchId, locationId: r.fromLocationId, branchId: r.branchId, type: 'transfer_out', quantity: -a.quantity, reference: ref, by: req.user!.id });
      const dest = await m.Batch.findOneAndUpdate({ itemId: p.line.itemId, locationId: r.toLocationId, batchNumber: a.batchNumber, expiryDate: a.expiryDate }, { $inc: { quantity: a.quantity }, $setOnInsert: { branchId: r.branchId, unitCost: a.unitCost } }, { upsert: true, returnDocument: 'after' });
      await m.StockMovement.create({ itemId: p.line.itemId, batchId: dest!._id, locationId: r.toLocationId, branchId: r.branchId, type: 'transfer_in', quantity: a.quantity, reference: ref, by: req.user!.id });
      lines.push({ itemId: p.line.itemId, batchNumber: a.batchNumber, quantity: a.quantity });
    }
    p.line.issuedQuantity = (p.line.issuedQuantity ?? 0) + p.qty;
  }
  r.issues.push({ at: new Date(), byName: req.user!.name, reference: ref, lines } as never);
  r.status = r.items.every((i) => (i.issuedQuantity ?? 0) >= (i.approvedQuantity ?? 0)) ? 'issued' : 'partially_issued';
  await r.save();
  await audit(req, { action: 'inventory.requisition_issue', resource: 'stock_requisition', resourceId: String(r._id), newValue: { reference: ref, lines } });
  res.json({ success: true, data: r });
}));

router.post('/requisitions/:id/receive', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const m = req.tenant!.models;
  const r = await loadScoped(req, m.StockRequisition, req.params.id, 'Requisition');
  if (r.status !== 'issued') throw conflict('Only fully issued requisitions can be marked received');
  r.status = 'received';
  r.receivedByName = req.user!.name;
  r.receivedAt = new Date();
  await r.save();
  await audit(req, { action: 'inventory.requisition_receive', resource: 'stock_requisition', resourceId: String(r._id) });
  res.json({ success: true, data: r });
}));

router.post('/requisitions/:id/cancel', requireAnyPermission(...REQUEST), h(async (req, res) => {
  const m = req.tenant!.models;
  const r = await loadScoped(req, m.StockRequisition, req.params.id, 'Requisition');
  if (!['pending', 'approved'].includes(r.status)) throw conflict('Only requisitions not yet issued can be cancelled');
  if (String(r.requestedBy) !== req.user!.id && !MANAGE.some((p) => req.user!.permissions.has(p))) throw forbidden('Only the requester or a store manager can cancel');
  r.status = 'cancelled';
  await r.save();
  await audit(req, { action: 'inventory.requisition_cancel', resource: 'stock_requisition', resourceId: String(r._id) });
  res.json({ success: true, data: r });
}));

/* ================================================================== Stock takes */
router.get('/stock-takes', requireAnyPermission('inventory.view', ...MANAGE), h(async (req, res) => {
  const m = req.tenant!.models;
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const rx = q ? new RegExp(escapeRegex(q), 'i') : null;
  const locIds = rx ? (await m.StockLocation.find({ name: rx }).select('_id').lean()).map((l) => l._id) : [];
  const rows = await m.StockTake.find({ ...branchFilter(req), ...(rx ? { $or: [{ takeNumber: rx }, { createdByName: rx }, { notes: rx }, { category: rx }, { locationId: { $in: locIds } }, { 'lines.name': rx }] } : {}) }).select('-lines').populate('locationId', 'name').sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: rows });
}));

router.get('/stock-takes/:id', requireAnyPermission('inventory.view', ...MANAGE), h(async (req, res) => {
  const m = req.tenant!.models;
  const st = await loadScoped(req, m.StockTake, req.params.id, 'Stock take');
  const location = await m.StockLocation.findById(st.locationId).select('name').lean();
  res.json({ success: true, data: { ...st.toObject(), location } });
}));

/** Starts a count: one line per batch on the shelf (including expired), with the system quantity frozen. */
router.post('/stock-takes', requireAnyPermission(...MANAGE), h(async (req, res) => {
  const body = parse(z.object({ locationId: z.string(), category: z.enum(['drug', 'consumable', 'reagent', 'equipment', 'other']).optional(), notes: z.string().trim().max(500).optional() }), req.body);
  const m = req.tenant!.models;
  const l = await loc(req, body.locationId);
  if (await m.StockTake.exists({ locationId: l._id, status: { $in: ['counting', 'submitted'] } })) throw conflict('A stock take for this location is already in progress; finish or cancel it first');
  const items = await m.Item.find({ active: true, ...(body.category ? { category: body.category } : {}) }).select('code name strength unit').lean();
  const batches = await m.Batch.find({ locationId: l._id, itemId: { $in: items.map((i) => i._id) }, quantity: { $gt: 0 } }).sort({ expiryDate: 1 }).lean();
  const lines = batches.map((b) => {
    const it = items.find((i) => String(i._id) === String(b.itemId))!;
    return { itemId: it._id, code: it.code, name: `${it.name}${it.strength ? ` ${it.strength}` : ''}`, unit: it.unit, batchId: b._id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, systemQuantity: b.quantity, unitCost: b.unitCost ?? 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (!lines.length) throw badRequest(`There is no stock${body.category ? ` of this category` : ''} at ${l.name} to count`);
  const st = await m.StockTake.create({ takeNumber: await nextNumber(m, 'stocktake', 'STK'), branchId: l.branchId, locationId: l._id, category: body.category, notes: body.notes, lines, createdBy: req.user!.id, createdByName: req.user!.name });
  await audit(req, { action: 'inventory.stocktake_start', resource: 'stock_take', resourceId: String(st._id), newValue: { location: l.name, lines: lines.length } });
  res.status(201).json({ success: true, data: st });
}));

router.put('/stock-takes/:id/counts', requireAnyPermission('inventory.view', ...MANAGE), h(async (req, res) => {
  const body = parse(z.object({ counts: z.array(z.object({ lineId: z.string(), countedQuantity: z.number().int().min(0).max(10_000_000).nullable(), note: z.string().trim().max(200).optional() })).max(5000), submit: z.boolean().default(false) }), req.body);
  const m = req.tenant!.models;
  const st = await loadScoped(req, m.StockTake, req.params.id, 'Stock take');
  if (st.status !== 'counting') throw conflict('This stock take is no longer being counted');
  for (const c of body.counts) {
    const line = st.lines.id(oid(c.lineId, 'Line'));
    if (!line) throw notFound('Count line not found');
    line.countedQuantity = c.countedQuantity ?? undefined;
    if (c.note !== undefined) line.note = c.note || undefined;
  }
  if (body.submit) {
    const missing = st.lines.filter((l) => l.countedQuantity == null).length;
    if (missing) throw badRequest(`${missing} line(s) have not been counted yet`);
    st.status = 'submitted';
    st.submittedBy = req.user!.id as never;
    st.submittedByName = req.user!.name;
    st.submittedAt = new Date();
  }
  await st.save();
  res.json({ success: true, data: st });
}));

/**
 * Approval applies the variances as audited adjustments. The difference (counted − frozen system
 * quantity) is applied to today's quantity, so sales and issues made during the count are kept.
 */
router.post('/stock-takes/:id/approve', requireAnyPermission('inventory.manage'), h(async (req, res) => {
  const m = req.tenant!.models;
  const st = await loadScoped(req, m.StockTake, req.params.id, 'Stock take');
  if (st.status !== 'submitted') throw conflict('Submit the counts before approving');
  if (String(st.submittedBy) === req.user!.id) throw forbidden('Someone other than the person who counted must approve the stock take', 'SEGREGATION_OF_DUTIES');
  let changed = 0;
  let value = 0;
  for (const l of st.lines) {
    const variance = (l.countedQuantity ?? 0) - (l.systemQuantity ?? 0);
    if (!variance || !l.batchId) continue;
    const batch = await m.Batch.findById(l.batchId as Types.ObjectId);
    if (!batch) continue;
    const delta = Math.max(-batch.quantity, variance);
    if (!delta) continue;
    await m.Batch.updateOne({ _id: batch._id }, { $inc: { quantity: delta } });
    await m.StockMovement.create({ itemId: batch.itemId, batchId: batch._id, locationId: st.locationId, branchId: st.branchId, type: 'adjustment', quantity: delta, reference: st.takeNumber, reason: `Stock take ${st.takeNumber}${l.note ? `: ${l.note}` : ''}`, by: req.user!.id });
    changed += 1;
    value = round2(value + delta * (l.unitCost ?? 0));
  }
  st.status = 'approved';
  st.approvedBy = req.user!.id as never;
  st.approvedByName = req.user!.name;
  st.approvedAt = new Date();
  await st.save();
  await audit(req, { action: 'inventory.stocktake_approve', resource: 'stock_take', resourceId: String(st._id), newValue: { adjustedLines: changed, varianceValue: value } });
  res.json({ success: true, data: { stockTake: st, adjustedLines: changed, varianceValue: value } });
}));

router.post('/stock-takes/:id/cancel', requireAnyPermission(...MANAGE), h(async (req, res) => {
  const m = req.tenant!.models;
  const st = await loadScoped(req, m.StockTake, req.params.id, 'Stock take');
  if (!['counting', 'submitted'].includes(st.status)) throw conflict('This stock take is already closed');
  st.status = 'cancelled';
  await st.save();
  await audit(req, { action: 'inventory.stocktake_cancel', resource: 'stock_take', resourceId: String(st._id) });
  res.json({ success: true, data: st });
}));

/* ================================================================== Stock movement report */
const IN_TYPES = ['receipt', 'transfer_in', 'return'];
/** Per item for a period: opening, received, issued/dispensed, adjusted, closing (worked back from today's stock). */
router.get('/stock/movement-report', requireAnyPermission('inventory.view', 'pharmacy.view', ...MANAGE), h(async (req, res) => {
  const m = req.tenant!.models;
  const range = dayRange(req.query.from, req.query.to);
  const locFilter = req.query.locationId ? { locationId: (await loc(req, req.query.locationId))._id } : { ...branchFilter(req) };
  const locationIds = req.query.locationId ? [locFilter.locationId as Types.ObjectId] : (await m.StockLocation.find(branchFilter(req)).select('_id').lean()).map((l) => l._id);
  const itemFilter: Record<string, unknown> = { active: true };
  if (req.query.category) itemFilter.category = String(req.query.category);
  if (req.query.itemId) itemFilter._id = oid(req.query.itemId, 'Item');
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q) Object.assign(itemFilter, itemSearch(q));
  const items = await m.Item.find(itemFilter).select('code name strength unit category').lean();
  const itemIds = items.map((i) => i._id);
  const soh = await stockOnHand(m, { locationIds, itemIds });
  const moves = await m.StockMovement.find({ locationId: { $in: locationIds }, itemId: { $in: itemIds }, createdAt: { $gte: range.$gte } }).select('itemId type quantity createdAt').lean();
  const rows = items.map((it) => {
    const k = String(it._id);
    const mine = moves.filter((mv) => String(mv.itemId) === k);
    const inPeriod = mine.filter((mv) => mv.createdAt <= range.$lte);
    const after = mine.filter((mv) => mv.createdAt > range.$lte).reduce((s, mv) => s + mv.quantity, 0);
    const sum = (f: (t: string, q: number) => boolean) => inPeriod.filter((mv) => f(mv.type, mv.quantity)).reduce((s, mv) => s + mv.quantity, 0);
    const received = sum((t) => IN_TYPES.includes(t));
    const issued = -sum((t) => t === 'dispense' || t === 'transfer_out');
    const adjusted = sum((t) => t === 'adjustment' || t === 'expiry_writeoff');
    const current = soh.get(k)?.onHand ?? 0;
    const closing = current - after;
    const opening = closing - received + issued - adjusted;
    return { itemId: k, code: it.code, name: `${it.name}${it.strength ? ` ${it.strength}` : ''}`, unit: it.unit, category: it.category, opening, received, issued, adjusted, closing };
  }).filter((r) => r.opening || r.received || r.issued || r.adjusted || r.closing);
  res.json({ success: true, data: rows.sort((a, b) => a.name.localeCompare(b.name)), meta: { from: range.$gte, to: range.$lte } });
}));

/* ================================================================== Reorder (LPO) suggestions */
/** Items at or below their reorder level, with a suggested order (rounded up to whole packs) and the last cost. */
router.get('/stock/reorder-suggestions', requireAnyPermission('inventory.view', 'procurement.view', 'procurement.manage', 'lab.manage', ...MANAGE), h(async (req, res) => {
  const m = req.tenant!.models;
  const locationIds = req.query.locationId ? [(await loc(req, req.query.locationId))._id] : (await m.StockLocation.find(branchFilter(req)).select('_id').lean()).map((l) => l._id);
  const filter: Record<string, unknown> = { active: true, reorderLevel: { $gt: 0 } };
  if (req.query.category) filter.category = String(req.query.category);
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q) Object.assign(filter, itemSearch(q));
  const items = await m.Item.find(filter).lean();
  const soh = await stockOnHand(m, { locationIds, itemIds: items.map((i) => i._id) });
  const lastCost = new Map<string, number>();
  for (const b of await m.Batch.find({ itemId: { $in: items.map((i) => i._id) } }).select('itemId unitCost').sort({ receivedAt: -1 }).lean()) {
    if (!lastCost.has(String(b.itemId))) lastCost.set(String(b.itemId), b.unitCost ?? 0);
  }
  const open = await m.PurchaseOrder.find({ status: { $in: ['draft', 'approved', 'partially_received'] }, 'items.itemId': { $in: items.map((i) => i._id) } }).select('poNumber items').lean();
  const rows = items.map((it) => {
    const usable = soh.get(String(it._id))?.usable ?? 0;
    if (usable > it.reorderLevel) return null;
    const pack = Math.max(1, it.packSize ?? 1);
    const want = Math.max(it.reorderLevel * 2 - usable, pack);
    const suggested = Math.ceil(want / pack) * pack;
    const onOrder = open.flatMap((po) => po.items.filter((i) => String(i.itemId) === String(it._id)).map((i) => ({ po: po.poNumber, quantity: i.quantity - (i.receivedQuantity ?? 0) }))).filter((x) => x.quantity > 0);
    return { itemId: String(it._id), code: it.code, name: `${it.name}${it.strength ? ` ${it.strength}` : ''}`, category: it.category, unit: it.unit, packUnit: it.packUnit, packSize: pack, usable, reorderLevel: it.reorderLevel, suggestedQuantity: suggested, lastUnitCost: lastCost.get(String(it._id)) ?? 0, onOrder };
  }).filter(Boolean);
  res.json({ success: true, data: rows });
}));

export default router;
