import { Router, type Request, type Response } from 'express';
import { h } from '../../utils/asyncHandler';
import { pagination } from '../../utils/validate';
import { forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { canAccessAnyBranch, branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { oid } from '../common/helpers';
import { meta } from '../../models/meta';
import { enqueueJob } from '../../jobs/queue';
import { fhirConfig } from './outbox';
import * as M from './mappers';
import { validateResource } from './validator';

const router = Router();
router.use(authenticateTenant);

const send = (res: Response, body: unknown) => res.type('application/fhir+json').send(JSON.stringify(body));

async function patient(req: Request, id: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(id, 'Patient')).lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}

router.get('/metadata', (req, res) => {
  send(res, {
    resourceType: 'CapabilityStatement', status: 'active', date: new Date().toISOString(), kind: 'instance', fhirVersion: '4.0.1', format: ['application/fhir+json'],
    software: { name: 'AfeySync', version: '1.0.0' },
    rest: [{ mode: 'server', resource: ['Patient', 'Encounter', 'Condition', 'Observation', 'ServiceRequest', 'Procedure', 'DocumentReference', 'Practitioner', 'PractitionerRole', 'Organization', 'Location', 'RelatedPerson', 'Consent', 'EpisodeOfCare', 'Task'].map((type) => ({ type, interaction: [{ code: 'read' }, { code: 'search-type' }] })) }],
  });
});

router.get('/Patient/:id', requireAnyPermission('patients.view', 'dha.fhir'), h(async (req, res) => {
  const p = await patient(req, req.params.id);
  await audit(req, { action: 'fhir.read', resource: 'Patient', resourceId: String(p._id) });
  send(res, M.toPatient(await fhirConfig(req.tenant!.models, req.tenant!.slug), p as never));
}));

/** Patient summary bundle: demographics, encounters, conditions, observations, orders, documents, consent. */
router.get('/Patient/:id/\\$everything', requirePermission('patients.view'), requireAnyPermission('consultation.view', 'dha.fhir'), h(async (req, res) => {
  const m = req.tenant!.models;
  const p = await patient(req, req.params.id);
  const cfg = await fhirConfig(m, req.tenant!.slug);
  const [visits, cons, vitals, labs, rads, procs, docs, preg] = await Promise.all([
    m.Visit.find({ patientId: p._id }).sort({ createdAt: -1 }).limit(100).lean(),
    m.Consultation.find({ patientId: p._id, status: 'final' }).lean(),
    m.Vitals.find({ patientId: p._id }).sort({ recordedAt: -1 }).limit(200).lean(),
    m.LabOrder.find({ patientId: p._id }).lean(),
    m.RadiologyRequest.find({ patientId: p._id }).lean(),
    m.Procedure.find({ patientId: p._id }).lean(),
    m.Document.find({ patientId: p._id, deletedAt: null }).lean(),
    m.Pregnancy.find({ patientId: p._id }).lean(),
  ]);
  const resources = [
    M.toPatient(cfg, p as never), ...M.toRelatedPersons(cfg, p as never), M.toConsent(cfg, p as never),
    ...visits.map((v) => M.toEncounter(cfg, v as never)), ...cons.flatMap((c) => M.toConditions(cfg, c as never)),
    ...vitals.flatMap((v) => M.toObservations(cfg, v as never)), ...labs.flatMap((l) => [...M.toServiceRequests(cfg, 'lab', l as never), ...M.toLabObservations(cfg, l as never)]),
    ...rads.flatMap((r) => M.toServiceRequests(cfg, 'imaging', r as never)), ...procs.map((x) => M.toProcedure(cfg, x as never)),
    ...docs.map((d) => M.toDocumentReference(cfg, d as never, `/api/v1/documents/${d._id}/download`)), ...preg.map((x) => M.toEpisodeOfCare(cfg, x as never)),
  ];
  await audit(req, { action: 'fhir.everything', resource: 'Patient', resourceId: String(p._id), newValue: { resources: resources.length } });
  send(res, M.bundle('searchset', resources as never, cfg));
}));

router.get('/Encounter/:id', requireAnyPermission('consultation.view', 'dha.fhir'), h(async (req, res) => {
  const v = await req.tenant!.models.Visit.findById(oid(req.params.id, 'Encounter')).lean();
  if (!v || !(req.user!.branchAccess === 'all' || req.user!.branchIds.includes(String(v.branchId)))) throw notFound('Encounter not found');
  send(res, M.toEncounter(await fhirConfig(req.tenant!.models, req.tenant!.slug), v as never, { locationId: v.branchId }));
}));

router.get('/Practitioner/:id', requireAnyPermission('admin.users', 'dha.fhir', 'hr.view'), h(async (req, res) => {
  const u = await req.tenant!.models.User.findById(oid(req.params.id, 'Practitioner')).lean();
  if (!u) throw notFound('Practitioner not found');
  send(res, M.toPractitioner(await fhirConfig(req.tenant!.models, req.tenant!.slug), u as never));
}));

router.get('/Organization', requireAnyPermission('dha.fhir', 'admin.settings'), h(async (req, res) => {
  const t = await meta().Tenant.findById(req.tenant!.id).lean();
  send(res, M.toOrganization(await fhirConfig(req.tenant!.models, req.tenant!.slug), { id: req.tenant!.id, name: t!.name, facilityCode: t!.facilityCode, registryCode: t!.dhaRegistry?.facilityRegistryCode, phone: t!.phone, email: t!.email }));
}));

router.get('/Location', requireAnyPermission('dha.fhir', 'admin.settings'), h(async (req, res) => {
  const cfg = await fhirConfig(req.tenant!.models, req.tenant!.slug);
  const branches = await req.tenant!.models.Branch.find(req.user!.branchAccess === 'all' ? {} : { _id: { $in: req.user!.branchIds } }).lean();
  send(res, M.bundle('searchset', branches.map((b) => M.toLocation(cfg, b as never, req.tenant!.id)) as never, cfg));
}));

/* ------------------------------------------------------------ Outbox / sync */
router.get('/outbox', requirePermission('dha.fhir'), h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  const m = req.tenant!.models;
  const [items, total, counts] = await Promise.all([m.FhirOutbox.find(filter).select('-payload').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.FhirOutbox.countDocuments(filter), m.FhirOutbox.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])]);
  res.json({ success: true, data: items, meta: { page, limit, total, counts: Object.fromEntries(counts.map((c) => [c._id, c.count])) } });
}));

router.get('/outbox/:id', requirePermission('dha.fhir'), h(async (req, res) => {
  const e = await req.tenant!.models.FhirOutbox.findById(oid(req.params.id, 'Outbox entry')).lean();
  if (!e) throw notFound();
  await audit(req, { action: 'fhir.outbox_view', resource: 'fhir_outbox', resourceId: String(e._id) });
  res.json({ success: true, data: e });
}));

router.post('/outbox/:id/retry', requirePermission('dha.fhir'), h(async (req, res) => {
  const m = req.tenant!.models;
  const e = await m.FhirOutbox.findById(oid(req.params.id, 'Outbox entry'));
  if (!e) throw notFound();
  if (!['failed', 'blocked'].includes(e.status)) throw forbidden('Only failed or blocked entries can be retried');
  const errors = validateResource(e.payload as never);
  e.validation = { valid: !errors.length, errors } as never;
  if (errors.length) {
    await e.save();
    return res.status(422).json({ success: false, error: { code: 'FHIR_VALIDATION_ERROR', message: 'Payload still fails validation', details: errors.slice(0, 20) } });
  }
  e.status = 'queued';
  e.lastError = undefined;
  await e.save();
  const job = await meta().Job.findOne({ idempotencyKey: `FHIR_SYNC:${req.tenant!.id}:${e.idempotencyKey}` });
  if (job) {
    job.status = 'queued';
    job.attempts = 0;
    job.runAt = new Date();
    await job.save();
  } else await enqueueJob('FHIR_SYNC', `${req.tenant!.id}:${e.idempotencyKey}`, { outboxId: String(e._id) }, req.tenant!.id);
  await audit(req, { action: 'fhir.outbox_retry', resource: 'fhir_outbox', resourceId: String(e._id) });
  res.json({ success: true });
}));

export default router;
export { branchFilter };
