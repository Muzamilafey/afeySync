import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse, pagination } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { canAccessBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, nextNumber, oid } from '../common/helpers';
import { accessiblePatient } from '../frontdesk/visits.routes';
import { MEDICAL_REPORT_TYPES } from '../../models/tenant/clinical';

/**
 * Sick notes, medical reports, fitness certificates and attendance letters. The author signs (finalizes)
 * the report; after that it is read-only. Printing shows DRAFT until it is signed.
 */
const router = Router();
router.use(authenticateTenant);

const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || undefined);
const date = z.coerce.date().optional().nullable().transform((v) => v ?? undefined);
const schema = z.object({
  type: z.enum(MEDICAL_REPORT_TYPES),
  patientId: z.string().optional(),
  visitId: z.string().optional(),
  admissionId: z.string().optional(),
  addressedTo: text(200),
  subject: text(200),
  body: text(8000),
  diagnosis: text(500),
  includeDiagnosis: z.boolean().default(false),
  restFrom: date,
  restTo: date,
  fitness: z.enum(['fit', 'fit_with_restrictions', 'unfit']).optional().nullable().transform((v) => v ?? undefined),
  fitnessPurpose: text(200),
  restrictions: text(1000),
  reviewDate: date,
});
type Body = z.infer<typeof schema>;

const DAY = 86400_000;
/** Checks the details each kind of report needs and works out the number of rest days. */
function validate(b: Body) {
  let restDays: number | undefined;
  if (b.type === 'sick_leave') {
    if (!b.restFrom || !b.restTo) throw badRequest('Enter the first and last day of sick leave');
    if (b.restTo < b.restFrom) throw badRequest('The last day of sick leave is before the first day');
    restDays = Math.round((Date.UTC(b.restTo.getFullYear(), b.restTo.getMonth(), b.restTo.getDate()) - Date.UTC(b.restFrom.getFullYear(), b.restFrom.getMonth(), b.restFrom.getDate())) / DAY) + 1;
    if (restDays > 365) throw badRequest('Sick leave cannot be longer than a year on one note');
  }
  if (b.type === 'fitness' && !b.fitness) throw badRequest('Choose whether the patient is fit, fit with restrictions or unfit');
  if (b.type === 'fitness' && b.fitness === 'fit_with_restrictions' && !b.restrictions) throw badRequest('Describe the restrictions');
  if (b.type === 'medical_report' && !b.body) throw badRequest('Write the report');
  if (b.includeDiagnosis && !b.diagnosis) throw badRequest('Enter the diagnosis to include, or untick “include diagnosis”');
  return { restDays };
}

router.get(
  '/',
  requirePermission('medicalreports.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const filter: Record<string, unknown> = {};
    if (req.query.patientId) filter.patientId = oid(String(req.query.patientId), 'Patient');
    if (req.query.visitId) filter.visitId = oid(String(req.query.visitId), 'Visit');
    if (!filter.patientId && !filter.visitId) throw badRequest('Choose a patient or a visit');
    const { page, limit, skip } = pagination(req.query, 100);
    const items = (await m.MedicalReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()).filter((r) => canAccessBranch(req, String(r.branchId)));
    res.json({ success: true, data: items });
  }),
);

router.get(
  '/:id',
  requirePermission('medicalreports.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.MedicalReport, req.params.id, 'Medical report');
    const patient = await m.Patient.findById(r.patientId).select('patientNumber firstName middleName lastName gender dateOfBirth nationalId phone').lean();
    const visit = r.visitId ? await m.Visit.findById(r.visitId).select('visitNumber arrivedAt').lean() : null;
    res.json({ success: true, data: { report: r, patient, visit } });
  }),
);

router.post(
  '/',
  requirePermission('medicalreports.create'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(schema, req.body);
    const m = req.tenant!.models;
    let patientId: string;
    let branchId: string = req.branch!.id;
    if (body.visitId) {
      const v = await loadScoped(req, m.Visit, body.visitId, 'Visit');
      patientId = String(v.patientId);
      branchId = String(v.branchId);
    } else if (body.admissionId) {
      const a = await loadScoped(req, m.Admission, body.admissionId, 'Admission');
      patientId = String(a.patientId);
      branchId = String(a.branchId);
    } else if (body.patientId) {
      patientId = String((await accessiblePatient(req, body.patientId))._id);
    } else throw badRequest('Choose the patient');
    const { restDays } = validate(body);
    const author = await m.User.findById(req.user!.id).select('name practitioner').lean();
    const r = await m.MedicalReport.create({
      ...body,
      patientId,
      branchId,
      restDays,
      reportNumber: await nextNumber(m, 'medicalreport', 'MR'),
      authorId: req.user!.id,
      authorName: author?.name ?? req.user!.name,
      authorCadre: author?.practitioner?.cadre,
      authorLicence: author?.practitioner?.licenseNumber,
    });
    await audit(req, { action: 'medical_report.create', resource: 'medical_report', resourceId: String(r._id), newValue: { type: body.type, reportNumber: r.reportNumber } });
    res.status(201).json({ success: true, data: r });
  }),
);

router.put(
  '/:id',
  requirePermission('medicalreports.create'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.MedicalReport, req.params.id, 'Medical report');
    if (r.status !== 'draft') throw new AppError(409, 'REPORT_SIGNED', 'This report is signed. Add an addendum or void it instead of editing.');
    if (String(r.authorId) !== req.user!.id) throw forbidden('Only the clinician who wrote this report can change it');
    const body = parse(schema, req.body);
    if (body.type !== r.type) throw badRequest('The kind of report cannot be changed; start a new one');
    const { restDays } = validate(body);
    const { patientId: _p, visitId: _v, admissionId: _a, ...content } = body;
    const before = r.toObject();
    r.set({ ...content, restDays });
    await r.save();
    await audit(req, { action: 'medical_report.update', resource: 'medical_report', resourceId: String(r._id), oldValue: before, newValue: r.toObject() });
    res.json({ success: true, data: r });
  }),
);

router.post(
  '/:id/finalize',
  requirePermission('medicalreports.create'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.MedicalReport, req.params.id, 'Medical report');
    if (r.status !== 'draft') throw conflict('This report is already signed', undefined, 'REPORT_SIGNED');
    if (String(r.authorId) !== req.user!.id) throw forbidden('Only the clinician who wrote this report can sign it');
    r.status = 'final';
    r.finalizedAt = new Date();
    await r.save();
    await audit(req, { action: 'medical_report.finalize', resource: 'medical_report', resourceId: String(r._id), newValue: { reportNumber: r.reportNumber } });
    res.json({ success: true, data: r });
  }),
);

router.post(
  '/:id/addendum',
  requirePermission('medicalreports.create'),
  h(async (req, res) => {
    const { text: note } = parse(z.object({ text: z.string().trim().min(3).max(2000) }), req.body);
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.MedicalReport, req.params.id, 'Medical report');
    if (r.status !== 'final') throw conflict('Only a signed report takes addenda; edit the draft instead');
    r.addenda.push({ text: note, by: req.user!.id as never, byName: req.user!.name, at: new Date() });
    await r.save();
    await audit(req, { action: 'medical_report.addendum', resource: 'medical_report', resourceId: String(r._id), newValue: { text: note } });
    res.json({ success: true, data: r });
  }),
);

router.post(
  '/:id/void',
  requirePermission('medicalreports.create'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give the reason').max(500) }), req.body);
    const m = req.tenant!.models;
    const r = await loadScoped(req, m.MedicalReport, req.params.id, 'Medical report');
    if (r.status === 'void') throw conflict('Already void');
    if (String(r.authorId) !== req.user!.id && !req.user!.permissions.has('admin.settings')) throw forbidden('Only the author or an administrator can void a report');
    r.status = 'void';
    r.voidReason = reason;
    r.voidedAt = new Date();
    r.voidedByName = req.user!.name;
    await r.save();
    await audit(req, { action: 'medical_report.void', resource: 'medical_report', resourceId: String(r._id), newValue: { reason } });
    res.json({ success: true, data: r });
  }),
);

export default router;
