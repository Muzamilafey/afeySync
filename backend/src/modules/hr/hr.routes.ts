import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse, parsePatch } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { dayRange, nextNumber, oid } from '../common/helpers';
import { DHAHealthWorkerRegistryService } from '../../integrations/hie/services';

const router = Router();
router.use(authenticateTenant);

const staffSchema = z.object({
  userId: z.string().optional(),
  fullName: z.string().min(2).max(160),
  branchId: z.string().optional(),
  department: z.string().max(80).optional(),
  cadre: z.string().max(80).optional(),
  jobTitle: z.string().max(80).optional(),
  employmentType: z.enum(['permanent', 'contract', 'locum', 'intern', 'volunteer']).default('permanent'),
  hireDate: z.coerce.date().optional(),
  licenseNumber: z.string().max(60).optional(),
  licenseBody: z.string().max(80).optional(),
  licenseExpiry: z.coerce.date().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  nationalId: z.string().max(20).optional(),
  kraPin: z.string().max(20).optional(),
  status: z.enum(['active', 'on_leave', 'terminated']).optional(),
});

router.get('/staff', requirePermission('hr.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  const q = String(req.query.q ?? '').trim();
  if (q) filter.$or = [{ fullName: new RegExp(escapeRegex(q), 'i') }, { employeeNumber: q.toUpperCase() }];
  if (req.query.status) filter.status = String(req.query.status);
  res.json({ success: true, data: await req.tenant!.models.StaffProfile.find(filter).populate('branchId', 'branchName').sort({ fullName: 1 }).limit(1000).lean() });
}));

router.post('/staff', requirePermission('hr.manage'), h(async (req, res) => {
  const body = parse(staffSchema, req.body);
  const m = req.tenant!.models;
  if (body.userId && (await m.StaffProfile.exists({ userId: oid(body.userId, 'User') }))) throw conflict('This user already has a staff record');
  const s = await m.StaffProfile.create({ ...body, email: body.email || undefined, employeeNumber: await nextNumber(m, 'employee', 'EMP', 5) });
  await audit(req, { action: 'hr.staff_create', resource: 'staff', resourceId: String(s._id), newValue: { ...body, nationalId: undefined, kraPin: undefined } });
  res.status(201).json({ success: true, data: s });
}));

router.patch('/staff/:id', requirePermission('hr.manage'), h(async (req, res) => {
  const body = parsePatch(staffSchema.partial(), req.body);
  const s = await req.tenant!.models.StaffProfile.findById(oid(req.params.id, 'Staff'));
  if (!s) throw notFound('Staff record not found');
  const before = s.toObject();
  s.set({ ...body, email: body.email || undefined });
  await s.save();
  await audit(req, { action: 'hr.staff_update', resource: 'staff', resourceId: String(s._id), oldValue: before, newValue: s.toObject() });
  res.json({ success: true, data: s });
}));

/** Practising licences expiring within N days (default 60) or already expired. */
router.get('/staff/license-alerts', requirePermission('hr.view'), h(async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 60);
  res.json({ success: true, data: await req.tenant!.models.StaffProfile.find({ status: { $ne: 'terminated' }, licenseExpiry: { $lte: new Date(Date.now() + days * 86400_000) } }).sort({ licenseExpiry: 1 }).lean() });
}));

/** Verify against the DHA Health Worker Registry (requires the operation to be configured by the owner). */
router.post('/staff/:id/verify-registry', requirePermission('hr.manage'), h(async (req, res) => {
  const s = await req.tenant!.models.StaffProfile.findById(oid(req.params.id, 'Staff'));
  if (!s) throw notFound('Staff record not found');
  const query: Record<string, string> = {};
  if (s.licenseNumber) query.registration_number = s.licenseNumber;
  if (s.nationalId) query.identification_number = s.nationalId;
  if (!Object.keys(query).length) throw badRequest('Licence number or national ID is required for registry verification');
  const results = await DHAHealthWorkerRegistryService.search({ tenantId: req.tenant!.id, userId: req.user!.id, requestId: req.requestId }, query);
  await audit(req, { action: 'hr.registry_verify', resource: 'staff', resourceId: String(s._id), newValue: { matches: results.length } });
  res.json({ success: true, data: results });
}));

/* Leave */
router.post('/leave', h(async (req, res) => {
  const body = parse(z.object({ staffId: z.string().optional(), type: z.enum(['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid']), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().max(500).optional() }), req.body);
  if (body.endDate < body.startDate) throw badRequest('End date is before start date');
  const m = req.tenant!.models;
  // Staff can request their own leave; HR can file on behalf of anyone.
  const staff = body.staffId ? await m.StaffProfile.findById(oid(body.staffId, 'Staff')) : await m.StaffProfile.findOne({ userId: req.user!.id });
  if (!staff) throw notFound('No staff record found');
  if (String(staff.userId) !== req.user!.id && !req.permissions!.has('hr.manage')) throw forbidden('You can only request your own leave');
  const days = Math.floor((body.endDate.getTime() - body.startDate.getTime()) / 86400_000) + 1;
  const overlap = await m.LeaveRequest.exists({ staffId: staff._id, status: { $in: ['pending', 'approved'] }, startDate: { $lte: body.endDate }, endDate: { $gte: body.startDate } });
  if (overlap) throw conflict('Overlaps an existing leave request');
  const l = await m.LeaveRequest.create({ ...body, staffId: staff._id, days });
  await audit(req, { action: 'hr.leave_request', resource: 'leave', resourceId: String(l._id), newValue: { type: body.type, days } });
  res.status(201).json({ success: true, data: l });
}));

/** Self-service: the caller's own staff record and leave requests (no HR permission needed). */
router.get('/leave/mine', h(async (req, res) => {
  const m = req.tenant!.models;
  const staff = await m.StaffProfile.findOne({ userId: req.user!.id }).select('fullName employeeNumber').lean();
  const items = staff ? await m.LeaveRequest.find({ staffId: staff._id }).sort({ startDate: -1 }).limit(50).lean() : [];
  res.json({ success: true, data: { staff, items } });
}));

router.get('/leave', requirePermission('hr.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  res.json({ success: true, data: await req.tenant!.models.LeaveRequest.find(filter).populate('staffId', 'fullName employeeNumber department').sort({ createdAt: -1 }).limit(300).lean() });
}));

router.post('/leave/:id/:decision', requirePermission('hr.manage'), h(async (req, res) => {
  const decision = String(req.params.decision);
  if (!['approve', 'reject'].includes(decision)) throw notFound();
  const m = req.tenant!.models;
  const l = await m.LeaveRequest.findById(oid(req.params.id, 'Leave'));
  if (!l) throw notFound('Leave request not found');
  if (l.status !== 'pending') throw conflict(`Leave is ${l.status}`);
  const staff = await m.StaffProfile.findById(l.staffId).lean();
  if (staff?.userId && String(staff.userId) === req.user!.id) throw forbidden('You cannot approve your own leave', 'SEGREGATION_OF_DUTIES');
  l.status = decision === 'approve' ? 'approved' : 'rejected';
  l.decidedBy = req.user!.id as never;
  l.decidedAt = new Date();
  await l.save();
  await audit(req, { action: `hr.leave_${decision}`, resource: 'leave', resourceId: String(l._id) });
  res.json({ success: true, data: l });
}));

/* Duty roster */
router.post('/shifts', requirePermission('hr.manage'), h(async (req, res) => {
  const body = parse(z.object({ staffId: z.string(), branchId: z.string(), department: z.string().max(80).optional(), date: z.coerce.date(), shift: z.enum(['day', 'night', 'morning', 'afternoon', 'on_call']), notes: z.string().max(200).optional() }), req.body);
  const m = req.tenant!.models;
  const day = dayRange(body.date.toISOString().slice(0, 10));
  if (await m.Shift.exists({ staffId: oid(body.staffId, 'Staff'), date: day, shift: body.shift })) throw conflict('Staff already has this shift on that date');
  const onLeave = await m.LeaveRequest.exists({ staffId: body.staffId, status: 'approved', startDate: { $lte: body.date }, endDate: { $gte: body.date } });
  if (onLeave) throw conflict('Staff member is on approved leave that day', undefined, 'STAFF_ON_LEAVE');
  const s = await m.Shift.create(body);
  res.status(201).json({ success: true, data: s });
}));

router.get('/shifts', requirePermission('hr.view'), h(async (req, res) => {
  const filter: Record<string, unknown> = { date: dayRange(req.query.from, req.query.to ?? req.query.from) };
  if (req.query.branchId) filter.branchId = oid(req.query.branchId, 'Branch');
  res.json({ success: true, data: await req.tenant!.models.Shift.find(filter).populate('staffId', 'fullName cadre department').sort({ date: 1, shift: 1 }).lean() });
}));

export default router;
