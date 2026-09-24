import { Router, type Request } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError, badRequest, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch, canAccessBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { oid } from '../common/helpers';
import { localStorageDriver, newKey, sniff } from './storage';

const router = Router();
router.use(authenticateTenant);

const MAX_BYTES = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 10 } });
const CATEGORIES = ['identification', 'lab_report', 'radiology_report', 'discharge_summary', 'consent', 'insurance', 'sha', 'dha', 'referral', 'other'] as const;
const RELATED = ['radiology_request', 'lab_order', 'admission', 'visit', 'sha_transaction', 'mortuary_case', 'referral'] as const;

async function assertPatientAccess(req: Request, patientId: unknown) {
  const p = await req.tenant!.models.Patient.findById(oid(patientId, 'Patient')).select('branchIds').lean();
  if (!p || !canAccessAnyBranch(req, p.branchIds ?? [])) throw notFound('Patient not found');
  return p;
}

router.post(
  '/',
  requirePermission('documents.upload'),
  requireBranch,
  (req, res, next) => upload.single('file')(req, res, (err: unknown) => (err ? next(err instanceof multer.MulterError ? new AppError(413, 'FILE_TOO_LARGE', `Files must be under ${MAX_BYTES / 1024 / 1024} MB`) : err) : next())),
  h(async (req, res) => {
    const body = parse(z.object({ category: z.enum(CATEGORIES), title: z.string().min(2).max(160), patientId: z.string().optional(), relatedResource: z.enum(RELATED).optional(), relatedId: z.string().optional() }), req.body);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw badRequest('A file is required');
    const type = sniff(file.buffer);
    if (!type) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF, PNG, JPEG and DICOM files are accepted');
    if (body.patientId) await assertPatientAccess(req, body.patientId);
    if (body.relatedResource && !body.relatedId) throw badRequest('relatedId is required with relatedResource');
    const key = newKey(req.tenant!.slug);
    await localStorageDriver.put(key, file.buffer);
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const doc = await req.tenant!.models.Document.create({
      patientId: body.patientId,
      branchId: req.branch!.id,
      category: body.category,
      title: body.title,
      fileName: file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120),
      mimeType: type.mime,
      sizeBytes: file.size,
      sha256,
      storageKey: key,
      relatedTo: body.relatedResource ? { resource: body.relatedResource, id: body.relatedId } : undefined,
      uploadedBy: req.user!.id,
      uploadedByName: req.user!.name,
    });
    if (body.relatedResource === 'radiology_request' && body.relatedId) await req.tenant!.models.RadiologyRequest.updateOne({ _id: oid(body.relatedId, 'Request') }, { $addToSet: { attachmentIds: doc._id } });
    await audit(req, { action: 'document.upload', resource: 'document', resourceId: String(doc._id), newValue: { category: body.category, title: body.title, sizeBytes: file.size, sha256 } });
    const out = doc.toObject() as unknown as Record<string, unknown>;
    delete out.storageKey;
    res.status(201).json({ success: true, data: out });
  }),
);

router.get(
  '/',
  requirePermission('documents.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (req.query.patientId) {
      await assertPatientAccess(req, req.query.patientId);
      filter.patientId = req.query.patientId;
    } else Object.assign(filter, branchFilter(req));
    if (req.query.relatedResource && req.query.relatedId) {
      filter['relatedTo.resource'] = String(req.query.relatedResource);
      filter['relatedTo.id'] = String(req.query.relatedId);
    }
    if (req.query.category) filter.category = String(req.query.category);
    res.json({ success: true, data: await req.tenant!.models.Document.find(filter).sort({ createdAt: -1 }).limit(200).lean() });
  }),
);

router.get(
  '/:id/download',
  requirePermission('documents.view'),
  h(async (req, res) => {
    const doc = await req.tenant!.models.Document.findOne({ _id: oid(req.params.id, 'Document'), deletedAt: null }).select('+storageKey').lean();
    if (!doc) throw notFound('Document not found');
    if (doc.patientId) await assertPatientAccess(req, String(doc.patientId));
    else if (!canAccessBranch(req, doc.branchId)) throw forbidden();
    await audit(req, { action: 'document.download', resource: 'document', resourceId: String(doc._id) });
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.inline === 'true' && doc.mimeType !== 'application/dicom' ? 'inline' : 'attachment'}; filename="${(doc.fileName ?? 'document').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    localStorageDriver.stream(doc.storageKey).on('error', () => res.destroy()).pipe(res);
  }),
);

/** Soft delete only (documents may be part of the legal medical record). */
router.post(
  '/:id/delete',
  requirePermission('documents.upload'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
    const doc = await req.tenant!.models.Document.findOne({ _id: oid(req.params.id, 'Document'), deletedAt: null });
    if (!doc) throw notFound('Document not found');
    if (!canAccessBranch(req, doc.branchId)) throw forbidden();
    doc.deletedAt = new Date();
    await doc.save();
    await audit(req, { action: 'document.delete', resource: 'document', resourceId: String(doc._id), newValue: { reason } });
    res.json({ success: true });
  }),
);

export default router;
