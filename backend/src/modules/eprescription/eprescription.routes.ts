import { Router, type Request } from 'express';
import { h } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { loadScoped } from '../common/helpers';
import { hieRequest } from '../../integrations/hie/hieClient';
import { bundle, toMedicationDispenses, toMedicationRequests, toPatient } from '../fhir/mappers';
import { fhirConfig } from '../fhir/outbox';
import { validateResource } from '../fhir/validator';
import type { TenantModels } from '../../models/tenant';

/**
 * National ePrescription through the DHA HIE. The payload is a FHIR R4 Bundle (Patient + MedicationRequests,
 * or MedicationDispenses). The HIE operations (`eprescription.preview|create|dispense`) have no path until
 * the platform owner configures them from the official API catalog; until then these endpoints return
 * INTEGRATION_OPERATION_NOT_CONFIGURED and nothing is recorded as sent.
 */
const router = Router();
router.use(authenticateTenant);

type Rx = NonNullable<Awaited<ReturnType<TenantModels['Prescription']['findOne']>>>;
const NOT_SENT = new Set(['INTEGRATION_OPERATION_NOT_CONFIGURED', 'INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY']);
const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });
const pickId = (d: unknown) => {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const inner = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>;
  for (const k of ['prescription_id', 'prescriptionId', 'id', 'reference']) if (o[k] ?? inner[k]) return String(o[k] ?? inner[k]);
  return undefined;
};

async function buildRequestBundle(req: Request, rx: Rx) {
  const m = req.tenant!.models;
  const cfg = await fhirConfig(m, req.tenant!.slug);
  const patient = await m.Patient.findById(rx.patientId).lean();
  if (!patient) throw new AppError(404, 'NOT_FOUND', 'Patient not found');
  const items = await m.Item.find({ _id: { $in: rx.items.map((i) => i.itemId).filter(Boolean) } }).select('code').lean();
  const itemCodes = Object.fromEntries(items.map((i) => [String(i._id), (i as { code?: string }).code]));
  const resources = [toPatient(cfg, patient as never), ...toMedicationRequests(cfg, rx.toObject() as never, { itemCodes })];
  const b = bundle('transaction', resources as never, cfg);
  return { bundle: b, errors: validateResource(b as never), patient };
}

async function exchange(req: Request, rx: Rx, operation: string, body: unknown, key: string) {
  try {
    const r = await hieRequest('dha', ctx(req), { operation, body, idempotencyKey: key });
    return r.data;
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'ERROR';
    if (!NOT_SENT.has(code)) {
      rx.set('ePrescription.status', 'failed');
      rx.set('ePrescription.lastError', `${code}: ${(err as Error).message}`.slice(0, 300));
      await rx.save();
    }
    await audit(req, { action: `eprescription.${operation.split('.')[1]}`, resource: 'prescription', resourceId: String(rx._id), result: 'failure', newValue: { code } });
    throw err;
  }
}

router.get('/prescriptions/:id/eprescription/bundle', requireAnyPermission('prescription.create', 'pharmacy.view'), h(async (req, res) => {
  const rx = await loadScoped(req, req.tenant!.models.Prescription, req.params.id, 'Prescription');
  const { bundle: b, errors } = await buildRequestBundle(req, rx);
  res.json({ success: true, data: { resource: b, validation: errors, state: rx.ePrescription ?? null } });
}));

router.post('/prescriptions/:id/eprescription/preview', requireAnyPermission('prescription.create', 'pharmacy.dispense'), h(async (req, res) => {
  const rx = await loadScoped(req, req.tenant!.models.Prescription, req.params.id, 'Prescription');
  const { bundle: b, errors } = await buildRequestBundle(req, rx);
  if (errors.length) throw new AppError(422, 'FHIR_VALIDATION_ERROR', 'The prescription does not produce a valid FHIR bundle', errors);
  res.json({ success: true, data: await exchange(req, rx, 'eprescription.preview', b, `rx:${rx._id}:preview:${Date.now()}`) });
}));

router.post('/prescriptions/:id/eprescription', requirePermission('prescription.create'), h(async (req, res) => {
  const rx = await loadScoped(req, req.tenant!.models.Prescription, req.params.id, 'Prescription');
  if (rx.status === 'cancelled') throw new AppError(409, 'CONFLICT', 'Prescription is cancelled');
  if (rx.ePrescription?.externalId) throw new AppError(409, 'EPRESCRIPTION_ALREADY_SENT', 'This prescription was already sent');
  const { bundle: b, errors, patient } = await buildRequestBundle(req, rx);
  if (!patient.clientRegistryId) errors.unshift('Patient has no Client Registry ID (search the DHA Client Registry first)');
  if (errors.length) throw new AppError(422, 'FHIR_VALIDATION_ERROR', 'The prescription is not ready to send', errors);
  const attempt = (rx.ePrescription?.attempts ?? 0) + 1;
  rx.set('ePrescription.attempts', attempt);
  const data = await exchange(req, rx, 'eprescription.create', b, `rx:${rx._id}:create:${attempt}`);
  rx.set('ePrescription', { externalId: pickId(data), status: 'sent', sentAt: new Date(), attempts: attempt });
  await rx.save();
  await audit(req, { action: 'eprescription.create', resource: 'prescription', resourceId: String(rx._id), newValue: { externalId: rx.ePrescription?.externalId } });
  res.json({ success: true, data: rx.ePrescription });
}));

router.post('/prescriptions/:id/eprescription/dispense', requirePermission('pharmacy.dispense'), h(async (req, res) => {
  const rx = await loadScoped(req, req.tenant!.models.Prescription, req.params.id, 'Prescription');
  if (!rx.ePrescription?.externalId) throw new AppError(409, 'EPRESCRIPTION_NOT_SENT', 'Send the ePrescription before reporting a dispense');
  if (!rx.dispenses.length) throw new AppError(409, 'NOTHING_DISPENSED', 'Nothing has been dispensed yet');
  const cfg = await fhirConfig(req.tenant!.models, req.tenant!.slug);
  const b = bundle('transaction', toMedicationDispenses(cfg, rx.toObject() as never) as never, cfg);
  const errors = validateResource(b as never);
  if (errors.length) throw new AppError(422, 'FHIR_VALIDATION_ERROR', 'Dispense bundle is invalid', errors);
  await exchange(req, rx, 'eprescription.dispense', { prescription: rx.ePrescription.externalId, bundle: b }, `rx:${rx._id}:dispense:${rx.dispenses.length}`);
  rx.set('ePrescription.status', 'dispense_reported');
  rx.set('ePrescription.dispenseReportedAt', new Date());
  rx.set('ePrescription.lastError', undefined);
  await rx.save();
  await audit(req, { action: 'eprescription.dispense', resource: 'prescription', resourceId: String(rx._id) });
  res.json({ success: true, data: rx.ePrescription });
}));

export default router;
