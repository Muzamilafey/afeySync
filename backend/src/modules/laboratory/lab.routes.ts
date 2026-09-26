import { importUpload, sendXlsx } from '../imports/excel';
import { importLabTests, labTestTemplate } from '../imports/labTestImport';
import { Router, type Request } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse, parsePatch } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { accessiblePatient, shaGate } from '../frontdesk/visits.routes';
import { branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid } from '../common/helpers';
import { postCharge, voidChargeForSource } from '../billing/billingService';
import { enqueue } from '../frontdesk/queueService';
import { interpret, nextAccession, TERMINAL } from './labService';
import { notifyPatientSms, notifyStaff } from '../notifications/notify';

const router = Router();
router.use(authenticateTenant);

/* ------------------------------------------------------------ Catalog */
const rangeSchema = z.object({ sex: z.enum(['any', 'male', 'female']).default('any'), ageMinDays: z.number().int().min(0).default(0), ageMaxDays: z.number().int().max(54750).default(54750), low: z.number().optional(), high: z.number().optional(), criticalLow: z.number().optional(), criticalHigh: z.number().optional(), text: z.string().max(80).optional() });
const testSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9-_]+$/, 'can only contain letters, numbers, - and _'),
  name: z.string().min(2).max(160),
  department: z.string().max(60).default('General'),
  specimen: z.string().max(80).default('Blood'),
  container: z.string().max(60).optional(),
  turnaroundMinutes: z.number().int().min(1).max(20160).default(60),
  serviceCode: z.string().max(40).optional(),
  parameters: z.array(z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(120), unit: z.string().max(30).optional(), type: z.enum(['numeric', 'text', 'option']).default('numeric'), options: z.array(z.string().max(60)).max(20).optional(), ranges: z.array(rangeSchema).max(12).default([]) })).min(1).max(40),
  active: z.boolean().optional(),
});

router.get(
  '/tests',
  requirePermission('lab.view'),
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const filter: Record<string, unknown> = req.query.all === 'true' ? {} : { active: true };
    if (q) filter.$or = [{ code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) }, { name: new RegExp(escapeRegex(q), 'i') }];
    res.json({ success: true, data: await req.tenant!.models.LabTest.find(filter).sort({ department: 1, name: 1 }).lean() });
  }),
);

router.post(
  '/tests',
  requirePermission('lab.manage'),
  h(async (req, res) => {
    const body = parse(testSchema, req.body);
    const m = req.tenant!.models;
    if (await m.LabTest.exists({ code: body.code.toUpperCase() })) throw conflict('Test code exists');
    const t = await m.LabTest.create({ ...body, code: body.code.toUpperCase() });
    await audit(req, { action: 'lab.test_create', resource: 'lab_test', resourceId: t.code, newValue: body });
    res.status(201).json({ success: true, data: t });
  }),
);

/* Bulk import of the test catalog (tests, parameters, reference ranges, optional prices) from Excel */
router.get(
  '/tests/import-template',
  requirePermission('lab.manage'),
  h(async (req, res) => {
    sendXlsx(res, 'lab-tests-template.xlsx', await labTestTemplate(req));
  }),
);

router.post(
  '/tests/import',
  requirePermission('lab.manage'),
  importUpload,
  h(async (req, res) => {
    const commit = String(req.body?.commit ?? req.query.commit ?? '') === 'true';
    res.json({ success: true, data: await importLabTests(req, commit) });
  }),
);

router.patch(
  '/tests/:code',
  requirePermission('lab.manage'),
  h(async (req, res) => {
    const body = parsePatch(testSchema.omit({ code: true }).partial(), req.body);
    const m = req.tenant!.models;
    const t = await m.LabTest.findOne({ code: String(req.params.code).toUpperCase() });
    if (!t) throw notFound('Test not found');
    const before = t.toObject();
    t.set(body);
    await t.save();
    await audit(req, { action: 'lab.test_update', resource: 'lab_test', resourceId: t.code, oldValue: before, newValue: t.toObject() });
    res.json({ success: true, data: t });
  }),
);

/* ------------------------------------------------------------ Orders */
async function orderContext(req: Request, body: { visitId?: string; admissionId?: string; patientId?: string }) {
  const m = req.tenant!.models;
  if (body.visitId) {
    const v = await loadScoped(req, m.Visit, body.visitId, 'Visit');
    if (!['open', 'in_progress', 'admitted'].includes(v.status)) throw conflict('Visit is closed');
    return { patientId: v.patientId, branchId: v.branchId, visitId: v._id, admissionId: undefined };
  }
  if (body.admissionId) {
    const a = await loadScoped(req, m.Admission, body.admissionId, 'Admission');
    if (a.status !== 'admitted') throw conflict('Patient is not admitted');
    return { patientId: a.patientId, branchId: a.branchId, visitId: a.visitId ?? undefined, admissionId: a._id };
  }
  throw badRequest('visitId or admissionId is required');
}

/** Creates a lab order (tests and packages) on a visit or admission, charges it and queues it for the lab. */
async function createLabOrder(
  req: Request,
  ctx: { patientId: Types.ObjectId; branchId: Types.ObjectId; visitId?: Types.ObjectId | null; admissionId?: Types.ObjectId | null },
  body: { tests: string[]; packages: string[]; priority: 'routine' | 'urgent' | 'stat'; clinicalNotes?: string; source?: 'internal' | 'walk_in' | 'external'; externalRequester?: { name?: string; facility?: string; reference?: string } },
) {
  const m = req.tenant!.models;
  const pkgCodes = [...new Set(body.packages.map((c) => c.toUpperCase()))];
  const packages = pkgCodes.length ? await m.LabPackage.find({ code: { $in: pkgCodes }, active: true }).lean() : [];
  const missingPkg = pkgCodes.filter((c) => !packages.some((p) => p.code === c));
  if (missingPkg.length) throw badRequest(`Unknown lab packages: ${missingPkg.join(', ')}`);
  const inPackage = new Map<string, string>();
  for (const p of packages) for (const c of p.testCodes) if (!inPackage.has(c)) inPackage.set(c, p.code);
  const codes = [...new Set([...body.tests.map((c) => c.toUpperCase()), ...inPackage.keys()])];
  if (!codes.length) throw badRequest('Choose at least one test or package');
  if (codes.length > 60) throw badRequest('Too many tests on one request');
  const tests = await m.LabTest.find({ code: { $in: codes }, active: true }).lean();
  const missing = codes.filter((c) => !tests.some((t) => t.code === c));
  if (missing.length) throw badRequest(`Unknown lab tests: ${missing.join(', ')}`);
  const order = await m.LabOrder.create({
    orderNumber: await nextNumber(m, 'laborder', 'LO'),
    ...ctx,
    orderedBy: req.user!.id,
    orderedByName: req.user!.name,
    priority: body.priority,
    clinicalNotes: body.clinicalNotes,
    source: body.source ?? 'internal',
    externalRequester: body.externalRequester,
    packages: packages.map((p) => ({ code: p.code, name: p.name })),
    items: codes.map((c) => {
      const t = tests.find((x) => x.code === c)!;
      return { testCode: t.code, testName: t.name, specimen: t.specimen, packageCode: inPackage.get(c) };
    }),
  });
  // Tests in a package are charged once, as the package; other tests are charged one by one.
  for (const p of packages) await postCharge(req, m, { patientId: ctx.patientId, visitId: ctx.visitId, branchId: ctx.branchId, serviceCode: p.serviceCode ?? `LABPKG-${p.code}`, description: `Lab package: ${p.name}`, source: 'lab_package', sourceId: `${order._id}:${p.code}` });
  for (const item of order.items) {
    if (item.packageCode) continue;
    const t = tests.find((x) => x.code === item.testCode)!;
    await postCharge(req, m, { patientId: ctx.patientId, visitId: ctx.visitId, branchId: ctx.branchId, serviceCode: t.serviceCode ?? `LAB-${t.code}`, description: `Lab: ${t.name}`, source: 'lab', sourceId: String(item._id) });
  }
  if (ctx.visitId) await enqueue(m, { visitId: ctx.visitId, patientId: ctx.patientId, branchId: ctx.branchId, stage: 'laboratory', priority: body.priority === 'routine' ? 'normal' : 'urgent' });
  await audit(req, { action: 'lab.order', resource: 'lab_order', resourceId: String(order._id), newValue: { tests: codes, packages: pkgCodes, priority: body.priority, source: body.source, externalRequester: body.externalRequester } });
  return order;
}

const orderBody = { tests: z.array(z.string()).max(60).default([]), packages: z.array(z.string()).max(10).default([]), priority: z.enum(['routine', 'urgent', 'stat']).default('routine'), clinicalNotes: z.string().max(2000).optional() };

router.post(
  '/orders',
  requirePermission('lab.order'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ visitId: z.string().optional(), admissionId: z.string().optional(), ...orderBody }), req.body);
    const ctx = await orderContext(req, body);
    res.status(201).json({ success: true, data: await createLabOrder(req, ctx, body) });
  }),
);

/**
 * Walk-in and external lab requests: a patient comes straight to the lab (self-request or sent by an
 * outside clinician). Opens (or reuses) a lab visit, orders and charges the tests, and queues them.
 */
router.post(
  '/walk-in',
  requirePermission('lab.walkin'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        patientId: z.string(),
        payer: z.object({ type: z.enum(['cash', 'sha', 'insurance', 'corporate']).default('cash'), scheme: z.string().max(80).optional(), memberNumber: z.string().max(60).optional() }).default({ type: 'cash' }),
        externalRequester: z.object({ name: z.string().trim().max(120).optional(), facility: z.string().trim().max(160).optional(), reference: z.string().trim().max(60).optional() }).optional(),
        ...orderBody,
      }),
      req.body,
    );
    const m = req.tenant!.models;
    const patient = await accessiblePatient(req, body.patientId);
    let visit = await m.Visit.findOne({ patientId: patient._id, branchId: req.branch!.id, status: { $in: ['open', 'in_progress'] } });
    if (!visit) {
      const shaCheckId = body.payer.type === 'sha' ? await shaGate(req, patient) : undefined;
      visit = await m.Visit.create({
        visitNumber: await nextNumber(m, 'visit', 'V'),
        patientId: patient._id,
        branchId: req.branch!.id,
        type: 'walk_in_lab',
        payer: { ...body.payer, shaEligibilityCheckId: shaCheckId as never },
        department: 'Laboratory',
        complaint: body.clinicalNotes,
        referralIn: body.externalRequester?.name || body.externalRequester?.facility ? { from: [body.externalRequester.name, body.externalRequester.facility].filter(Boolean).join(', '), referenceNumber: body.externalRequester.reference } : undefined,
        createdBy: req.user!.id,
      });
      if (!patient.branchIds.some((b) => String(b) === req.branch!.id)) {
        patient.branchIds.push(req.branch!.id as never);
        await patient.save();
      }
      await audit(req, { action: 'visit.create', resource: 'visit', resourceId: String(visit._id), newValue: { visitNumber: visit.visitNumber, type: 'walk_in_lab', payer: body.payer.type } });
    }
    const external = !!(body.externalRequester?.name || body.externalRequester?.facility);
    const order = await createLabOrder(req, { patientId: patient._id, branchId: visit.branchId, visitId: visit._id }, { ...body, source: external ? 'external' : 'walk_in' });
    res.status(201).json({ success: true, data: { order, visit: { _id: visit._id, visitNumber: visit.visitNumber } } });
  }),
);

/* ------------------------------------------------------------ Packages */
const packageSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-_]+$/, 'can only contain letters, numbers, - and _'),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  testCodes: z.array(z.string().trim().min(1).max(30)).min(2, 'A package needs at least two tests').max(40),
  active: z.boolean().default(true),
  /** The package price on each price list; needs billing.prices. */
  prices: z.record(z.string().max(30), z.number().min(0).max(10_000_000)).optional(),
});

router.get(
  '/packages',
  requireAnyPermission('lab.view', 'lab.order', 'lab.walkin'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const pkgs = await m.LabPackage.find(req.query.all === 'true' ? {} : { active: true }).sort({ name: 1 }).lean();
    const services = await m.ServiceItem.find({ code: { $in: pkgs.map((p) => p.serviceCode ?? `LABPKG-${p.code}`) } }).select('code prices').lean();
    const tests = await m.LabTest.find({ code: { $in: pkgs.flatMap((p) => p.testCodes) } }).select('code name serviceCode').lean();
    const testServices = await m.ServiceItem.find({ code: { $in: tests.map((t) => t.serviceCode ?? `LAB-${t.code}`) } }).select('code prices').lean();
    const cash = (code: string, list: typeof services) => list.find((sv) => sv.code === code)?.prices.find((p) => p.priceList === 'cash')?.amount;
    res.json({
      success: true,
      data: pkgs.map((p) => {
        const code = p.serviceCode ?? `LABPKG-${p.code}`;
        const separately = p.testCodes.reduce((sum, c) => { const t = tests.find((x) => x.code === c); return sum + (t ? cash(t.serviceCode ?? `LAB-${t.code}`, testServices) ?? 0 : 0); }, 0);
        return { ...p, serviceCode: code, prices: Object.fromEntries((services.find((sv) => sv.code === code)?.prices ?? []).map((x) => [x.priceList, x.amount])), tests: p.testCodes.map((c) => ({ code: c, name: tests.find((t) => t.code === c)?.name ?? c })), priceIfSeparate: separately };
      }),
    });
  }),
);

async function savePackagePrices(req: Request, pkg: { code: string; name: string; serviceCode?: string | null }, prices?: Record<string, number>) {
  if (!prices || !Object.keys(prices).length) return;
  if (!req.user!.permissions.has('billing.prices')) throw forbidden('Only users who manage prices (billing.prices) can set package prices');
  const m = req.tenant!.models;
  const code = (pkg.serviceCode ?? `LABPKG-${pkg.code}`).toUpperCase();
  const svc = (await m.ServiceItem.findOne({ code })) ?? new m.ServiceItem({ code, name: `Lab package: ${pkg.name}`, category: 'laboratory', prices: [] });
  for (const [priceList, amount] of Object.entries(prices)) {
    const existing = svc.prices.find((p) => p.priceList === priceList);
    if (existing) existing.amount = amount;
    else svc.prices.push({ priceList, amount } as never);
  }
  svc.name = `Lab package: ${pkg.name}`;
  await svc.save();
  await audit(req, { action: 'billing.price_update', resource: 'service_item', resourceId: code, newValue: prices });
}

router.post(
  '/packages',
  requirePermission('lab.manage'),
  h(async (req, res) => {
    const body = parse(packageSchema, req.body);
    const m = req.tenant!.models;
    const code = body.code.toUpperCase();
    if (await m.LabPackage.exists({ code })) throw conflict('A package with this code exists');
    const testCodes = [...new Set(body.testCodes.map((c) => c.toUpperCase()))];
    const found = await m.LabTest.countDocuments({ code: { $in: testCodes } });
    if (found !== testCodes.length) throw badRequest('Some tests in the package do not exist');
    const { prices, ...fields } = body;
    const pkg = await m.LabPackage.create({ ...fields, code, testCodes, serviceCode: `LABPKG-${code}` });
    await savePackagePrices(req, pkg, prices);
    await audit(req, { action: 'lab.package_create', resource: 'lab_package', resourceId: code, newValue: fields });
    res.status(201).json({ success: true, data: pkg });
  }),
);

router.patch(
  '/packages/:code',
  requirePermission('lab.manage'),
  h(async (req, res) => {
    const body = parse(packageSchema.omit({ code: true }).partial(), req.body);
    const m = req.tenant!.models;
    const pkg = await m.LabPackage.findOne({ code: String(req.params.code).toUpperCase() });
    if (!pkg) throw notFound('Package not found');
    const { prices, ...fields } = body;
    if (fields.testCodes) {
      fields.testCodes = [...new Set(fields.testCodes.map((c) => c.toUpperCase()))];
      if ((await m.LabTest.countDocuments({ code: { $in: fields.testCodes } })) !== fields.testCodes.length) throw badRequest('Some tests in the package do not exist');
    }
    pkg.set(fields);
    await pkg.save();
    await savePackagePrices(req, pkg, prices);
    await audit(req, { action: 'lab.package_update', resource: 'lab_package', resourceId: pkg.code, newValue: body });
    res.json({ success: true, data: pkg });
  }),
);

router.get(
  '/orders',
  requirePermission('lab.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = { ...branchFilter(req) };
    if (req.query.visitId) filter.visitId = oid(req.query.visitId, 'Visit');
    if (req.query.admissionId) filter.admissionId = oid(req.query.admissionId, 'Admission');
    if (req.query.patientId) filter.patientId = oid(req.query.patientId, 'Patient');
    if (req.query.itemStatus) filter['items.status'] = { $in: String(req.query.itemStatus).split(',') };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.accession) filter['items.accessionNumber'] = String(req.query.accession).toUpperCase();
    const [items, total] = await Promise.all([
      m.LabOrder.find(filter).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth').sort({ priority: -1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      m.LabOrder.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.get(
  '/orders/:id',
  requirePermission('lab.view'),
  h(async (req, res) => {
    const o = await loadScoped(req, req.tenant!.models.LabOrder, req.params.id, 'Lab order');
    const patient = await req.tenant!.models.Patient.findById(o.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth').lean();
    res.json({ success: true, data: { ...o.toObject(), patient } });
  }),
);

/** Released results only: the patient-facing / clinician report. */
router.get(
  '/orders/:id/report',
  requirePermission('lab.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const o = await loadScoped(req, m.LabOrder, req.params.id, 'Lab order');
    const [patient, branch] = await Promise.all([m.Patient.findById(o.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth').lean(), m.Branch.findById(o.branchId).select('branchName phone physicalAddress').lean()]);
    await audit(req, { action: 'lab.report_view', resource: 'lab_order', resourceId: String(o._id) });
    res.json({ success: true, data: { orderNumber: o.orderNumber, orderedByName: o.orderedByName, source: o.source, externalRequester: o.externalRequester, createdAt: o.createdAt, priority: o.priority, clinicalNotes: o.clinicalNotes, items: o.items.filter((i) => i.status === 'released'), pending: o.items.filter((i) => !TERMINAL.includes(i.status)).map((i) => i.testName), patient, branch, facility: req.tenant!.name } });
  }),
);

/* ------------------------------------------------------------ Item workflow */
const STEPS: Record<string, { perm: string; from: string[]; to: string }> = {
  collect: { perm: 'lab.sample', from: ['ordered', 'rejected'], to: 'collected' },
  receive: { perm: 'lab.sample', from: ['collected'], to: 'received' },
  process: { perm: 'lab.result', from: ['received'], to: 'processing' },
  result: { perm: 'lab.result', from: ['received', 'processing', 'resulted'], to: 'resulted' },
  verify: { perm: 'lab.verify', from: ['resulted'], to: 'verified' },
  approve: { perm: 'lab.approve', from: ['verified'], to: 'released' },
  reject: { perm: 'lab.sample', from: ['collected', 'received', 'processing'], to: 'rejected' },
  cancel: { perm: 'lab.order', from: ['ordered', 'collected', 'received'], to: 'cancelled' },
  amend: { perm: 'lab.approve', from: ['released'], to: 'resulted' },
};

router.post(
  '/orders/:id/items/:itemId/:step',
  h(async (req, res) => {
    const stepName = String(req.params.step);
    const step = STEPS[stepName];
    if (!step) throw notFound();
    if (!req.permissions!.has(step.perm)) throw forbidden(`Missing permission: ${step.perm}`);
    const body = parse(
      z.object({ results: z.array(z.object({ parameter: z.string(), value: z.string().max(500) })).max(60).optional(), comment: z.string().max(2000).optional(), reason: z.string().max(300).optional() }),
      req.body ?? {},
    );
    const m = req.tenant!.models;
    const order = await loadScoped(req, m.LabOrder, req.params.id, 'Lab order');
    const item = order.items.id(oid(req.params.itemId, 'Item'));
    if (!item) throw notFound('Test not found on order');
    if (!step.from.includes(item.status)) throw conflict(`Cannot ${stepName} a test that is ${item.status}`, undefined, 'INVALID_LAB_TRANSITION');
    const now = new Date();
    const me = req.user!;
    let critical = false;

    switch (stepName) {
      case 'collect':
        item.accessionNumber = await nextAccession(m, 'L');
        item.collectedAt = now;
        item.collectedBy = me.id as never;
        item.rejectionReason = undefined;
        break;
      case 'receive':
        item.receivedAt = now;
        item.receivedBy = me.id as never;
        break;
      case 'process':
        item.processingAt = now;
        break;
      case 'result': {
        if (!body.results?.length) throw badRequest('Results are required');
        const test = await m.LabTest.findOne({ code: item.testCode }).lean();
        const patient = await m.Patient.findById(order.patientId).select('gender dateOfBirth').lean();
        item.results = test!.parameters
          .map((p) => {
            const v = body.results!.find((r) => r.parameter === p.code);
            if (!v) return null;
            const r = interpret(p as never, v.value, patient?.gender, patient?.dateOfBirth);
            critical = critical || r.critical;
            return { parameter: p.code, name: p.name, unit: p.unit, ...r };
          })
          .filter(Boolean) as never;
        if (!item.results.length) throw badRequest('No results match the test parameters');
        item.comment = body.comment;
        item.critical = critical;
        item.resultedAt = now;
        item.resultedBy = me.id as never;
        item.resultedByName = me.name;
        break;
      }
      case 'verify':
        // Segregation of duties: a second person verifies what was entered.
        if (String(item.resultedBy) === me.id) throw forbidden('Results must be verified by a different person than the one who entered them', 'SEGREGATION_OF_DUTIES');
        item.verifiedAt = now;
        item.verifiedBy = me.id as never;
        item.verifiedByName = me.name;
        break;
      case 'approve':
        item.approvedAt = now;
        item.approvedBy = me.id as never;
        item.approvedByName = me.name;
        item.releasedAt = now;
        break;
      case 'reject':
      case 'cancel':
        if (!body.reason) throw badRequest('A reason is required');
        item.rejectionReason = body.reason;
        if (stepName === 'cancel') await voidChargeForSource(m, 'lab', String(item._id), `Lab test cancelled: ${body.reason}`, me.id);
        break;
      case 'amend':
        if (!body.reason) throw badRequest('A reason is required to amend released results');
        item.comment = `${item.comment ?? ''}\n[Amendment requested ${now.toISOString()} by ${me.name}: ${body.reason}]`.trim();
        item.verifiedAt = undefined;
        item.approvedAt = undefined;
        item.releasedAt = undefined;
        break;
    }
    item.status = step.to as never;
    if (order.items.every((i) => TERMINAL.includes(i.status))) order.status = order.items.every((i) => i.status === 'cancelled') ? 'cancelled' : 'completed';
    else order.status = 'open';
    await order.save();

    // Critical values are escalated to the ordering clinician immediately (before verification).
    if (stepName === 'result' && critical && !item.criticalNotifiedAt) {
      await notifyStaff(m, [order.orderedBy], { event: 'Lab Result', title: `CRITICAL: ${item.testName} (${order.orderNumber})`, body: item.results.filter((r) => r.critical).map((r) => `${r.name} ${r.value} ${r.unit ?? ''}`).join('; '), link: order.visitId ? `/visits/${order.visitId}?tab=orders` : `/laboratory/orders/${order._id}`, branchId: String(order.branchId) });
      item.criticalNotifiedAt = now;
      await order.save();
    }
    if (stepName === 'approve') {
      await notifyStaff(m, [order.orderedBy], { event: 'Lab Result', title: `Results ready: ${item.testName}`, body: order.orderNumber, link: order.visitId ? `/visits/${order.visitId}?tab=orders` : `/laboratory/orders/${order._id}`, branchId: String(order.branchId) });
      if (order.status === 'completed') {
        const patient = await m.Patient.findById(order.patientId).select('phone consent').lean();
        if (patient) await notifyPatientSms(req.tenant!, patient, `lab:${order._id}:ready`, `Your laboratory results (${order.orderNumber}) are ready. Please see your clinician.`);
      }
    }
    await audit(req, { action: `lab.${stepName}`, resource: 'lab_order', resourceId: String(order._id), newValue: { test: item.testCode, status: item.status, accession: item.accessionNumber, critical: item.critical, reason: body.reason } });
    res.json({ success: true, data: order });
  }),
);

/** Specimen label lookup by barcode/accession number. */
router.get(
  '/accession/:accession',
  requirePermission('lab.view'),
  h(async (req, res) => {
    const acc = String(req.params.accession).toUpperCase();
    const o = await req.tenant!.models.LabOrder.findOne({ 'items.accessionNumber': acc, ...branchFilter(req) }).populate('patientId', 'patientNumber firstName lastName gender dateOfBirth').lean();
    if (!o) throw notFound('Accession not found');
    res.json({ success: true, data: { order: o, item: o.items.find((i) => i.accessionNumber === acc) } });
  }),
);

export default router;
export { AppError };
