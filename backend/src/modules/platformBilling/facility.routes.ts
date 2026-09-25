import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId, Types } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { meta } from '../../models/meta';
import { audit } from '../audit/auditService';
import { notifyEmail } from '../notifications/notify';
import { CORE_MODULES, MODULES, MODULE_KEYS, tenantEntitlements } from '../plans/planService';
import { publicPlans } from '../onboarding/onboarding.routes';
import { computeTotals, CYCLE_LABEL, issueDocument, nextNumber, type BillingDoc, type LineIn } from './documentService';
import { currentAssets, getBusiness } from './business';
import { renderDocumentPdf } from './pdf';
import { refreshStk, requestStk } from './platformMpesa';
import { convertQuotation } from './owner.routes';

/**
 * Facility side of the AfeySync subscription: plan and modules, usage against limits, and the
 * quotations, invoices and agreements the platform owner has issued to this facility.
 */
export const subscriptionRouter = Router();
subscriptionRouter.use(authenticateTenant);
const view = requirePermission('subscription.view');
const manage = requirePermission('subscription.manage');

const VISIBLE = { status: { $ne: 'draft' as const } };

subscriptionRouter.get('/', view, h(async (req, res) => {
  const tenantId = req.tenant!.id;
  const m = req.tenant!.models;
  const { TenantSubscription, SubscriptionPlan, BillingDocument, IntegrationConfig } = meta();
  const [ent, sub, branches, users, open, collections] = await Promise.all([
    tenantEntitlements(tenantId),
    TenantSubscription.findOne({ tenantId }).sort({ createdAt: -1 }).lean(),
    m.Branch.countDocuments({}),
    m.User.countDocuments({ status: { $ne: 'suspended' } }),
    BillingDocument.aggregate<{ _id: null; balance: number }>([{ $match: { tenantId: new Types.ObjectId(tenantId), type: 'invoice', status: { $in: ['issued', 'partially_paid'] } } }, { $group: { _id: null, balance: { $sum: '$balance' } } }]),
    IntegrationConfig.findOne({ scope: 'platform', provider: 'mpesa_billing' }).select('enabled').lean(),
  ]);
  const plan = sub ? await SubscriptionPlan.findOne({ key: sub.plan }).lean() : null;
  res.json({
    success: true,
    data: {
      subscription: sub && { plan: sub.plan, planName: plan?.name ?? sub.plan, status: sub.status, billingCycle: sub.billingCycle, amount: sub.amount, currency: sub.currency, startsAt: sub.startsAt, endsAt: sub.endsAt, maxBranches: sub.maxBranches, maxUsers: sub.maxUsers },
      usage: { branches, users },
      modules: { core: CORE_MODULES, included: ent.modules, unrestricted: ent.unrestricted, all: MODULE_KEYS.map((k) => ({ key: k, label: MODULES[k].label, description: MODULES[k].description })) },
      outstanding: open[0]?.balance ?? 0,
      mpesaAvailable: Boolean(collections?.enabled),
      plans: await publicPlans(),
    },
  });
}));

subscriptionRouter.get('/documents', view, h(async (req, res) => {
  const rows = await meta().BillingDocument.find({ tenantId: req.tenant!.id, ...VISIBLE }).select('-contract.body -signing.business').sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, data: rows });
}));

async function ownDoc(tenantId: string, id: string) {
  if (!isValidObjectId(id)) throw notFound('Document not found');
  const d = await meta().BillingDocument.findOne({ _id: id, tenantId, ...VISIBLE });
  if (!d) throw notFound('Document not found');
  return d as BillingDoc;
}

subscriptionRouter.get('/documents/:id', view, h(async (req, res) => {
  const d = await ownDoc(req.tenant!.id, String(req.params.id));
  const payments = await meta().PlatformPayment.find({ documentId: d._id }).select('method amount status reference receivedAt createdAt mpesa.resultDesc').sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { ...d.toObject(), payments } });
}));

subscriptionRouter.get('/documents/:id/pdf', view, h(async (req, res) => {
  const d = await ownDoc(req.tenant!.id, String(req.params.id));
  const pdf = await renderDocumentPdf(d);
  await audit(req, { action: 'subscription.document_download', resource: 'billing_document', resourceId: String(d._id) });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${d.number}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}));

subscriptionRouter.post('/documents/:id/pay', manage, h(async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string().min(9).max(20) }), req.body);
  const d = await ownDoc(req.tenant!.id, String(req.params.id));
  const r = await requestStk(d, phone, req.user!.name);
  await audit(req, { action: 'subscription.mpesa_prompt', resource: 'billing_document', resourceId: String(d._id), newValue: { number: d.number } });
  res.json({ success: true, data: r });
}));

subscriptionRouter.get('/payments/:id', view, h(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const p = await refreshStk(req.params.id);
  if (!p || String(p.tenantId) !== req.tenant!.id) throw notFound();
  res.json({ success: true, data: { _id: p._id, status: p.status, amount: p.amount, reference: p.reference, resultDesc: p.mpesa?.resultDesc } });
}));

/** Electronic acceptance of a quotation or agreement: records who accepted, when and from where. */
subscriptionRouter.post('/documents/:id/accept', manage, h(async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(3).max(120), title: z.string().trim().min(2).max(120), confirm: z.literal(true, { message: 'Confirm that you are authorised to accept on behalf of the facility' }) }), req.body);
  const d = await ownDoc(req.tenant!.id, String(req.params.id));
  if (!['quotation', 'contract'].includes(d.type) || d.status !== 'issued') throw conflict('Only issued quotations and agreements can be accepted', undefined, 'INVALID_TRANSITION');
  if (d.type === 'quotation' && d.validUntil && d.validUntil < new Date()) throw conflict('This quotation has expired. Request a new one.', undefined, 'QUOTATION_EXPIRED');
  d.set('acceptance', { at: new Date(), byName: body.name, byTitle: body.title, byEmail: req.user!.email, userId: req.user!.id, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 200) });
  d.status = 'accepted';
  d.history.push({ at: new Date(), action: 'accepted', byName: `${body.name} (${req.tenant!.name})` });
  await d.save();
  await audit(req, { action: `subscription.${d.type}_accept`, resource: 'billing_document', resourceId: String(d._id), newValue: { number: d.number, name: body.name, title: body.title } });
  let invoice = null;
  // An accepted quotation becomes an invoice the facility can pay straight away.
  if (d.type === 'quotation') invoice = await convertQuotation(d, { name: 'Automatic (quotation accepted)' }).catch(() => null);
  const business = await getBusiness();
  if (business.email) await notifyEmail(null, `billing-accepted:${d._id}`, business.email, `${req.tenant!.name} accepted ${d.number}`, `${body.name} (${body.title}) accepted ${d.type === 'contract' ? 'agreement' : 'quotation'} ${d.number} for ${req.tenant!.name}.${invoice ? ` Invoice ${invoice.number} was created.` : ''}`);
  res.json({ success: true, data: { document: d, invoiceId: invoice?._id ?? null } });
}));

subscriptionRouter.post('/documents/:id/decline', manage, h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const d = await ownDoc(req.tenant!.id, String(req.params.id));
  if (!['quotation', 'contract'].includes(d.type) || d.status !== 'issued') throw conflict('Only issued quotations and agreements can be declined', undefined, 'INVALID_TRANSITION');
  d.status = 'declined';
  d.history.push({ at: new Date(), action: 'declined', byName: req.user!.name, note: reason });
  await d.save();
  await audit(req, { action: `subscription.${d.type}_decline`, resource: 'billing_document', resourceId: String(d._id), newValue: { reason } });
  const business = await getBusiness();
  if (business.email) await notifyEmail(null, `billing-declined:${d._id}`, business.email, `${req.tenant!.name} declined ${d.number}`, `${req.user!.name} declined ${d.number}: ${reason}`);
  res.json({ success: true, data: d });
}));

/** Self-service upgrade or renewal: issues a signed quotation for the chosen plan and cycle. */
subscriptionRouter.post('/quote', manage, h(async (req, res) => {
  const body = parse(z.object({ planKey: z.string().max(40), billingCycle: z.enum(['monthly', 'quarterly', 'annual']), periods: z.number().int().min(1).max(12).default(1) }), req.body);
  const plan = await meta().SubscriptionPlan.findOne({ key: body.planKey, active: true, public: true }).lean();
  if (!plan) throw notFound('Plan not available');
  const price = plan.prices?.[body.billingCycle] ?? 0;
  if (!(price > 0)) throw forbidden('This plan is priced on request. Contact AfeySync for a quotation.', 'PRICE_ON_REQUEST');
  const t = await meta().Tenant.findById(req.tenant!.id).lean();
  const business = await getBusiness();
  const sub = await meta().TenantSubscription.findOne({ tenantId: req.tenant!.id }).sort({ createdAt: -1 }).lean();
  const lines: LineIn[] = [{ description: `${plan.name} plan subscription — ${body.periods} ${CYCLE_LABEL[body.billingCycle]}${body.periods > 1 ? 's' : ''}`, quantity: body.periods, unitPrice: price, kind: 'subscription', planKey: plan.key, billingCycle: body.billingCycle, periods: body.periods }];
  if ((plan.setupFee ?? 0) > 0 && (!sub || sub.status === 'trialing')) lines.push({ description: 'One-off setup and onboarding', quantity: 1, unitPrice: plan.setupFee!, kind: 'setup' });
  const q = await meta().BillingDocument.create({
    type: 'quotation', number: await nextNumber('quotation'), status: 'draft', tenantId: req.tenant!.id, currency: business.currency,
    customer: { name: t?.legalName || t?.name || req.tenant!.name, contactName: req.user!.name, email: req.user!.email, phone: t?.phone ?? undefined, address: [t?.physicalAddress, t?.county].filter(Boolean).join(', ') || undefined },
    ...computeTotals(lines, business),
    history: [{ at: new Date(), action: 'requested_by_facility', byName: req.user!.name }],
  });
  const assets = await currentAssets();
  if (!business.autoSign || assets.signature) await issueDocument(q as BillingDoc, { name: 'Automatic (self-service quotation)' });
  await audit(req, { action: 'subscription.quote_request', resource: 'billing_document', resourceId: String(q._id), newValue: { plan: plan.key, cycle: body.billingCycle, periods: body.periods } });
  res.status(201).json({ success: true, data: q });
}));
