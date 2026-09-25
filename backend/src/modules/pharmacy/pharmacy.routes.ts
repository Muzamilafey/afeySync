import { notifyStaff } from '../notifications/notify';
import { importUpload, sendXlsx } from '../imports/excel';
import { importItems, itemTemplate } from '../imports/itemImport';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse, parsePatch } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid, round2 } from '../common/helpers';
import { postCharge, recalcInvoice } from '../billing/billingService';
import { enqueue } from '../frontdesk/queueService';
import { allocateFefo, stockOnHand } from './stockService';
import { allergyConflicts } from './allergyCheck';

const router = Router();
router.use(authenticateTenant);

const STOCK_WRITE = ['pharmacy.stock', 'inventory.manage'];
const STOCK_READ = ['pharmacy.view', 'inventory.view', 'pharmacy.stock', 'inventory.manage'];
/** Ward nurses search the drug list (with stock) to chart doses. */
const DRUG_SEARCH = [...STOCK_READ, 'prescription.create', 'nursing.view', 'nursing.record'];

async function location(req: Request, id: unknown) {
  return loadScoped(req, req.tenant!.models.StockLocation, id, 'Stock location');
}

/* ------------------------------------------------------------ Items */
const itemSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9-_.]+$/, 'can only contain letters, numbers and - _ .'),
  name: z.string().min(2).max(160),
  genericName: z.string().max(160).optional(),
  form: z.string().max(60).optional(),
  strength: z.string().max(60).optional(),
  unit: z.string().max(30).default('unit'),
  category: z.enum(['drug', 'consumable', 'reagent', 'equipment', 'other']).default('drug'),
  controlled: z.boolean().default(false),
  reorderLevel: z.number().int().min(0).default(0),
  serviceCode: z.string().max(40).optional(),
  active: z.boolean().optional(),
});

router.get(
  '/items',
  requireAnyPermission(...DRUG_SEARCH),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const q = String(req.query.q ?? '').trim();
    const filter: Record<string, unknown> = req.query.all === 'true' ? {} : { active: true };
    if (q) filter.$or = [{ code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) }, { name: new RegExp(escapeRegex(q), 'i') }, { genericName: new RegExp(escapeRegex(q), 'i') }];
    if (req.query.category) filter.category = String(req.query.category);
    const items = await m.Item.find(filter).sort({ name: 1 }).limit(Math.min(500, Number(req.query.limit) || 100)).lean();
    const locs = await m.StockLocation.find(req.branch ? { branchId: req.branch.id } : branchFilter(req)).select('_id').lean();
    const soh = await stockOnHand(m, { locationIds: locs.map((l) => l._id), itemIds: items.map((i) => i._id) });
    res.json({ success: true, data: items.map((i) => ({ ...i, stock: soh.get(String(i._id)) ?? { onHand: 0, usable: 0, expired: 0, value: 0 } })) });
  }),
);

router.post(
  '/items',
  requireAnyPermission(...STOCK_WRITE),
  h(async (req, res) => {
    const body = parse(itemSchema, req.body);
    const m = req.tenant!.models;
    if (await m.Item.exists({ code: body.code.toUpperCase() })) throw conflict('Item code exists');
    const i = await m.Item.create({ ...body, code: body.code.toUpperCase(), isDrug: body.category === 'drug' });
    await audit(req, { action: 'inventory.item_create', resource: 'item', resourceId: String(i._id), newValue: body });
    res.status(201).json({ success: true, data: i });
  }),
);

/* Bulk import of inventory items from Excel (template → preview → import) */
router.get(
  '/items/import-template',
  requireAnyPermission(...STOCK_WRITE),
  h(async (req, res) => {
    sendXlsx(res, 'inventory-items-template.xlsx', await itemTemplate(req));
  }),
);

router.post(
  '/items/import',
  requireAnyPermission(...STOCK_WRITE),
  importUpload,
  h(async (req, res) => {
    const commit = String(req.body?.commit ?? req.query.commit ?? '') === 'true';
    res.json({ success: true, data: await importItems(req, commit) });
  }),
);

router.patch(
  '/items/:id',
  requireAnyPermission(...STOCK_WRITE),
  h(async (req, res) => {
    const body = parsePatch(itemSchema.omit({ code: true }).partial(), req.body);
    const i = await req.tenant!.models.Item.findByIdAndUpdate(oid(req.params.id, 'Item'), { $set: body }, { returnDocument: 'after' });
    if (!i) throw notFound('Item not found');
    await audit(req, { action: 'inventory.item_update', resource: 'item', resourceId: String(i._id), newValue: body });
    res.json({ success: true, data: i });
  }),
);

/* ------------------------------------------------------------ Locations & stock */
router.get(
  '/locations',
  requireAnyPermission(...STOCK_READ),
  h(async (req, res) => {
    res.json({ success: true, data: await req.tenant!.models.StockLocation.find({ ...branchFilter(req), active: true }).populate('branchId', 'branchName').sort({ name: 1 }).lean() });
  }),
);

router.post(
  '/locations',
  requirePermission('inventory.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ name: z.string().min(2).max(80), type: z.enum(['store', 'pharmacy', 'ward', 'lab', 'theatre']) }), req.body);
    const l = await req.tenant!.models.StockLocation.create({ ...body, branchId: req.branch!.id });
    await audit(req, { action: 'inventory.location_create', resource: 'stock_location', resourceId: String(l._id), newValue: body });
    res.status(201).json({ success: true, data: l });
  }),
);

router.get(
  '/stock',
  requireAnyPermission(...STOCK_READ),
  h(async (req, res) => {
    const loc = await location(req, req.query.locationId);
    const filter: Record<string, unknown> = { locationId: loc._id, quantity: { $gt: 0 } };
    if (req.query.itemId) filter.itemId = oid(req.query.itemId, 'Item');
    res.json({ success: true, data: await req.tenant!.models.Batch.find(filter).populate('itemId', 'code name unit strength form').sort({ expiryDate: 1 }).lean() });
  }),
);

router.get(
  '/stock/summary',
  requireAnyPermission(...STOCK_READ),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const loc = req.query.locationId ? await location(req, req.query.locationId) : null;
    const locs = loc ? [loc._id] : (await m.StockLocation.find(req.branch ? { branchId: req.branch.id } : branchFilter(req)).select('_id').lean()).map((l) => l._id);
    const items = await m.Item.find({ active: true }).sort({ name: 1 }).lean();
    const soh = await stockOnHand(m, { locationIds: locs });
    const rows = items.map((i) => ({ _id: i._id, code: i.code, name: i.name, unit: i.unit, category: i.category, reorderLevel: i.reorderLevel, ...(soh.get(String(i._id)) ?? { onHand: 0, usable: 0, expired: 0, value: 0 }) }));
    res.json({ success: true, data: rows.map((r) => ({ ...r, value: round2(r.value), lowStock: r.usable <= (r.reorderLevel ?? 0) })), meta: { totalValue: round2(rows.reduce((s, r) => s + r.value, 0)), lowStock: rows.filter((r) => r.usable <= (r.reorderLevel ?? 0) && (r.reorderLevel ?? 0) > 0).length } });
  }),
);

router.get(
  '/stock/expiring',
  requireAnyPermission(...STOCK_READ),
  h(async (req, res) => {
    const days = Math.min(365, Number(req.query.days) || 90);
    const m = req.tenant!.models;
    const locs = await m.StockLocation.find(req.branch ? { branchId: req.branch.id } : branchFilter(req)).select('_id').lean();
    const rows = await m.Batch.find({ locationId: { $in: locs.map((l) => l._id) }, quantity: { $gt: 0 }, expiryDate: { $lte: new Date(Date.now() + days * 86400_000) } }).populate('itemId', 'code name unit').populate('locationId', 'name').sort({ expiryDate: 1 }).lean();
    res.json({ success: true, data: rows });
  }),
);

router.get(
  '/stock/movements',
  requireAnyPermission(...STOCK_READ),
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.itemId) filter.itemId = oid(req.query.itemId, 'Item');
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.from || req.query.to) filter.createdAt = dayRange(req.query.from, req.query.to);
    const m = req.tenant!.models;
    const [items, total] = await Promise.all([m.StockMovement.find(filter).populate('itemId', 'code name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.StockMovement.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

const receiptLine = z.object({ itemId: z.string(), batchNumber: z.string().min(1).max(60), expiryDate: z.coerce.date(), quantity: z.number().positive().max(1_000_000), unitCost: z.number().min(0).default(0) });

export async function receiveIntoLocation(req: Request, loc: { _id: Types.ObjectId; branchId: Types.ObjectId }, lines: z.infer<typeof receiptLine>[], reference: string, supplierId?: string) {
  const m = req.tenant!.models;
  for (const l of lines) {
    if (l.expiryDate < new Date()) throw badRequest(`Batch ${l.batchNumber} is already expired`);
    if (!(await m.Item.exists({ _id: oid(l.itemId, 'Item') }))) throw notFound('Item not found');
  }
  const out = [];
  for (const l of lines) {
    const existing = await m.Batch.findOne({ itemId: l.itemId, locationId: loc._id, batchNumber: l.batchNumber, expiryDate: l.expiryDate });
    const batch = existing ?? new m.Batch({ itemId: l.itemId, locationId: loc._id, branchId: loc.branchId, batchNumber: l.batchNumber, expiryDate: l.expiryDate, quantity: 0, unitCost: l.unitCost, supplierId });
    if (existing) await m.Batch.updateOne({ _id: existing._id }, { $inc: { quantity: l.quantity } });
    else {
      batch.quantity = l.quantity;
      await batch.save();
    }
    await m.StockMovement.create({ itemId: l.itemId, batchId: batch._id, locationId: loc._id, branchId: loc.branchId, type: 'receipt', quantity: l.quantity, reference, by: req.user!.id });
    out.push(batch._id);
  }
  return out;
}

router.post(
  '/stock/receive',
  requireAnyPermission(...STOCK_WRITE),
  h(async (req, res) => {
    const body = parse(z.object({ locationId: z.string(), lines: z.array(receiptLine).min(1).max(200), reference: z.string().max(80).default('Direct receipt'), supplierId: z.string().optional() }), req.body);
    const loc = await location(req, body.locationId);
    const ids = await receiveIntoLocation(req, loc, body.lines, body.reference, body.supplierId);
    await audit(req, { action: 'inventory.receive', resource: 'stock_location', resourceId: String(loc._id), newValue: body });
    res.status(201).json({ success: true, data: { batches: ids } });
  }),
);

router.post(
  '/stock/adjust',
  requirePermission('inventory.manage'),
  h(async (req, res) => {
    const body = parse(z.object({ batchId: z.string(), quantityDelta: z.number().int().refine((n) => n !== 0), reason: z.string().min(5).max(300), type: z.enum(['adjustment', 'expiry_writeoff']).default('adjustment') }), req.body);
    const m = req.tenant!.models;
    const batch = await loadScoped(req, m.Batch, body.batchId, 'Batch');
    if (body.type === 'expiry_writeoff' && body.quantityDelta > 0) throw badRequest('Write-offs reduce stock');
    const r = await m.Batch.updateOne({ _id: batch._id, quantity: { $gte: Math.max(0, -body.quantityDelta) } }, { $inc: { quantity: body.quantityDelta } });
    if (r.modifiedCount !== 1) throw new AppError(422, 'INSUFFICIENT_STOCK', 'Adjustment would make stock negative');
    await m.StockMovement.create({ itemId: batch.itemId, batchId: batch._id, locationId: batch.locationId, branchId: batch.branchId, type: body.type, quantity: body.quantityDelta, reason: body.reason, by: req.user!.id });
    await audit(req, { action: `inventory.${body.type}`, resource: 'batch', resourceId: String(batch._id), newValue: body });
    res.json({ success: true });
  }),
);

router.post(
  '/stock/transfer',
  requireAnyPermission(...STOCK_WRITE),
  h(async (req, res) => {
    const body = parse(z.object({ fromLocationId: z.string(), toLocationId: z.string(), itemId: z.string(), quantity: z.number().positive() }), req.body);
    if (body.fromLocationId === body.toLocationId) throw badRequest('Choose two different locations');
    const m = req.tenant!.models;
    const [from, to] = [await location(req, body.fromLocationId), await location(req, body.toLocationId)];
    const allocations = await allocateFefo(m, { itemId: body.itemId, locationId: from._id, quantity: body.quantity });
    const ref = await nextNumber(m, 'transfer', 'TRF');
    for (const a of allocations) {
      await m.StockMovement.create({ itemId: body.itemId, batchId: a.batchId, locationId: from._id, branchId: from.branchId, type: 'transfer_out', quantity: -a.quantity, reference: ref, by: req.user!.id });
      const dest = await m.Batch.findOneAndUpdate({ itemId: body.itemId, locationId: to._id, batchNumber: a.batchNumber, expiryDate: a.expiryDate }, { $inc: { quantity: a.quantity }, $setOnInsert: { branchId: to.branchId, unitCost: a.unitCost } }, { upsert: true, returnDocument: 'after' });
      await m.StockMovement.create({ itemId: body.itemId, batchId: dest!._id, locationId: to._id, branchId: to.branchId, type: 'transfer_in', quantity: a.quantity, reference: ref, by: req.user!.id });
    }
    await audit(req, { action: 'inventory.transfer', resource: 'item', resourceId: body.itemId, newValue: { ...body, reference: ref } });
    res.json({ success: true, data: { reference: ref, allocations } });
  }),
);

/* ------------------------------------------------------------ Prescriptions */
const rxItem = z.object({
  itemId: z.string().optional(),
  drugName: z.string().min(2).max(160),
  dose: z.string().max(60).optional(),
  frequency: z.string().max(60).optional(),
  route: z.string().max(40).optional(),
  durationDays: z.number().int().min(0).max(365).optional(),
  quantity: z.number().positive().max(100_000),
  instructions: z.string().max(500).optional(),
});

router.post(
  '/prescriptions',
  requirePermission('prescription.create'),
  h(async (req, res) => {
    const body = parse(z.object({ visitId: z.string().optional(), admissionId: z.string().optional(), urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'), items: z.array(rxItem).min(1).max(30), overrideAllergy: z.object({ reason: z.string().min(5).max(300) }).optional() }), req.body);
    const m = req.tenant!.models;
    let ctx: { patientId: Types.ObjectId; branchId: Types.ObjectId; visitId?: Types.ObjectId | null; admissionId?: Types.ObjectId; ward?: { wardId: Types.ObjectId; name?: string; bedNumber?: string } };
    if (body.visitId) {
      const v = await loadScoped(req, m.Visit, body.visitId, 'Visit');
      if (!['open', 'in_progress', 'admitted'].includes(v.status)) throw conflict('Visit is closed');
      ctx = { patientId: v.patientId, branchId: v.branchId, visitId: v._id };
    } else if (body.admissionId) {
      const a = await loadScoped(req, m.Admission, body.admissionId, 'Admission');
      if (a.status !== 'admitted') throw conflict('Patient is no longer admitted');
      const [ward, bed] = await Promise.all([m.Ward.findById(a.wardId).select('name').lean(), m.Bed.findById(a.bedId).select('number').lean()]);
      ctx = { patientId: a.patientId, branchId: a.branchId, visitId: a.visitId, admissionId: a._id, ward: { wardId: a.wardId, name: ward?.name, bedNumber: bed?.number } };
    } else throw badRequest('visitId or admissionId is required');
    // Allergy safety check against recorded allergies (drug and generic names).
    const patient = await m.Patient.findById(ctx.patientId).select('allergies').lean();
    const items = await m.Item.find({ _id: { $in: body.items.filter((i) => i.itemId).map((i) => oid(i.itemId, 'Item')) } }).lean();
    const hits: string[] = [];
    for (const i of body.items) {
      const item = items.find((x) => String(x._id) === i.itemId);
      for (const sub of allergyConflicts(patient?.allergies ?? [], [i.drugName, item?.name ?? '', item?.genericName ?? ''])) hits.push(`${i.drugName} ↔ allergy to ${sub}`);
    }
    if (hits.length && !body.overrideAllergy) throw new AppError(422, 'ALLERGY_ALERT', `Possible allergy conflict: ${hits.join('; ')}`, hits);
    const rx = await m.Prescription.create({ rxNumber: await nextNumber(m, 'rx', 'RX'), ...ctx, urgency: ctx.admissionId ? body.urgency : 'routine', prescriberId: req.user!.id, prescriberName: req.user!.name, items: body.items });
    if (ctx.admissionId) {
      // Ward request: tell the pharmacy team (in-app); STAT/urgent requests are flagged.
      const roleIds = (await m.Role.find({ permissions: 'pharmacy.dispense' }).select('_id').lean()).map((r) => r._id);
      const staff = await m.User.find({ status: 'active', roleIds: { $in: roleIds } }).select('_id').lean();
      const tag = rx.urgency === 'stat' ? 'STAT ' : rx.urgency === 'urgent' ? 'Urgent ' : '';
      await notifyStaff(m, staff.map((u) => u._id), { event: 'Prescription', title: `${tag}ward request ${rx.rxNumber}: ${ctx.ward?.name ?? 'ward'}${ctx.ward?.bedNumber ? `, bed ${ctx.ward.bedNumber}` : ''}`, body: body.items.map((i) => i.drugName).join(', '), link: '/pharmacy?view=ward', branchId: ctx.branchId });
    } else if (ctx.visitId) await enqueue(m, { visitId: ctx.visitId, patientId: ctx.patientId, branchId: ctx.branchId, stage: 'pharmacy' });
    await audit(req, { action: 'prescription.create', resource: 'prescription', resourceId: String(rx._id), newValue: { items: body.items.map((i) => i.drugName), allergyOverride: body.overrideAllergy?.reason, allergyHits: hits } });
    res.status(201).json({ success: true, data: rx });
  }),
);

router.get(
  '/prescriptions',
  requireAnyPermission('pharmacy.view', 'prescription.create', 'nursing.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    for (const k of ['visitId', 'admissionId', 'patientId'] as const) if (req.query[k]) filter[k] = oid(req.query[k], k);
    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    // source=ward: inpatient requests; source=opd: outpatient prescriptions.
    if (req.query.source === 'ward') filter.admissionId = { $ne: null };
    else if (req.query.source === 'opd') filter.admissionId = null;
    const [rows, total] = await Promise.all([m.Prescription.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth allergies').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.Prescription.countDocuments(filter)]);
    // Outstanding ward requests: STAT first, then urgent, then oldest first.
    const rank = { stat: 0, urgent: 1, routine: 2 } as Record<string, number>;
    const items = req.query.source === 'ward' && String(req.query.status ?? '').includes('pending') ? [...rows].sort((a, b) => (rank[a.urgency ?? 'routine'] - rank[b.urgency ?? 'routine']) || (new Date(a.createdAt as never).getTime() - new Date(b.createdAt as never).getTime())) : rows;
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/prescriptions/:id',
  requireAnyPermission('pharmacy.view', 'prescription.create'),
  h(async (req, res) => {
    const rx = await loadScoped(req, req.tenant!.models.Prescription, req.params.id, 'Prescription');
    const patient = await req.tenant!.models.Patient.findById(rx.patientId).select('patientNumber firstName lastName gender dateOfBirth allergies').lean();
    res.json({ success: true, data: { ...rx.toObject(), patient } });
  }),
);

function refreshRxStatus(rx: { items: Array<{ quantity: number; dispensedQuantity?: number | null; status: string }>; status: string }) {
  for (const i of rx.items) if (i.status !== 'cancelled') i.status = (i.dispensedQuantity ?? 0) >= i.quantity ? 'dispensed' : (i.dispensedQuantity ?? 0) > 0 ? 'partial' : 'pending';
  const live = rx.items.filter((i) => i.status !== 'cancelled');
  rx.status = live.every((i) => i.status === 'dispensed') ? 'dispensed' : live.some((i) => (i.dispensedQuantity ?? 0) > 0) ? 'partially_dispensed' : live.length ? 'pending' : 'cancelled';
}

router.post(
  '/prescriptions/:id/dispense',
  requirePermission('pharmacy.dispense'),
  h(async (req, res) => {
    const body = parse(z.object({ locationId: z.string(), lines: z.array(z.object({ rxItemId: z.string(), itemId: z.string(), quantity: z.number().positive() })).min(1).max(30) }), req.body);
    const m = req.tenant!.models;
    const rx = await loadScoped(req, m.Prescription, req.params.id, 'Prescription');
    if (['dispensed', 'cancelled'].includes(rx.status)) throw conflict(`Prescription is ${rx.status}`);
    const loc = await location(req, body.locationId);
    const dispenseNo = rx.dispenses.length + 1;
    const lines: Array<{ rxItemId: Types.ObjectId; itemId: Types.ObjectId; batchId: Types.ObjectId; batchNumber: string; quantity: number }> = [];
    const done: Array<{ itemId: string; alloc: Awaited<ReturnType<typeof allocateFefo>> }> = [];
    try {
      for (const l of body.lines) {
        const ri = rx.items.id(oid(l.rxItemId, 'Prescription item'));
        if (!ri || ri.status === 'cancelled') throw notFound('Prescription item not found');
        const outstanding = ri.quantity - (ri.dispensedQuantity ?? 0);
        if (l.quantity > outstanding + 1e-9) throw new AppError(422, 'OVER_DISPENSE', `Only ${outstanding} outstanding for ${ri.drugName}`);
        const item = await m.Item.findById(oid(l.itemId, 'Item')).lean();
        if (!item) throw notFound('Item not found');
        const alloc = await allocateFefo(m, { itemId: item._id, locationId: loc._id, quantity: l.quantity });
        done.push({ itemId: String(item._id), alloc });
        ri.itemId = item._id as never;
        ri.dispensedQuantity = (ri.dispensedQuantity ?? 0) + l.quantity;
        for (const a of alloc) lines.push({ rxItemId: ri._id, itemId: item._id, batchId: a.batchId, batchNumber: a.batchNumber, quantity: a.quantity });
        await postCharge(req, m, { patientId: rx.patientId, visitId: rx.visitId, branchId: rx.branchId, serviceCode: item.serviceCode ?? `RX-${item.code}`, quantity: l.quantity, description: `${item.name}${item.strength ? ` ${item.strength}` : ''}`, source: 'dispense', sourceId: `${rx._id}:${ri._id}:${dispenseNo}` });
      }
    } catch (err) {
      // Return stock taken for earlier lines of this dispense.
      for (const d of done) for (const a of d.alloc) await m.Batch.updateOne({ _id: a.batchId }, { $inc: { quantity: a.quantity } });
      throw err;
    }
    for (const l of lines) await m.StockMovement.create({ itemId: l.itemId, batchId: l.batchId, locationId: loc._id, branchId: loc.branchId, type: 'dispense', quantity: -l.quantity, reference: rx.rxNumber, by: req.user!.id });
    rx.dispenses.push({ at: new Date(), by: req.user!.id, byName: req.user!.name, lines } as never);
    refreshRxStatus(rx);
    await rx.save();
    await audit(req, { action: 'pharmacy.dispense', resource: 'prescription', resourceId: String(rx._id), newValue: { lines: lines.map((l) => ({ batch: l.batchNumber, qty: l.quantity })) } });
    if (rx.admissionId && rx.prescriberId) void notifyStaff(m, [rx.prescriberId], { event: 'Prescription', title: `Pharmacy dispensed ${rx.rxNumber}${rx.ward?.name ? ` for ${rx.ward.name}` : ''}`, body: 'Ready to collect / receive on the ward.', link: `/inpatient/${rx.admissionId}`, branchId: rx.branchId });
    res.json({ success: true, data: rx });
  }),
);

/** The ward confirms it has received the medicines pharmacy dispensed for an admitted patient. */
router.post(
  '/prescriptions/:id/receive',
  requirePermission('nursing.record'),
  h(async (req, res) => {
    const { note } = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body ?? {});
    const m = req.tenant!.models;
    const rx = await loadScoped(req, m.Prescription, req.params.id, 'Prescription');
    if (!rx.admissionId) throw badRequest('Only ward requests are received on the ward');
    const received = Math.max(0, ...(rx.receipts ?? []).map((r) => r.dispenseCount ?? 0));
    if (rx.dispenses.length === 0 || received >= rx.dispenses.length) throw conflict('There is nothing new to receive from pharmacy', undefined, 'NOTHING_TO_RECEIVE');
    rx.receipts.push({ at: new Date(), by: req.user!.id, byName: req.user!.name, dispenseCount: rx.dispenses.length, note } as never);
    await rx.save();
    await audit(req, { action: 'pharmacy.ward_received', resource: 'prescription', resourceId: String(rx._id), newValue: { dispenses: rx.dispenses.length, note } });
    if (rx.prescriberId) void notifyStaff(m, [rx.prescriberId], { event: 'Prescription', title: `${rx.rxNumber} received on the ward`, link: `/inpatient/${rx.admissionId}`, branchId: rx.branchId });
    res.json({ success: true, data: rx });
  }),
);

router.post(
  '/prescriptions/:id/return',
  requirePermission('pharmacy.dispense'),
  h(async (req, res) => {
    const body = parse(z.object({ rxItemId: z.string(), batchId: z.string(), quantity: z.number().positive(), reason: z.string().min(5).max(300) }), req.body);
    const m = req.tenant!.models;
    const rx = await loadScoped(req, m.Prescription, req.params.id, 'Prescription');
    const ri = rx.items.id(oid(body.rxItemId, 'Prescription item'));
    if (!ri) throw notFound('Prescription item not found');
    const dispensedFromBatch = rx.dispenses.flatMap((d) => d.lines).filter((l) => String(l.rxItemId) === body.rxItemId && String(l.batchId) === body.batchId).reduce((s, l) => s + (l.quantity ?? 0), 0);
    if (body.quantity > dispensedFromBatch - (ri.returnedQuantity ?? 0) + 1e-9) throw new AppError(422, 'RETURN_EXCEEDS_DISPENSED', 'Return exceeds quantity dispensed from this batch');
    const batch = await m.Batch.findById(oid(body.batchId, 'Batch'));
    if (!batch) throw notFound('Batch not found');
    await m.Batch.updateOne({ _id: batch._id }, { $inc: { quantity: body.quantity } });
    await m.StockMovement.create({ itemId: batch.itemId, batchId: batch._id, locationId: batch.locationId, branchId: batch.branchId, type: 'return', quantity: body.quantity, reference: rx.rxNumber, reason: body.reason, by: req.user!.id });
    ri.returnedQuantity = (ri.returnedQuantity ?? 0) + body.quantity;
    ri.dispensedQuantity = Math.max(0, (ri.dispensedQuantity ?? 0) - body.quantity);
    refreshRxStatus(rx);
    await rx.save();
    // Reduce the charge on the (unpaid) invoice; paid amounts are handled by a cashier refund.
    const inv = await m.Invoice.findOne({ 'lines.source': 'dispense', status: { $ne: 'void' }, patientId: rx.patientId }).sort({ createdAt: -1 });
    const line = inv?.lines.filter((l) => l.source === 'dispense' && l.sourceId?.startsWith(`${rx._id}:${ri._id}:`) && !l.voided).pop();
    if (inv && line) {
      line.quantity = Math.max(0, line.quantity - body.quantity);
      line.amount = round2(line.quantity * line.unitPrice);
      await recalcInvoice(m, inv);
    }
    await audit(req, { action: 'pharmacy.return', resource: 'prescription', resourceId: String(rx._id), newValue: body });
    res.json({ success: true, data: rx });
  }),
);

router.post(
  '/prescriptions/:id/cancel',
  requireAnyPermission('prescription.create', 'pharmacy.dispense'),
  h(async (req, res) => {
    const { reason, rxItemId } = parse(z.object({ reason: z.string().min(3).max(300), rxItemId: z.string().optional() }), req.body);
    const m = req.tenant!.models;
    const rx = await loadScoped(req, m.Prescription, req.params.id, 'Prescription');
    const targets = rxItemId ? rx.items.filter((i) => String(i._id) === rxItemId) : rx.items;
    if (!targets.length) throw notFound('Prescription item not found');
    for (const i of targets) {
      if ((i.dispensedQuantity ?? 0) > 0) throw conflict(`${i.drugName} has already been dispensed; use a return instead`);
      i.status = 'cancelled';
    }
    refreshRxStatus(rx);
    await rx.save();
    await audit(req, { action: 'prescription.cancel', resource: 'prescription', resourceId: String(rx._id), newValue: { reason, rxItemId } });
    res.json({ success: true, data: rx });
  }),
);

export default router;
export { forbidden, canAccessBranch, Types };
