import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid } from '../common/helpers';
import { enqueueJob } from '../../jobs/queue';
import { fmtEAT } from '../notifications/notify';

const router = Router();
router.use(authenticateTenant);

const schema = z.object({
  patientId: z.string(),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(5).max(240).default(15),
  department: z.string().max(80).optional(),
  providerId: z.string().optional(),
  reason: z.string().max(500).optional(),
  notifyPatient: z.boolean().default(true),
});

router.get(
  '/',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = { ...branchFilter(req), scheduledAt: dayRange(req.query.from, req.query.to) };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.providerId) filter.providerId = oid(req.query.providerId, 'Provider');
    if (req.query.patientId) {
      filter.patientId = oid(req.query.patientId, 'Patient');
      delete filter.scheduledAt;
    }
    const items = await req.tenant!.models.Appointment.find(filter).populate('patientId', 'patientNumber firstName lastName phone').sort({ scheduledAt: 1 }).limit(500).lean();
    res.json({ success: true, data: items });
  }),
);

/** Clinicians who can be booked: active users holding consultation or dental permissions. */
router.get(
  '/providers',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const roles = await m.Role.find({ permissions: { $in: ['consultation.create', 'dental.manage', 'mch.manage', 'maternity.manage'] } }).select('_id').lean();
    const filter: Record<string, unknown> = { status: 'active', roleIds: { $in: roles.map((r) => r._id) } };
    const users = await m.User.find(filter).select('name branchAccess branchIds practitioner.cadre').sort({ name: 1 }).lean();
    const branch = req.branch?.id;
    res.json({ success: true, data: users.filter((u) => !branch || u.branchAccess === 'all' || (u.branchIds ?? []).some((b) => String(b) === branch)) });
  }),
);

router.post(
  '/',
  requirePermission('appointments.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(schema, req.body);
    const m = req.tenant!.models;
    const patient = await m.Patient.findById(oid(body.patientId, 'Patient')).lean();
    if (!patient || !canAccessAnyBranch(req, patient.branchIds ?? [])) throw notFound('Patient not found');
    if (body.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw conflict('Appointment time is in the past');
    let providerName: string | undefined;
    if (body.providerId) {
      const provider = await m.User.findById(oid(body.providerId, 'Provider')).select('name').lean();
      if (!provider) throw notFound('Provider not found');
      providerName = provider.name;
      const end = new Date(body.scheduledAt.getTime() + body.durationMinutes * 60_000);
      const clash = await m.Appointment.findOne({ providerId: body.providerId, status: 'booked', scheduledAt: { $lt: end, $gte: new Date(body.scheduledAt.getTime() - 240 * 60_000) } }).lean();
      if (clash && new Date(clash.scheduledAt).getTime() + (clash.durationMinutes ?? 15) * 60_000 > body.scheduledAt.getTime()) throw conflict(`${providerName} already has an appointment at that time`, undefined, 'APPOINTMENT_CLASH');
    }
    const a = await m.Appointment.create({ ...body, appointmentNumber: await nextNumber(m, 'appointment', 'APT'), branchId: req.branch!.id, providerName, createdBy: req.user!.id });
    if (body.notifyPatient && patient.phone && patient.consent?.sms !== false) {
      const when = fmtEAT(body.scheduledAt);
      await enqueueJob('SMS', `appt:${req.tenant!.id}:${a._id}:confirm`, { to: patient.phone, message: `${req.tenant!.name}: Appointment ${a.appointmentNumber} booked for ${when}${providerName ? ` with ${providerName}` : ''}.` }, req.tenant!.id);
      const remindAt = new Date(body.scheduledAt.getTime() - 24 * 3600_000);
      if (remindAt.getTime() > Date.now()) await enqueueJob('SMS', `appt:${req.tenant!.id}:${a._id}:remind`, { to: patient.phone, message: `${req.tenant!.name}: Reminder of your appointment on ${when}. Reply or call to reschedule.` }, req.tenant!.id, { runAt: remindAt });
    }
    await audit(req, { action: 'appointment.create', resource: 'appointment', resourceId: String(a._id), newValue: { scheduledAt: body.scheduledAt, providerName } });
    res.status(201).json({ success: true, data: a });
  }),
);

router.patch(
  '/:id',
  requirePermission('appointments.manage'),
  h(async (req, res) => {
    const body = parse(schema.pick({ scheduledAt: true, durationMinutes: true, reason: true, department: true }).partial(), req.body);
    const a = await loadScoped(req, req.tenant!.models.Appointment, req.params.id, 'Appointment');
    if (a.status !== 'booked') throw conflict('Only booked appointments can be rescheduled');
    const before = a.toObject();
    a.set(body);
    await a.save();
    await audit(req, { action: 'appointment.reschedule', resource: 'appointment', resourceId: String(a._id), oldValue: { scheduledAt: before.scheduledAt }, newValue: body });
    res.json({ success: true, data: a });
  }),
);

for (const action of ['cancel', 'no-show'] as const) {
  router.post(
    `/:id/${action}`,
    requirePermission('appointments.manage'),
    h(async (req, res) => {
      const { reason } = parse(z.object({ reason: z.string().max(300).optional() }), req.body ?? {});
      const a = await loadScoped(req, req.tenant!.models.Appointment, req.params.id, 'Appointment');
      if (a.status !== 'booked') throw conflict(`Appointment is ${a.status}`);
      a.status = action === 'cancel' ? 'cancelled' : 'no_show';
      a.cancelReason = reason;
      await a.save();
      await audit(req, { action: `appointment.${action}`, resource: 'appointment', resourceId: String(a._id), newValue: { reason } });
      res.json({ success: true, data: a });
    }),
  );
}

export default router;
export { forbidden };
