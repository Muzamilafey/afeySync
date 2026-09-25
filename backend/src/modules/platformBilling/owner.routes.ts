import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { meta } from '../../models/meta';
import { platformAudit } from '../audit/auditService';
import { enqueueJob } from '../../jobs/queue';
import { DEFAULT_CONTRACT_TEMPLATE, toBuffer, assetLimit, businessSchema, currentAssets, getBusiness, saveBusiness, sniffImage, type AssetKind } from './business';
import { applyPayment, computeTotals, contractVars, issueDocument, nextNumber, renderContractBody, round2, type BillingDoc, type DocType } from './documentService';
import { renderDocumentPdf } from './pdf';
import { refreshStk, registerCollectionsC2B, requestStk } from './platformMpesa';

/** Owner portal → Billing: business profile, branding, quotations, invoices, contracts and payments. */
export const billingOwnerRouter = Router();
billingOwnerRouter.use(authenticatePlatform);
const perm = requirePermission('owner.subscriptions');
const actor = (req: Request) => ({ name: req.platformUser!.name, id: req.platformUser!.id });

/* ------------------------------------------------------------------ Business profile & branding */
billingOwnerRouter.get('/settings', perm, h(async (_req, res) => {
  res.json({ success: true, data: { business: await getBusiness(), assets: await currentAssets(), defaultContractTemplate: DEFAULT_CONTRACT_TEMPLATE } });
}));
billingOwnerRouter.put('/settings', requirePermission('owner.platform'), h(async (req, res) => {
  const body = parse(businessSchema, req.body);
  const before = await getBusiness();
  await saveBusiness(body);
  await platformAudit(req, { action: 'billing.settings', resource: 'platform_settings', resourceId: 'business', oldValue: before, newValue: body });
  res.json({ success: true, data: body });
}));

billingOwnerRouter.post('/assets/:kind', requirePermission('owner.platform'), h(async (req, res) => {
  const kind = z.enum(['logo', 'stamp', 'signature']).parse(req.params.kind) as AssetKind;
  const { dataBase64 } = parse(z.object({ dataBase64: z.string().min(20).max(Math.ceil((assetLimit * 4) / 3) + 100) }), req.body);
  const data = Buffer.from(dataBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (data.length > assetLimit) throw new AppError(413, 'FILE_TOO_LARGE', 'Images must be 1 MB or smaller');
  const mimeType = sniffImage(data);
  if (!mimeType) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a PNG (transparent background recommended) or JPEG image');
  const { BrandAsset } = meta();
  // Previous versions are kept (not current) so documents already issued still render with them.
  await BrandAsset.updateMany({ kind, current: true }, { current: false });
  const a = await BrandAsset.create({ kind, mimeType, data, sha256: crypto.createHash('sha256').update(data).digest('hex'), sizeBytes: data.length, current: true, uploadedBy: req.platformUser!.id, uploadedByName: req.platformUser!.name });
  await platformAudit(req, { action: `billing.${kind}_uploaded`, resource: 'brand_asset', resourceId: String(a._id), newValue: { kind, sha256: a.sha256, sizeBytes: a.sizeBytes } });
  res.status(201).json({ success: true, data: { _id: a._id, kind, mimeType, sha256: a.sha256, sizeBytes: a.sizeBytes } });
}));
billingOwnerRouter.delete('/assets/:kind', requirePermission('owner.platform'), h(async (req, res) => {
  const kind = z.enum(['logo', 'stamp', 'signature']).parse(req.params.kind);
  await meta().BrandAsset.updateMany({ kind, current: true }, { current: false });
  await platformAudit(req, { action: `billing.${kind}_removed`, resource: 'brand_asset', resourceId: kind });
  res.json({ success: true });
}));
billingOwnerRouter.get('/assets/file/:id', perm, h(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const a = await meta().BrandAsset.findById(req.params.id).select('+data mimeType').lean();
  if (!a) throw notFound();
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(toBuffer(a.data));
}));

/* ------------------------------------------------------------------ Documents */
const line = z.object({ description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(10_000), unitPrice: z.number().min(0).max(100_000_000), kind: z.enum(['subscription', 'setup', 'service', 'other']).default('service'), planKey: z.string().max(40).optional(), billingCycle: z.enum(['monthly', 'quarterly', 'annual']).optional() });
const customer = z.object({ name: z.string().trim().min(2).max(160), contactName: z.string().trim().max(120).optional(), email: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)), phone: z.string().trim().max(40).optional(), address: z.string().trim().max(300).optional(), kraPin: z.string().trim().toUpperCase().max(20).optional() });
const docSchema = z.object({
  type: z.enum(['quotation', 'invoice', 'contract']),
  tenantId: z.string().optional(),
  customer: customer.optional(),
  lines: z.array(line).max(50).default([]),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(3000).optional(),
  dueDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  contract: z.object({ planKey: z.string().max(40), billingCycle: z.enum(['monthly', 'quarterly', 'annual']), amount: z.number().min(0), startDate: z.coerce.date(), termMonths: z.number().int().min(1).max(120), specialTerms: z.string().trim().max(5000).optional() }).optional(),
});

/** Customer details default to the facility's own record. */
async function customerFor(tenantId: string | undefined, given?: z.infer<typeof customer>) {
  if (!tenantId) {
    if (!given) throw badRequest('Choose a facility or enter the customer');
    return { tenantId: undefined, customer: given };
  }
  if (!isValidObjectId(tenantId)) throw badRequest('Invalid facility');
  const t = await meta().Tenant.findById(tenantId).lean();
  if (!t) throw badRequest('Facility not found');
  return { tenantId: t._id, customer: { name: t.legalName || t.name, email: t.email ?? undefined, phone: t.phone ?? undefined, address: [t.physicalAddress, t.subCounty, t.county].filter(Boolean).join(', ') || undefined, ...(given ?? {}) } };
}

async function validateLines(lines: z.infer<typeof line>[]) {
  for (const l of lines) {
    if (l.kind === 'subscription') {
      if (!l.planKey || !l.billingCycle) throw badRequest('Subscription lines need a plan and billing cycle');
      if (!(await meta().SubscriptionPlan.exists({ key: l.planKey }))) throw badRequest(`Unknown plan ${l.planKey}`);
    }
  }
  return lines.map((l) => ({ ...l, periods: l.kind === 'subscription' ? l.quantity : undefined }));
}

billingOwnerRouter.get('/documents', perm, h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>, 200);
  const filter: Record<string, unknown> = {};
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.tenantId && isValidObjectId(req.query.tenantId)) filter.tenantId = String(req.query.tenantId);
  if (req.query.q) filter.$or = [{ number: new RegExp(escapeRegex(String(req.query.q)), 'i') }, { 'customer.name': new RegExp(escapeRegex(String(req.query.q)), 'i') }];
  const { BillingDocument } = meta();
  const open = { type: 'invoice' as const, status: { $in: ['issued' as const, 'partially_paid' as const] } };
  const [rows, total, outstanding, openInvoices] = await Promise.all([
    BillingDocument.find(filter).select('-contract.body -signing.business').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BillingDocument.countDocuments(filter),
    BillingDocument.aggregate<{ _id: null; balance: number }>([{ $match: open }, { $group: { _id: null, balance: { $sum: '$balance' } } }]),
    BillingDocument.countDocuments(open),
  ]);
  res.json({ success: true, data: rows, meta: { page, limit, total, outstanding: outstanding[0]?.balance ?? 0, openInvoices } });
}));

async function loadDoc(id: string) {
  if (!isValidObjectId(id)) throw notFound('Document not found');
  const d = await meta().BillingDocument.findById(id);
  if (!d) throw notFound('Document not found');
  return d as BillingDoc;
}

billingOwnerRouter.get('/documents/:id', perm, h(async (req, res) => {
  const d = await loadDoc(String(req.params.id));
  const payments = await meta().PlatformPayment.find({ documentId: d._id }).sort({ createdAt: -1 }).lean();
  let preview: string | undefined;
  if (d.type === 'contract' && d.status === 'draft') {
    const b = await getBusiness();
    preview = renderContractBody(b.contractTemplate || DEFAULT_CONTRACT_TEMPLATE, (await contractVars(d, b)).vars);
  }
  res.json({ success: true, data: { ...d.toObject(), payments, contractPreview: preview } });
}));

billingOwnerRouter.post('/documents', perm, h(async (req, res) => {
  const body = parse(docSchema, req.body);
  const { tenantId, customer: cust } = await customerFor(body.tenantId, body.customer);
  if (body.type === 'contract' && !body.contract) throw badRequest('Contract details are required');
  if (body.contract && !(await meta().SubscriptionPlan.exists({ key: body.contract.planKey }))) throw badRequest('Unknown plan');
  const business = await getBusiness();
  const totals = computeTotals(await validateLines(body.lines), business);
  const d = await meta().BillingDocument.create({
    type: body.type, number: await nextNumber(body.type as DocType), status: 'draft', tenantId, customer: cust, currency: business.currency, ...totals,
    notes: body.notes, terms: body.terms, dueDate: body.dueDate, validUntil: body.validUntil, contract: body.contract, createdBy: req.platformUser!.id,
    history: [{ at: new Date(), action: 'created', byName: req.platformUser!.name }],
  });
  await platformAudit(req, { action: `billing.${body.type}_create`, resource: 'billing_document', resourceId: String(d._id), tenantId: tenantId ? String(tenantId) : undefined, newValue: { number: d.number, total: d.total } });
  res.status(201).json({ success: true, data: d });
}));

billingOwnerRouter.patch('/documents/:id', perm, h(async (req, res) => {
  const d = await loadDoc(String(req.params.id));
  if (d.status !== 'draft') throw conflict('Issued documents cannot be edited. Void it and create a new one.', undefined, 'DOCUMENT_LOCKED');
  const body = parse(docSchema.omit({ type: true }).partial(), req.body);
  if (body.tenantId !== undefined || body.customer) {
    const c = await customerFor(body.tenantId ?? (d.tenantId ? String(d.tenantId) : undefined), body.customer);
    d.set({ tenantId: c.tenantId, customer: c.customer });
  }
  if (body.lines) d.set(computeTotals(await validateLines(body.lines), await getBusiness()));
  for (const k of ['notes', 'terms', 'dueDate', 'validUntil', 'contract'] as const) if (body[k] !== undefined) d.set(k, body[k]);
  d.history.push({ at: new Date(), action: 'edited', byName: req.platformUser!.name });
  await d.save();
  res.json({ success: true, data: d });
}));

billingOwnerRouter.post('/documents/:id/issue', perm, h(async (req, res) => {
  const d = await issueDocument(await loadDoc(String(req.params.id)), actor(req));
  await platformAudit(req, { action: `billing.${d.type}_issue`, resource: 'billing_document', resourceId: String(d._id), tenantId: d.tenantId ? String(d.tenantId) : undefined, newValue: { number: d.number, total: d.total, hash: d.signing?.hash } });
  res.json({ success: true, data: d });
}));

billingOwnerRouter.post('/documents/:id/void', perm, h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  const d = await loadDoc(String(req.params.id));
  if (['void', 'paid'].includes(d.status) || (d.amountPaid ?? 0) > 0) throw conflict('Paid or part-paid invoices cannot be voided', undefined, 'INVALID_TRANSITION');
  d.status = 'void';
  d.voidReason = reason;
  d.history.push({ at: new Date(), action: 'voided', byName: req.platformUser!.name, note: reason });
  await d.save();
  await platformAudit(req, { action: `billing.${d.type}_void`, resource: 'billing_document', resourceId: String(d._id), newValue: { number: d.number, reason } });
  res.json({ success: true, data: d });
}));

/** Quotation → invoice with the same lines (issued and signed immediately when auto-signing is on). */
export async function convertQuotation(q: BillingDoc, by: { name: string; id?: string }) {
  if (q.type !== 'quotation' || !['issued', 'accepted'].includes(q.status)) throw conflict('Only issued or accepted quotations can be converted', undefined, 'INVALID_TRANSITION');
  if (q.convertedInvoiceId) throw conflict('This quotation was already converted', { invoiceId: q.convertedInvoiceId }, 'ALREADY_CONVERTED');
  const business = await getBusiness();
  const inv = await meta().BillingDocument.create({
    type: 'invoice', number: await nextNumber('invoice'), status: 'draft', tenantId: q.tenantId, customer: q.customer, currency: q.currency,
    ...computeTotals((q.lines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, kind: l.kind as 'service', planKey: l.planKey ?? undefined, billingCycle: l.billingCycle ?? undefined, periods: l.periods ?? undefined })), business),
    notes: `Based on quotation ${q.number}.`, sourceQuotationId: q._id, createdBy: by.id,
    history: [{ at: new Date(), action: 'created_from_quotation', byName: by.name, note: q.number }],
  });
  q.convertedInvoiceId = inv._id;
  if (q.status === 'issued') q.status = 'accepted';
  q.history.push({ at: new Date(), action: 'converted', byName: by.name, note: inv.number });
  await q.save();
  const bizSigned = await currentAssets();
  if (!business.autoSign || bizSigned.signature) await issueDocument(inv as BillingDoc, by);
  return inv;
}
billingOwnerRouter.post('/documents/:id/convert', perm, h(async (req, res) => {
  const inv = await convertQuotation(await loadDoc(String(req.params.id)), actor(req));
  res.status(201).json({ success: true, data: inv });
}));

billingOwnerRouter.get('/documents/:id/pdf', perm, h(async (req, res) => {
  const d = await loadDoc(String(req.params.id));
  const pdf = await renderDocumentPdf(d);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${d.number}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}));

/** Emails the PDF to the customer (or another address). */
billingOwnerRouter.post('/documents/:id/send', perm, h(async (req, res) => {
  const { to, message } = parse(z.object({ to: z.string().trim().email().optional(), message: z.string().trim().max(2000).optional() }), req.body ?? {});
  const d = await loadDoc(String(req.params.id));
  if (d.status === 'draft') throw conflict('Issue the document before sending it', undefined, 'INVALID_TRANSITION');
  const email = to ?? d.customer?.email;
  if (!email) throw badRequest('The customer has no email address. Enter one.');
  const business = await getBusiness();
  const pdf = await renderDocumentPdf(d);
  const what = d.type === 'contract' ? 'service agreement' : d.type;
  const lines = [
    `Dear ${d.customer?.contactName || d.customer?.name},`,
    '',
    message || `Please find attached ${what} ${d.number} from ${business.companyName}.`,
    d.type === 'invoice' ? `Amount due: ${d.currency} ${(d.balance ?? 0).toFixed(2)} by ${d.dueDate ? new Date(d.dueDate).toDateString() : 'the due date'}. Use ${d.number} as the payment reference. You can also pay from AfeySync under Administration → Subscription.` : '',
    d.type !== 'invoice' && d.tenantId ? 'You can review and accept it in AfeySync under Administration → Subscription.' : '',
    '',
    `Regards,\n${business.signatoryName ?? business.companyName}${business.signatoryTitle ? `\n${business.signatoryTitle}` : ''}\n${business.companyName}`,
  ].filter((l) => l !== null);
  await enqueueJob('EMAIL', `platform:billing-send:${d._id}:${Date.now()}`, { to: email, subject: `${business.companyName} ${what} ${d.number}`, text: lines.join('\n'), attachments: [{ filename: `${d.number}.pdf`, contentBase64: pdf.toString('base64'), contentType: 'application/pdf' }] });
  d.sentAt = new Date();
  d.sentTo = email;
  d.history.push({ at: new Date(), action: 'sent', byName: req.platformUser!.name, note: email });
  await d.save();
  res.json({ success: true, data: { sentTo: email } });
}));

/* ------------------------------------------------------------------ Payments */
billingOwnerRouter.post('/documents/:id/payments', perm, h(async (req, res) => {
  const body = parse(z.object({ method: z.enum(['bank', 'cash', 'cheque', 'mpesa_c2b', 'other']), amount: z.number().positive().max(100_000_000), reference: z.string().trim().min(3).max(60), receivedAt: z.coerce.date().optional(), notes: z.string().trim().max(300).optional() }), req.body);
  const d = await loadDoc(String(req.params.id));
  if (d.type !== 'invoice' || !['issued', 'partially_paid'].includes(d.status)) throw conflict('Payments can only be recorded against issued, unpaid invoices', undefined, 'INVALID_TRANSITION');
  const receipt = body.method === 'mpesa_c2b' ? body.reference.toUpperCase() : undefined;
  if (receipt && (await meta().PlatformPayment.exists({ 'mpesa.receiptNumber': receipt }))) throw conflict('This M-Pesa receipt has already been recorded', undefined, 'DUPLICATE_RECEIPT');
  if (!receipt && (await meta().PlatformPayment.exists({ documentId: d._id, reference: body.reference, status: 'completed' }))) throw conflict('A payment with this reference is already recorded on this invoice', undefined, 'DUPLICATE_REFERENCE');
  const p = await meta().PlatformPayment.create({ documentId: d._id, tenantId: d.tenantId, method: body.method, amount: round2(body.amount), status: 'completed', reference: body.reference, receivedAt: body.receivedAt ?? new Date(), notes: body.notes, mpesa: receipt ? { receiptNumber: receipt } : undefined, recordedBy: req.platformUser!.id, recordedByName: req.platformUser!.name });
  const updated = await applyPayment(d._id, p.amount, `${body.method.replace('_', ' ')} ${body.reference}`);
  await platformAudit(req, { action: 'billing.payment_recorded', resource: 'platform_payment', resourceId: String(p._id), tenantId: d.tenantId ? String(d.tenantId) : undefined, newValue: { invoice: d.number, amount: p.amount, method: body.method, reference: body.reference } });
  res.status(201).json({ success: true, data: updated });
}));

billingOwnerRouter.post('/documents/:id/stk', perm, h(async (req, res) => {
  const { phone, amount } = parse(z.object({ phone: z.string().min(9).max(20), amount: z.number().positive().optional() }), req.body);
  const r = await requestStk(await loadDoc(String(req.params.id)), phone, req.platformUser!.name, amount);
  res.json({ success: true, data: r });
}));

billingOwnerRouter.get('/payments', perm, h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>, 200);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.unmatched === 'true') filter.documentId = null;
  const rows = await meta().PlatformPayment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const docs = await meta().BillingDocument.find({ _id: { $in: rows.map((r) => r.documentId).filter(Boolean) } }).select('number customer.name').lean();
  res.json({ success: true, data: rows.map((r) => ({ ...r, document: docs.find((d) => String(d._id) === String(r.documentId)) ?? null })), meta: { page, limit } });
}));
billingOwnerRouter.get('/payments/:id', perm, h(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const p = await refreshStk(req.params.id);
  if (!p) throw notFound();
  res.json({ success: true, data: p });
}));
/** Allocates an unmatched paybill payment to an invoice. */
billingOwnerRouter.post('/payments/:id/allocate', perm, h(async (req, res) => {
  const { documentId } = parse(z.object({ documentId: z.string() }), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound();
  const p = await meta().PlatformPayment.findById(req.params.id);
  if (!p || p.status !== 'completed' || p.documentId) throw conflict('Only completed, unallocated payments can be allocated', undefined, 'INVALID_TRANSITION');
  const d = await loadDoc(documentId);
  if (d.type !== 'invoice' || !['issued', 'partially_paid'].includes(d.status)) throw conflict('Choose an issued, unpaid invoice', undefined, 'INVALID_TRANSITION');
  p.documentId = d._id;
  p.tenantId = d.tenantId;
  p.notes = `Allocated by ${req.platformUser!.name}`;
  await p.save();
  await applyPayment(d._id, p.amount, `allocated ${p.reference}`);
  await platformAudit(req, { action: 'billing.payment_allocated', resource: 'platform_payment', resourceId: String(p._id), newValue: { invoice: d.number } });
  res.json({ success: true, data: p });
}));

billingOwnerRouter.post('/mpesa/register-c2b', requirePermission('owner.integrations'), h(async (req, res) => {
  const r = await registerCollectionsC2B();
  await platformAudit(req, { action: 'billing.mpesa_c2b_registered', resource: 'integration', resourceId: 'mpesa_billing' });
  res.json({ success: true, data: r });
}));
