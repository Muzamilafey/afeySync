import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import crypto from 'node:crypto';
import { h } from '../../utils/asyncHandler';
import { pagination, parse, parsePatch } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { IDENTIFICATION_TYPES } from '../../models/tenant';
import { buildSearchFilter, findDuplicates, nextPatientNumber, normalizePhone, patientSummaryFields } from './patientService';
import { DHAClientRegistryService, HIE_IDENTIFICATION_TYPES } from '../../integrations/hie/services';
import { refreshTenantStats } from '../tenants/provisioning';
import type { Request } from 'express';

const router = Router();
router.use(authenticateTenant);

const oid = (id: string) => {
  if (!isValidObjectId(id)) throw notFound('Patient not found');
  return id;
};

async function loadAccessiblePatient(req: Request, id: string) {
  const p = await req.tenant!.models.Patient.findById(oid(id));
  if (!p) throw notFound('Patient not found');
  if (!canAccessAnyBranch(req, p.branchIds ?? [])) throw forbidden('This patient is not registered in your branch', 'BRANCH_FORBIDDEN');
  return p;
}

const identifier = z.object({ type: z.enum(IDENTIFICATION_TYPES), value: z.string().trim().min(2).max(60) });

const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60),
  gender: z.enum(['male', 'female', 'other', 'unknown']),
  dateOfBirth: z.coerce.date().refine((d) => d.getTime() <= Date.now(), 'Date of birth cannot be in the future').optional(),
  dobEstimated: z.boolean().optional(),
  maritalStatus: z.string().max(30).optional(),
  occupation: z.string().max(80).optional(),
  nationality: z.string().max(60).optional(),
  phone: z.string().max(20).optional(),
  altPhone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  nationalId: z.string().trim().regex(/^\d{5,10}$/, 'National ID must be digits').optional().or(z.literal('')),
  clientRegistryId: z.string().trim().max(40).optional().or(z.literal('')),
  shaNumber: z.string().trim().max(40).optional().or(z.literal('')),
  identifiers: z.array(identifier).max(10).default([]),
  address: z.object({ county: z.string().max(60), subCounty: z.string().max(60), ward: z.string().max(60), village: z.string().max(100), physicalAddress: z.string().max(200) }).partial().optional(),
  nextOfKin: z.array(z.object({ name: z.string().max(120), relationship: z.string().max(40), phone: z.string().max(20).optional(), idNumber: z.string().max(20).optional() })).max(5).optional(),
  insurance: z.array(z.object({ provider: z.string().max(80), scheme: z.string().max(80).optional(), memberNumber: z.string().max(40), principalName: z.string().max(120).optional(), relationship: z.string().max(40).optional(), validTo: z.coerce.date().optional() })).max(5).optional(),
  consent: z.object({ dataSharing: z.boolean(), sms: z.boolean() }).partial().optional(),
  allergies: z.array(z.object({ substance: z.string().max(80), reaction: z.string().max(120).optional(), severity: z.string().max(20).optional() })).max(30).optional(),
});

/* -------- Search: one of the fastest paths in the system (indexed, projected, capped) */
router.get(
  '/search',
  requirePermission('patients.search'),
  h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const { Patient, Branch } = req.tenant!.models;
    const filter: Record<string, unknown> = { ...buildSearchFilter(q), status: { $ne: 'merged' }, walkInAccount: { $ne: true }, ...branchFilter(req, 'branchIds') };
    const items = await Patient.find(filter).select(patientSummaryFields).sort({ updatedAt: -1 }).limit(Math.min(50, Number(req.query.limit) || 20)).lean();
    const branches = await Branch.find({ _id: { $in: [...new Set(items.map((i) => String(i.registeredBranchId)))] } }).select('branchName').lean();
    res.json({
      success: true,
      data: items.map((p) => ({ ...p, registeredBranchName: branches.find((b) => String(b._id) === String(p.registeredBranchId))?.branchName })),
    });
  }),
);

router.get(
  '/',
  requirePermission('patients.view'),
  h(async (req, res) => {
    const { Patient } = req.tenant!.models;
    const { page, limit, skip } = pagination(req.query);
    const filter: Record<string, unknown> = { status: { $ne: 'merged' }, walkInAccount: { $ne: true }, ...branchFilter(req, 'branchIds') };
    const [items, total] = await Promise.all([Patient.find(filter).select(patientSummaryFields).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Patient.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

router.post(
  '/duplicate-check',
  requireAnyPermission('patients.create', 'patients.search'),
  h(async (req, res) => {
    const body = parse(z.object({ nationalId: z.string().optional(), clientRegistryId: z.string().optional(), shaNumber: z.string().optional(), identifiers: z.array(identifier).default([]) }), req.body);
    res.json({ success: true, data: await findDuplicates(req, body) });
  }),
);

/* -------- Create new (local) patient */
router.post(
  '/',
  requirePermission('patients.create'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(patientSchema, req.body);
    const { Patient } = req.tenant!.models;
    const dupes = await findDuplicates(req, body);
    if (dupes.length) throw conflict('PATIENT ALREADY EXISTS', dupes, 'PATIENT_EXISTS');
    const patient = new Patient({
      ...body,
      email: body.email || undefined,
      nationalId: body.nationalId || undefined,
      clientRegistryId: body.clientRegistryId || undefined,
      shaNumber: body.shaNumber || undefined,
      phone: normalizePhone(body.phone),
      altPhone: normalizePhone(body.altPhone),
      patientNumber: await nextPatientNumber(req.tenant!.models),
      registeredBranchId: req.branch!.id,
      branchIds: [req.branch!.id],
      consent: { ...body.consent, capturedAt: new Date(), capturedBy: req.user!.id },
      dha: { source: 'local' },
      createdBy: req.user!.id,
    });
    await patient.save();
    await audit(req, { action: 'patient.create', resource: 'patient', resourceId: String(patient._id), newValue: { patientNumber: patient.patientNumber } });
    refreshTenantStats(req.tenant!.id, req.tenant!.models).catch(() => undefined);
    res.status(201).json({ success: true, data: patient });
  }),
);

/* -------- Import from DHA Client Registry. The server re-queries the registry: client-supplied
            demographics are never trusted as "national" data. */
router.post(
  '/import-dha',
  requirePermission('patients.create'),
  requirePermission('dha.registry'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(
      z.object({
        identificationType: z.enum(HIE_IDENTIFICATION_TYPES),
        identificationNumber: z.string().trim().min(3).max(40),
        resultIndex: z.number().int().min(0).max(20).default(0),
        phone: z.string().max(20).optional(),
        email: z.string().email().optional().or(z.literal('')),
        nextOfKin: patientSchema.shape.nextOfKin,
        consent: patientSchema.shape.consent,
      }),
      req.body,
    );
    const ctx = { tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch!.id, requestId: req.requestId };
    const result = await DHAClientRegistryService.search(ctx, body.identificationType, body.identificationNumber);
    const rec = result.results[body.resultIndex];
    if (!rec) throw notFound('No DHA Client Registry record found for this identifier', 'DHA_NOT_FOUND');
    if (!rec.firstName && !rec.fullName) throw new AppError(422, 'DHA_RECORD_INCOMPLETE', 'The registry record has no name and cannot be imported automatically');

    const identifiers = [...rec.identifiers.filter((i) => (IDENTIFICATION_TYPES as readonly string[]).includes(i.type))];
    if (!identifiers.some((i) => i.type === body.identificationType && i.value === body.identificationNumber)) identifiers.push({ type: body.identificationType, value: body.identificationNumber });
    if (rec.clientRegistryId && !identifiers.some((i) => i.type === 'ClientRegistry ID')) identifiers.push({ type: 'ClientRegistry ID', value: rec.clientRegistryId });
    const nationalId = rec.nationalId ?? (body.identificationType === 'National ID' ? body.identificationNumber : undefined);

    const dupes = await findDuplicates(req, { nationalId, clientRegistryId: rec.clientRegistryId, identifiers });
    if (dupes.length) throw conflict('PATIENT ALREADY EXISTS', dupes, 'PATIENT_EXISTS');

    const names = (rec.fullName ?? '').split(/\s+/).filter(Boolean);
    const g = (rec.gender ?? '').toLowerCase();
    const { Patient } = req.tenant!.models;
    const patient = new Patient({
      patientNumber: await nextPatientNumber(req.tenant!.models),
      firstName: rec.firstName ?? names[0],
      middleName: rec.middleName ?? (names.length > 2 ? names.slice(1, -1).join(' ') : undefined),
      lastName: rec.lastName ?? names[names.length - 1] ?? '-',
      gender: g.startsWith('m') ? 'male' : g.startsWith('f') ? 'female' : g ? 'other' : 'unknown',
      dateOfBirth: rec.dateOfBirth && !Number.isNaN(Date.parse(rec.dateOfBirth)) ? new Date(rec.dateOfBirth) : undefined,
      phone: normalizePhone(body.phone || rec.phone),
      email: body.email || rec.email,
      nationalId,
      clientRegistryId: rec.clientRegistryId,
      shaNumber: rec.shaNumber,
      identifiers: identifiers.map((i) => ({ ...i, source: 'dha' })),
      address: { county: rec.county, subCounty: rec.subCounty, ward: rec.ward },
      nextOfKin: body.nextOfKin,
      registeredBranchId: req.branch!.id,
      branchIds: [req.branch!.id],
      consent: { ...body.consent, capturedAt: new Date(), capturedBy: req.user!.id },
      dha: { source: 'client_registry', importedAt: new Date(), lastSyncedAt: new Date(), snapshotHash: crypto.createHash('sha256').update(JSON.stringify(rec.raw)).digest('hex') },
      createdBy: req.user!.id,
    });
    await patient.save();
    await audit(req, { action: 'patient.import_dha', resource: 'patient', resourceId: String(patient._id), newValue: { patientNumber: patient.patientNumber, clientRegistryId: rec.clientRegistryId, identificationType: body.identificationType } });
    refreshTenantStats(req.tenant!.id, req.tenant!.models).catch(() => undefined);
    res.status(201).json({ success: true, data: patient });
  }),
);

router.get(
  '/:id',
  requirePermission('patients.view'),
  h(async (req, res) => {
    const p = await loadAccessiblePatient(req, req.params.id as string);
    const { Branch, ShaEligibilityCheck } = req.tenant!.models;
    const [branches, lastEligibility] = await Promise.all([
      Branch.find({ _id: { $in: p.branchIds } }).select('branchName branchCode').lean(),
      ShaEligibilityCheck.findOne({ patientId: p._id }).sort({ createdAt: -1 }).select('-raw').lean(),
    ]);
    await audit(req, { action: 'patient.view', resource: 'patient', resourceId: String(p._id) });
    res.json({ success: true, data: { ...p.toObject(), branches, lastEligibility } });
  }),
);

router.patch(
  '/:id',
  requirePermission('patients.edit'),
  h(async (req, res) => {
    const p = await loadAccessiblePatient(req, req.params.id as string);
    const body = parsePatch(patientSchema.partial(), req.body) as Record<string, unknown>;
    // A blanked optional field clears it (stored as absent, not as an empty string that could collide).
    for (const k of ['middleName', 'maritalStatus', 'occupation', 'nationality', 'phone', 'altPhone', 'email', 'nationalId', 'clientRegistryId', 'shaNumber'] as const) {
      if (body[k] === '') body[k] = undefined;
    }
    if (p.dha?.source === 'client_registry') {
      if (body.clientRegistryId !== undefined && body.clientRegistryId !== p.clientRegistryId) throw forbidden('The Client Registry ID of an imported patient cannot be changed manually');
      // Names and date of birth come from the DHA Client Registry; they are corrected there, not overwritten here.
      const sameDate = (a: unknown, b: unknown) => (a ? new Date(a as Date).toISOString().slice(0, 10) : '') === (b ? new Date(b as Date).toISOString().slice(0, 10) : '');
      const locked = (['firstName', 'middleName', 'lastName'] as const).filter((k) => k in body && (body[k] ?? '') !== (p[k] ?? ''));
      if ('dateOfBirth' in body && !sameDate(body.dateOfBirth, p.dateOfBirth)) locked.push('dateOfBirth' as never);
      if (locked.length) throw forbidden('Names and date of birth of a patient imported from the DHA Client Registry cannot be changed here', 'REGISTRY_FIELDS_LOCKED');
    }
    const dupes = await findDuplicates(req, { ...(body as { nationalId?: string; clientRegistryId?: string; shaNumber?: string }), identifiers: body.identifiers as never, excludeId: String(p._id) });
    if (dupes.length) throw conflict('Another patient already has one of these identifiers', dupes, 'PATIENT_EXISTS');
    const before = p.toObject();
    // Keep the matching entry in the identifier list in step with an edited National ID / SHA number.
    if (!('identifiers' in body)) {
      for (const [field, type] of [['nationalId', 'National ID'], ['shaNumber', 'SHA Number']] as const) {
        if (!(field in body)) continue;
        const list = (p.identifiers ?? []).filter((i) => i.type !== type);
        if (body[field]) list.push({ type, value: String(body[field]), source: 'local' } as never);
        p.set('identifiers', list);
      }
    }
    p.set({ ...body, phone: 'phone' in body ? normalizePhone(body.phone as string | undefined) : p.phone, altPhone: 'altPhone' in body ? normalizePhone(body.altPhone as string | undefined) : p.altPhone, updatedBy: req.user!.id });
    await p.save();
    await audit(req, { action: 'patient.update', resource: 'patient', resourceId: String(p._id), oldValue: before, newValue: p.toObject() });
    res.json({ success: true, data: p });
  }),
);

/**
 * Bring a patient registered in another branch into the current branch. The user must present the
 * patient number AND a matching strong identifier, proving the patient is physically present.
 */
router.post(
  '/link-branch',
  requirePermission('patients.create'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(z.object({ patientNumber: z.string().min(3).max(20), identifierValue: z.string().min(3).max(60) }), req.body);
    const { Patient } = req.tenant!.models;
    const v = body.identifierValue.trim();
    const p = await Patient.findOne({ patientNumber: body.patientNumber.toUpperCase(), $or: [{ nationalId: v }, { clientRegistryId: v }, { shaNumber: v }, { 'identifiers.value': v }, { phone: normalizePhone(v) }] });
    if (!p) throw notFound('No patient matches this number and identifier');
    if (!p.branchIds.some((b) => String(b) === req.branch!.id)) p.branchIds.push(new Types.ObjectId(req.branch!.id));
    await p.save();
    await audit(req, { action: 'patient.link_branch', resource: 'patient', resourceId: String(p._id), newValue: { branchId: req.branch!.id } });
    res.json({ success: true, data: { id: p._id, patientNumber: p.patientNumber } });
  }),
);

const TIMELINE_LABELS: Record<string, string> = {
  'patient.create': 'Registered in AfeySync',
  'patient.import_dha': 'Imported from DHA Client Registry',
  'patient.update': 'Demographics updated',
  'patient.link_branch': 'Linked to another branch',
};

router.get(
  '/:id/timeline',
  requirePermission('patients.view'),
  h(async (req, res) => {
    const p = await loadAccessiblePatient(req, req.params.id as string);
    const { ShaEligibilityCheck, ShaTransaction, AuditLog } = req.tenant!.models;
    const [checks, txs, events] = await Promise.all([
      ShaEligibilityCheck.find({ patientId: p._id }).sort({ createdAt: -1 }).limit(20).select('status createdAt summary.scheme').lean(),
      ShaTransaction.find({ patientId: p._id, ...branchFilter(req) }).sort({ createdAt: -1 }).limit(20).select('kind reference status createdAt').lean(),
      AuditLog.find({ resource: 'patient', resourceId: String(p._id), action: { $in: ['patient.create', 'patient.import_dha', 'patient.update', 'patient.link_branch'] } }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const timeline = [
      ...checks.map((c) => ({ at: c.createdAt, type: 'sha_eligibility', title: `SHA eligibility: ${c.status}` })),
      ...txs.map((t) => ({ at: t.createdAt, type: `sha_${t.kind}`, title: `SHA ${t.kind.replace('_', ' ')} ${t.reference} (${t.status})` })),
      ...events.map((e) => ({ at: e.createdAt, type: e.action, title: TIMELINE_LABELS[e.action] ?? e.action, by: e.userName })),
    ].sort((a, b) => +new Date(b.at!) - +new Date(a.at!));
    res.json({ success: true, data: timeline });
  }),
);

export default router;
