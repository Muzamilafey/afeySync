import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse, parsePatch } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid, round2 } from '../common/helpers';
import { receiveIntoLocation } from '../pharmacy/pharmacy.routes';

const router = Router();
router.use(authenticateTenant);

const supplierSchema = z.object({ name: z.string().min(2).max(160), contactPerson: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.string().email().optional().or(z.literal('')), kraPin: z.string().max(20).optional(), address: z.string().max(300).optional(), active: z.boolean().optional() });

router.get('/suppliers', requireAnyPermission('procurement.view', 'inventory.view', 'pharmacy.stock'), h(async (req, res) => {
  res.json({ success: true, data: await req.tenant!.models.Supplier.find(req.query.all === 'true' ? {} : { active: true }).sort({ name: 1 }).lean() });
}));

router.post('/suppliers', requirePermission('procurement.manage'), h(async (req, res) => {
  const body = parse(supplierSchema, req.body);
  const m = req.tenant!.models;
  if (await m.Supplier.exists({ name: body.name })) throw conflict('Supplier exists');
  const s = await m.Supplier.create({ ...body, email: body.email || undefined });
  await audit(req, { action: 'procurement.supplier_create', resource: 'supplier', resourceId: String(s._id), newValue: body });
  res.status(201).json({ success: true, data: s });
}));

router.patch('/suppliers/:id', requirePermission('procurement.manage'), h(async (req, res) => {
  const body = parsePatch(supplierSchema.partial(), req.body);
  const s = await req.tenant!.models.Supplier.findByIdAndUpdate(oid(req.params.id, 'Supplier'), { $set: body }, { returnDocument: 'after' });
  if (!s) throw notFound('Supplier not found');
  await audit(req, { action: 'procurement.supplier_update', resource: 'supplier', resourceId: String(s._id), newValue: body });
  res.json({ success: true, data: s });
}));

router.get('/purchase-orders', requireAnyPermission('procurement.view', 'inventory.view'), h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { ...branchFilter(req) };
  if (req.query.status) filter.status = String(req.query.status);
  const m = req.tenant!.models;
  const [items, total] = await Promise.all([m.PurchaseOrder.find(filter).populate('supplierId', 'name').populate('locationId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.PurchaseOrder.countDocuments(filter)]);
  res.json({ success: true, data: items, meta: { page, limit, total } });
}));

router.get('/purchase-orders/:id', requireAnyPermission('procurement.view', 'inventory.view'), h(async (req, res) => {
  const po = await loadScoped(req, req.tenant!.models.PurchaseOrder, req.params.id, 'Purchase order');
  await po.populate([{ path: 'supplierId', select: 'name phone email' }, { path: 'locationId', select: 'name' }]);
  res.json({ success: true, data: po });
}));

// Store, pharmacy and lab managers may raise a draft LPO (e.g. reagents); only procurement approves it.
router.post('/purchase-orders', requireAnyPermission('procurement.manage', 'inventory.manage', 'pharmacy.stock', 'lab.manage'), h(async (req, res) => {
  const body = parse(z.object({ supplierId: z.string(), locationId: z.string(), items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().positive(), unitCost: z.number().min(0) })).min(1).max(200), notes: z.string().max(1000).optional() }), req.body);
  const m = req.tenant!.models;
  const loc = await loadScoped(req, m.StockLocation, body.locationId, 'Stock location');
  if (!(await m.Supplier.exists({ _id: oid(body.supplierId, 'Supplier'), active: true }))) throw notFound('Supplier not found');
  const items = await m.Item.find({ _id: { $in: body.items.map((i) => oid(i.itemId, 'Item')) } }).lean();
  if (items.length !== new Set(body.items.map((i) => i.itemId)).size) throw badRequest('Unknown item on order');
  const po = await m.PurchaseOrder.create({
    poNumber: await nextNumber(m, 'po', 'PO'),
    supplierId: body.supplierId,
    branchId: loc.branchId,
    locationId: loc._id,
    items: body.items.map((i) => ({ ...i, itemName: items.find((x) => String(x._id) === i.itemId)!.name })),
    total: round2(body.items.reduce((s, i) => s + i.quantity * i.unitCost, 0)),
    notes: body.notes,
    createdBy: req.user!.id,
  });
  await audit(req, { action: 'procurement.po_create', resource: 'purchase_order', resourceId: String(po._id), newValue: { poNumber: po.poNumber, total: po.total } });
  res.status(201).json({ success: true, data: po });
}));

router.post('/purchase-orders/:id/approve', requirePermission('procurement.manage'), h(async (req, res) => {
  const po = await loadScoped(req, req.tenant!.models.PurchaseOrder, req.params.id, 'Purchase order');
  if (po.status !== 'draft') throw conflict(`PO is ${po.status}`);
  if (String(po.createdBy) === req.user!.id) throw forbidden('A purchase order must be approved by someone other than its author', 'SEGREGATION_OF_DUTIES');
  po.status = 'approved';
  po.approvedBy = req.user!.id as never;
  po.approvedAt = new Date();
  await po.save();
  await audit(req, { action: 'procurement.po_approve', resource: 'purchase_order', resourceId: String(po._id) });
  res.json({ success: true, data: po });
}));

router.post('/purchase-orders/:id/cancel', requirePermission('procurement.manage'), h(async (req, res) => {
  const po = await loadScoped(req, req.tenant!.models.PurchaseOrder, req.params.id, 'Purchase order');
  if (!['draft', 'approved'].includes(po.status)) throw conflict(`PO is ${po.status}`);
  po.status = 'cancelled';
  await po.save();
  await audit(req, { action: 'procurement.po_cancel', resource: 'purchase_order', resourceId: String(po._id) });
  res.json({ success: true, data: po });
}));

/** Goods received note: receives batches into the PO's location and updates received quantities. */
router.post('/purchase-orders/:id/receive', requireAnyPermission('procurement.manage', 'inventory.manage', 'pharmacy.stock'), h(async (req, res) => {
  const body = parse(z.object({ deliveryNote: z.string().max(80).optional(), lines: z.array(z.object({ itemId: z.string(), batchNumber: z.string().min(1).max(60), expiryDate: z.coerce.date(), quantity: z.number().int().positive() })).min(1).max(200) }), req.body);
  const m = req.tenant!.models;
  const po = await loadScoped(req, m.PurchaseOrder, req.params.id, 'Purchase order');
  if (!['approved', 'partially_received'].includes(po.status)) throw conflict('Only approved purchase orders can be received');
  for (const l of body.lines) {
    const line = po.items.find((i) => String(i.itemId) === l.itemId);
    if (!line) throw badRequest('Item is not on this purchase order');
    const received = body.lines.filter((x) => x.itemId === l.itemId).reduce((s, x) => s + x.quantity, 0);
    if ((line.receivedQuantity ?? 0) + received > line.quantity) throw badRequest(`Receiving more ${line.itemName} than ordered`);
  }
  const loc = await m.StockLocation.findById(po.locationId);
  await receiveIntoLocation(req, loc!, body.lines.map((l) => ({ ...l, unitCost: po.items.find((i) => String(i.itemId) === l.itemId)!.unitCost })), po.poNumber, String(po.supplierId));
  for (const l of body.lines) {
    const line = po.items.find((i) => String(i.itemId) === l.itemId)!;
    line.receivedQuantity = (line.receivedQuantity ?? 0) + l.quantity;
  }
  po.receipts.push({ at: new Date(), by: req.user!.id, deliveryNote: body.deliveryNote, lines: body.lines } as never);
  po.status = po.items.every((i) => (i.receivedQuantity ?? 0) >= i.quantity) ? 'received' : 'partially_received';
  await po.save();
  await audit(req, { action: 'procurement.po_receive', resource: 'purchase_order', resourceId: String(po._id), newValue: body });
  res.json({ success: true, data: po });
}));

export default router;
