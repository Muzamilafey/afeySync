import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse, parsePatch } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requireBranch, requirePermission } from '../../middleware/auth';
import { branchFilter, canAccessAnyBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { dayRange, loadScoped, nextNumber, oid } from '../common/helpers';
import { enqueueJob } from '../../jobs/queue';
import { fmtEAT } from '../notifications/notify';
import { buildSearchFilter } from '../patients/patientService';

const router = Router();
router.use(authenticateTenant);

/** Kenya time (EAT, UTC+3, no daylight saving): booking hours and "today" are in EAT. */
const EAT_MS = 3 * 3600_000;
export const CLINIC_OPEN = '08:00';
export const CLINIC_CLOSE = '17:00';
/** Service categories that can be booked as appointments. */
const BOOKABLE = ['consultation', 'procedure', 'dental', 'radiology', 'laboratory', 'maternity', 'nursing', 'other'];

const eatDayStart = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - EAT_MS);
const eatToday = () => new Date(Date.now() + EAT_MS).toISOString().slice(0, 10);
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const bookingSchema = z.object({
  patientId: z.string(),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(5).max(240).default(15),
  department: z.string().max(80).optional(),
  providerId: z.string().optional(),
  serviceCode: z.string().max(40).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  notifyPatient: z.boolean().default(true),
});

type Booking = z.infer<typeof bookingSchema>;

/** Validates one booking against the patient, service, practitioner and existing appointments. */
async function checkBooking(req: Request, b: Booking, at: Date, ignoreIds: string[] = []) {
  const m = req.tenant!.models;
  if (at.getTime() < Date.now() - 5 * 60_000) throw conflict('Appointment time is in the past', undefined, 'APPOINTMENT_IN_PAST');
  const end = new Date(at.getTime() + b.durationMinutes * 60_000);
  const overlaps = (extra: Record<string, unknown>) =>
    m.Appointment.find({ ...extra, _id: { $nin: ignoreIds.map((i) => new Types.ObjectId(i)) }, status: 'booked', scheduledAt: { $lt: end, $gte: new Date(at.getTime() - 240 * 60_000) } })
      .lean()
      .then((rows) => rows.find((r) => new Date(r.scheduledAt).getTime() + (r.durationMinutes ?? 15) * 60_000 > at.getTime()));
  let providerName: string | undefined;
  if (b.providerId) {
    const provider = await m.User.findById(oid(b.providerId, 'Practitioner')).select('name status').lean();
    if (!provider || provider.status !== 'active') throw notFound('Practitioner not found');
    providerName = provider.name;
    if (await overlaps({ providerId: provider._id })) throw conflict(`${providerName} already has an appointment at ${fmtEAT(at)}`, undefined, 'APPOINTMENT_CLASH');
  }
  if (await overlaps({ patientId: new Types.ObjectId(b.patientId) })) throw conflict(`The patient already has an appointment at ${fmtEAT(at)}`, undefined, 'PATIENT_DOUBLE_BOOKED');
  return { providerName };
}

async function loadService(req: Request, code?: string) {
  if (!code) return null;
  const svc = await req.tenant!.models.ServiceItem.findOne({ code: code.toUpperCase(), active: true }).select('code name category department').lean();
  if (!svc || !BOOKABLE.includes(svc.category)) throw notFound('Service not found or not bookable');
  return svc;
}

async function loadPatient(req: Request, id: string) {
  const patient = await req.tenant!.models.Patient.findById(oid(id, 'Patient')).lean();
  if (!patient || !canAccessAnyBranch(req, patient.branchIds ?? [])) throw notFound('Patient not found');
  return patient;
}

/** Filters shared by the list and the export. */
async function listFilter(req: Request) {
  const m = req.tenant!.models;
  const filter: Record<string, unknown> = { ...branchFilter(req) };
  const scope = String(req.query.scope ?? '');
  const todayStart = eatDayStart(eatToday());
  const tomorrow = new Date(todayStart.getTime() + 86400_000);
  if (scope === 'today') filter.scheduledAt = { $gte: todayStart, $lt: tomorrow };
  else if (scope === 'upcoming') filter.scheduledAt = { $gte: tomorrow };
  else if (scope === 'past') filter.scheduledAt = { $lt: todayStart };
  else if (scope !== 'all' && (req.query.from || req.query.to)) filter.scheduledAt = dayRange(req.query.from, req.query.to);
  if (req.query.from && scope === 'all') filter.scheduledAt = dayRange(req.query.from, req.query.to);
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.providerId) filter.providerId = oid(req.query.providerId, 'Provider');
  if (req.query.serviceCode) filter.serviceCode = String(req.query.serviceCode).toUpperCase();
  if (req.query.courseId) filter.courseId = oid(req.query.courseId, 'Course');
  if (req.query.patientId) {
    filter.patientId = oid(req.query.patientId, 'Patient');
    if (!scope) delete filter.scheduledAt;
  }
  const q = String(req.query.q ?? '').trim();
  if (q.length >= 2) {
    if (/^APT-?\d+$/i.test(q)) filter.appointmentNumber = new RegExp(`^${escapeRegex(q.toUpperCase())}`);
    else {
      const ids = (await m.Patient.find({ ...buildSearchFilter(q), ...branchFilter(req, 'branchIds') }).select('_id').limit(500).lean()).map((p) => p._id);
      filter.patientId = { $in: ids };
    }
  }
  return { filter, scope };
}

router.get(
  '/',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const { filter, scope } = await listFilter(req);
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const items = await req.tenant!.models.Appointment.find(filter)
      .populate('patientId', 'patientNumber firstName middleName lastName phone gender dateOfBirth')
      .sort({ scheduledAt: scope === 'past' || scope === 'all' ? -1 : 1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: items });
  }),
);

/** CSV of the current list (same filters). */
router.get(
  '/export',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const { filter } = await listFilter(req);
    const rows = await req.tenant!.models.Appointment.find(filter).populate('patientId', 'patientNumber firstName lastName phone').sort({ scheduledAt: 1 }).limit(5000).lean();
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // no spreadsheet formulas from data
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [['Appointment', 'Date & time (EAT)', 'Minutes', 'Patient', 'Patient no.', 'Phone', 'Service', 'Practitioner', 'Status', 'Reason', 'Course'].join(',')];
    for (const a of rows) {
      const p = a.patientId as unknown as { patientNumber?: string; firstName?: string; lastName?: string; phone?: string } | null;
      lines.push([a.appointmentNumber, fmtEAT(a.scheduledAt), a.durationMinutes, `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(), p?.patientNumber, p?.phone, a.serviceName, a.providerName, a.status, a.reason, a.courseIndex ? `${a.courseIndex}/${a.courseTotal}` : ''].map(cell).join(','));
    }
    await audit(req, { action: 'appointment.export', resource: 'appointment', resourceId: 'bulk', newValue: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="appointments-${eatToday()}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }),
);

/** Practitioners who can be booked: active users holding consultation, dental or MCH permissions. */
router.get(
  '/providers',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const m = req.tenant!.models;
    const roles = await m.Role.find({ permissions: { $in: ['consultation.create', 'dental.manage', 'mch.manage', 'maternity.manage'] } }).select('_id name').lean();
    const filter: Record<string, unknown> = { status: 'active', roleIds: { $in: roles.map((r) => r._id) } };
    const users = await m.User.find(filter).select('name branchAccess branchIds roleIds practitioner.cadre').sort({ name: 1 }).lean();
    const branch = req.branch?.id;
    res.json({
      success: true,
      data: users
        .filter((u) => !branch || u.branchAccess === 'all' || (u.branchIds ?? []).some((b) => String(b) === branch))
        .map((u) => ({ _id: u._id, name: u.name, cadre: u.practitioner?.cadre ?? null, roles: roles.filter((r) => (u.roleIds ?? []).some((id) => String(id) === String(r._id))).map((r) => r.name) })),
    });
  }),
);

/** Bookable services from the catalogue (consultations, procedures, dental, imaging, …). */
router.get(
  '/services',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const items = await req.tenant!.models.ServiceItem.find({ active: true, category: { $in: BOOKABLE } } as Record<string, unknown>).select('code name category department').sort({ category: 1, name: 1 }).limit(1000).lean();
    res.json({ success: true, data: items });
  }),
);

/**
 * Time slots for a day (clinic hours 08:00–17:00 EAT) and whether each is free: past slots and
 * slots where the practitioner or the patient is already booked are not.
 */
router.get(
  '/slots',
  requirePermission('appointments.view'),
  h(async (req, res) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'), durationMinutes: z.coerce.number().int().min(5).max(240).default(15), providerId: z.string().optional(), patientId: z.string().optional(), serviceCode: z.string().optional() }), req.query);
    const m = req.tenant!.models;
    const dayStart = eatDayStart(q.date);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const busy = await m.Appointment.find({
      ...branchFilter(req),
      status: 'booked',
      scheduledAt: { $gte: new Date(dayStart.getTime() - 240 * 60_000), $lt: dayEnd },
      $or: [...(q.providerId ? [{ providerId: oid(q.providerId, 'Practitioner') }] : []), ...(q.patientId ? [{ patientId: oid(q.patientId, 'Patient') }] : []), ...(q.serviceCode ? [{ serviceCode: q.serviceCode.toUpperCase() }] : []), { _id: null }],
    })
      .select('scheduledAt durationMinutes providerId patientId serviceCode')
      .lean();
    const slots = [];
    for (let t = hm(CLINIC_OPEN); t + q.durationMinutes <= hm(CLINIC_CLOSE); t += q.durationMinutes) {
      const at = new Date(dayStart.getTime() + t * 60_000);
      const end = new Date(at.getTime() + q.durationMinutes * 60_000);
      const over = busy.filter((b) => new Date(b.scheduledAt) < end && new Date(b.scheduledAt).getTime() + (b.durationMinutes ?? 15) * 60_000 > at.getTime());
      const providerBusy = q.providerId && over.some((b) => String(b.providerId) === q.providerId);
      const patientBusy = q.patientId && over.some((b) => String(b.patientId) === q.patientId);
      const past = at.getTime() < Date.now();
      slots.push({
        at: at.toISOString(),
        label: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
        available: !past && !providerBusy && !patientBusy,
        reason: past ? 'past' : providerBusy ? 'practitioner booked' : patientBusy ? 'patient booked' : null,
        serviceBookings: q.serviceCode ? over.filter((b) => b.serviceCode === q.serviceCode!.toUpperCase()).length : undefined,
      });
    }
    res.json({ success: true, data: { date: q.date, open: CLINIC_OPEN, close: CLINIC_CLOSE, slots } });
  }),
);

async function notifyBooked(req: Request, patient: { phone?: string | null; consent?: { sms?: boolean | null } | null }, a: { _id: unknown; appointmentNumber: string; scheduledAt: Date }, text: string) {
  if (!patient.phone || patient.consent?.sms === false) return;
  await enqueueJob('SMS', `appt:${req.tenant!.id}:${a._id}:confirm`, { to: patient.phone, message: `${req.tenant!.name}: ${text}` }, req.tenant!.id);
}

async function queueReminder(req: Request, patient: { phone?: string | null; consent?: { sms?: boolean | null } | null }, a: { _id: unknown; scheduledAt: Date }) {
  if (!patient.phone || patient.consent?.sms === false) return;
  const remindAt = new Date(a.scheduledAt.getTime() - 24 * 3600_000);
  if (remindAt.getTime() > Date.now()) await enqueueJob('SMS', `appt:${req.tenant!.id}:${a._id}:remind`, { to: patient.phone, message: `${req.tenant!.name}: Reminder of your appointment on ${fmtEAT(a.scheduledAt)}. Reply or call to reschedule.` }, req.tenant!.id, { runAt: remindAt });
}

router.post(
  '/',
  requirePermission('appointments.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(bookingSchema, req.body);
    if (!body.serviceCode && !body.providerId) throw badRequest('Choose a service or a practitioner');
    const m = req.tenant!.models;
    const patient = await loadPatient(req, body.patientId);
    const svc = await loadService(req, body.serviceCode);
    const { providerName } = await checkBooking(req, body, body.scheduledAt);
    const a = await m.Appointment.create({
      ...body,
      bookBy: body.serviceCode ? 'service' : 'practitioner',
      serviceCode: svc?.code,
      serviceName: svc?.name,
      department: body.department ?? svc?.department,
      appointmentNumber: await nextNumber(m, 'appointment', 'APT'),
      branchId: req.branch!.id,
      providerName,
      createdBy: req.user!.id,
    });
    if (body.notifyPatient) {
      await notifyBooked(req, patient, a, `Appointment ${a.appointmentNumber} booked for ${fmtEAT(body.scheduledAt)}${svc ? ` (${svc.name})` : ''}${providerName ? ` with ${providerName}` : ''}.`);
      await queueReminder(req, patient, a);
    }
    await audit(req, { action: 'appointment.create', resource: 'appointment', resourceId: String(a._id), newValue: { scheduledAt: body.scheduledAt, providerName, serviceCode: svc?.code } });
    res.status(201).json({ success: true, data: a });
  }),
);

/**
 * Book a course: the same service/practitioner every N days for a number of sessions. All sessions
 * are checked first; if any clashes nothing is booked and the clashing dates are listed.
 */
router.post(
  '/course',
  requirePermission('appointments.manage'),
  requireBranch,
  h(async (req, res) => {
    const body = parse(bookingSchema.extend({ sessions: z.number().int().min(2).max(30), everyDays: z.number().int().min(1).max(60) }), req.body);
    if (!body.serviceCode && !body.providerId) throw badRequest('Choose a service or a practitioner');
    const m = req.tenant!.models;
    const patient = await loadPatient(req, body.patientId);
    const svc = await loadService(req, body.serviceCode);
    const dates = Array.from({ length: body.sessions }, (_, i) => new Date(body.scheduledAt.getTime() + i * body.everyDays * 86400_000));
    const problems: string[] = [];
    let providerName: string | undefined;
    for (const [i, at] of dates.entries()) {
      try {
        providerName = (await checkBooking(req, body, at)).providerName;
      } catch (err) {
        problems.push(`Session ${i + 1} (${fmtEAT(at)}): ${(err as Error).message}`);
      }
    }
    if (problems.length) throw conflict(`Nothing was booked. ${problems.length} session(s) clash:\n${problems.join('\n')}`, { problems }, 'COURSE_CLASH');
    const courseId = new Types.ObjectId();
    const created = [];
    for (const [i, at] of dates.entries()) {
      created.push(
        await m.Appointment.create({
          ...body,
          scheduledAt: at,
          bookBy: body.serviceCode ? 'service' : 'practitioner',
          serviceCode: svc?.code,
          serviceName: svc?.name,
          department: body.department ?? svc?.department,
          appointmentNumber: await nextNumber(m, 'appointment', 'APT'),
          branchId: req.branch!.id,
          providerName,
          courseId,
          courseIndex: i + 1,
          courseTotal: body.sessions,
          createdBy: req.user!.id,
        }),
      );
    }
    if (body.notifyPatient) {
      await notifyBooked(req, patient, created[0], `${body.sessions} appointments booked${svc ? ` for ${svc.name}` : ''}, every ${body.everyDays} day(s) from ${fmtEAT(dates[0])}. You will get a reminder before each.`);
      for (const a of created) await queueReminder(req, patient, a);
    }
    await audit(req, { action: 'appointment.course_create', resource: 'appointment', resourceId: String(courseId), newValue: { sessions: body.sessions, everyDays: body.everyDays, first: dates[0], serviceCode: svc?.code, providerName } });
    res.status(201).json({ success: true, data: { courseId, appointments: created } });
  }),
);

router.patch(
  '/:id',
  requirePermission('appointments.manage'),
  h(async (req, res) => {
    const body = parsePatch(bookingSchema.pick({ scheduledAt: true, durationMinutes: true, reason: true, department: true, notes: true }).partial(), req.body);
    const a = await loadScoped(req, req.tenant!.models.Appointment, req.params.id, 'Appointment');
    if (a.status !== 'booked') throw conflict('Only booked appointments can be rescheduled');
    if (body.scheduledAt || body.durationMinutes) {
      await checkBooking(req, { patientId: String(a.patientId), providerId: a.providerId ? String(a.providerId) : undefined, durationMinutes: body.durationMinutes ?? a.durationMinutes ?? 15, scheduledAt: body.scheduledAt ?? a.scheduledAt, notifyPatient: false }, body.scheduledAt ?? a.scheduledAt, [String(a._id)]);
    }
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
