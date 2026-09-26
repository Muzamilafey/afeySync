import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { assertBranchAccess, branchFilter } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { nextNumber, oid } from '../common/helpers';
import { normalizePhone } from '../patients/patientService';
import { enqueueSms } from '../notifications/notify';
import { resolveSmsGateway } from '../../integrations/sms/gateway';
import { meta } from '../../models/meta';
import { ensureWallet, smsSegments } from './smsWallet';

/**
 * Bulk SMS: health reminders and notices to a chosen group of patients (or a list of numbers).
 * Patients who declined SMS are always left out. Every recipient becomes its own queued SMS, paid
 * from the facility's SMS wallet as it is sent; a campaign is refused up front if the wallet cannot
 * cover it.
 */
const router = Router();
router.use(authenticateTenant, requirePermission('sms.bulk'));

const MAX_RECIPIENTS = 5000;
const audienceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('patients'),
    branchId: z.string().optional(),
    visitedFrom: z.string().date().optional(),
    visitedTo: z.string().date().optional(),
    gender: z.enum(['male', 'female']).optional(),
    ageMin: z.number().int().min(0).max(130).optional(),
    ageMax: z.number().int().min(0).max(130).optional(),
    payerType: z.enum(['cash', 'sha', 'insurance', 'corporate']).optional(),
    schemeId: z.string().optional(),
  }),
  z.object({ kind: z.literal('numbers'), numbers: z.array(z.string().trim().max(20)).min(1).max(MAX_RECIPIENTS) }),
]);
const draftSchema = z.object({ message: z.string().trim().min(3).max(612), audience: audienceSchema });
type Audience = z.infer<typeof audienceSchema>;

const validPhone = (p?: string) => !!p && /^\d{9,15}$/.test(p);
/** `{firstName}` is replaced per patient; the facility name is added as the sender line. */
const render = (message: string, facility: string, firstName?: string) => `${facility}: ${message.replace(/\{firstName\}/g, firstName || 'there')}`;

async function resolveAudience(req: Request, a: Audience) {
  const m = req.tenant!.models;
  const out: Array<{ phone: string; patientId?: Types.ObjectId; firstName?: string }> = [];
  const excluded = { noConsent: 0, noPhone: 0, duplicate: 0 };
  const seen = new Set<string>();
  const add = (phone: string | undefined, rest: { patientId?: Types.ObjectId; firstName?: string } = {}) => {
    if (!validPhone(phone)) return void excluded.noPhone++;
    if (seen.has(phone!)) return void excluded.duplicate++;
    seen.add(phone!);
    out.push({ phone: phone!, ...rest });
  };
  if (a.kind === 'numbers') {
    for (const n of a.numbers) add(normalizePhone(n));
    // Typed numbers that belong to patients who declined SMS are still left out.
    const declined = await m.Patient.find({ 'consent.sms': false }).select('phone').lean();
    const blocked = new Set(declined.map((p) => normalizePhone(p.phone)).filter(Boolean));
    const kept = out.filter((r) => !blocked.has(r.phone));
    excluded.noConsent = out.length - kept.length;
    return { recipients: kept, excluded };
  }
  const filter: Record<string, unknown> = { status: 'active', walkInAccount: { $ne: true }, ...branchFilter(req, 'branchIds') };
  if (a.branchId) {
    assertBranchAccess(req, a.branchId);
    filter.branchIds = oid(a.branchId, 'Branch');
  }
  if (a.gender) filter.gender = a.gender;
  if (a.ageMin != null || a.ageMax != null) {
    const now = new Date();
    const dob: Record<string, Date> = {};
    if (a.ageMin != null) dob.$lte = new Date(now.getFullYear() - a.ageMin, now.getMonth(), now.getDate());
    if (a.ageMax != null) dob.$gt = new Date(now.getFullYear() - a.ageMax - 1, now.getMonth(), now.getDate());
    filter.dateOfBirth = dob;
  }
  if (a.visitedFrom || a.visitedTo || a.payerType || a.schemeId) {
    const vf: Record<string, unknown> = { status: { $ne: 'cancelled' }, ...branchFilter(req) };
    if (a.branchId) vf.branchId = oid(a.branchId, 'Branch');
    if (a.visitedFrom || a.visitedTo) {
      const range: Record<string, Date> = {};
      if (a.visitedFrom) range.$gte = new Date(`${a.visitedFrom}T00:00:00.000Z`);
      if (a.visitedTo) range.$lte = new Date(`${a.visitedTo}T23:59:59.999Z`);
      vf.createdAt = range;
    }
    if (a.payerType) vf['payer.type'] = a.payerType;
    if (a.schemeId) vf['payer.schemeId'] = oid(a.schemeId, 'Scheme');
    filter._id = { $in: await m.Visit.distinct('patientId', vf) };
  }
  const patients = await m.Patient.find(filter).select('firstName phone consent.sms').limit(MAX_RECIPIENTS * 2).lean();
  for (const p of patients) {
    if (p.consent?.sms === false) { excluded.noConsent++; continue; }
    add(normalizePhone(p.phone), { patientId: p._id, firstName: p.firstName });
  }
  return { recipients: out, excluded };
}

async function estimate(req: Request, body: z.infer<typeof draftSchema>) {
  const { recipients, excluded } = await resolveAudience(req, body.audience);
  const facility = req.tenant!.name;
  // The longest rendering decides the segment count (names differ in length).
  const longest = recipients.reduce((mx, r) => Math.max(mx, (r.firstName ?? '').length), 5);
  const segments = smsSegments(render(body.message, facility, 'x'.repeat(longest)));
  const credits = segments * recipients.length;
  let charged = true;
  try {
    charged = (await resolveSmsGateway(req.tenant!.id)).cfg.source === 'platform';
  } catch {
    throw new AppError(409, 'SMS_NOT_CONFIGURED', 'SMS sending is not set up for this facility yet. Contact AfeySync support.');
  }
  const wallet = charged ? await ensureWallet(req.tenant!.id).then(() => meta().SmsWallet.findOne({ tenantId: req.tenant!.id }).select('balance').lean()) : null;
  return { recipients, excluded, segments, credits, charged, balance: wallet?.balance ?? null, sample: render(body.message, facility, recipients.find((r) => r.firstName)?.firstName ?? 'Jane') };
}

router.post('/preview', h(async (req, res) => {
  const body = parse(draftSchema, req.body);
  const e = await estimate(req, body);
  res.json({ success: true, data: { recipientCount: e.recipients.length, excluded: e.excluded, segments: e.segments, credits: e.credits, charged: e.charged, balance: e.balance, enough: !e.charged || (e.balance ?? 0) >= e.credits, sample: e.sample, tooMany: e.recipients.length > MAX_RECIPIENTS } });
}));

router.post('/', h(async (req, res) => {
  const body = parse(draftSchema.extend({ name: z.string().trim().min(3).max(120), scheduledAt: z.string().datetime().optional() }), req.body);
  const runAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
  if (runAt && (runAt.getTime() < Date.now() - 60_000 || runAt.getTime() > Date.now() + 60 * 86_400_000)) throw badRequest('Schedule the SMS for a time within the next 60 days');
  const e = await estimate(req, body);
  if (!e.recipients.length) throw badRequest('No one to send to: the chosen group has no patients with a valid phone number who accept SMS');
  if (e.recipients.length > MAX_RECIPIENTS) throw badRequest(`A campaign can go to at most ${MAX_RECIPIENTS} people; narrow the group`);
  if (e.charged && (e.balance ?? 0) < e.credits) throw new AppError(402, 'INSUFFICIENT_SMS_CREDITS', `This campaign needs ${e.credits} SMS credits but the wallet has ${e.balance ?? 0}. Top up in Admin → SMS wallet.`);
  const m = req.tenant!.models;
  const a = body.audience;
  const campaign = await m.SmsCampaign.create({
    campaignNumber: await nextNumber(m, 'smscampaign', 'SMS'), name: body.name, message: body.message,
    audience: a.kind === 'patients' ? { ...a, branchId: a.branchId ? oid(a.branchId, 'Branch') : undefined, schemeId: a.schemeId ? oid(a.schemeId, 'Scheme') : undefined, visitedFrom: a.visitedFrom ? new Date(a.visitedFrom) : undefined, visitedTo: a.visitedTo ? new Date(a.visitedTo) : undefined } : { kind: 'numbers' },
    status: runAt && runAt.getTime() > Date.now() ? 'scheduled' : 'sending', scheduledAt: runAt, recipientCount: e.recipients.length, excluded: e.excluded, segments: e.segments, credits: e.credits,
    createdBy: req.user!.id, createdByName: req.user!.name,
  });
  const facility = req.tenant!.name;
  const recipients = [];
  for (const r of e.recipients) {
    const job = await enqueueSms(req.tenant!.id, `${req.tenant!.id}:campaign:${campaign._id}:${r.phone}`, r.phone, render(body.message, facility, r.firstName), { runAt, maxAttempts: 3 });
    recipients.push({ phone: r.phone, patientId: r.patientId, jobId: new Types.ObjectId(job.id) });
  }
  campaign.set('recipients', recipients);
  await campaign.save();
  await audit(req, { action: 'sms.campaign_send', resource: 'sms_campaign', resourceId: String(campaign._id), newValue: { name: body.name, recipients: e.recipients.length, credits: e.credits, scheduledAt: runAt } });
  res.status(201).json({ success: true, data: { _id: campaign._id, campaignNumber: campaign.campaignNumber, recipientCount: campaign.recipientCount, credits: campaign.credits, status: campaign.status } });
}));

/** Delivery counts come from the SMS queue: sent, waiting, or failed (e.g. invalid number, wallet empty). */
async function stats(jobIds: Types.ObjectId[]) {
  const jobs = await meta().Job.find({ _id: { $in: jobIds } }).select('status lastError').lean();
  const s = { sent: 0, pending: 0, failed: 0, cancelled: 0 };
  for (const j of jobs) {
    if (j.status === 'completed') s.sent++;
    else if (j.status === 'queued' || j.status === 'running' || j.status === 'failed') s.pending++;
    else if (j.lastError === 'Cancelled') s.cancelled++;
    else s.failed++;
  }
  return s;
}

router.get('/', h(async (req, res) => {
  const m = req.tenant!.models;
  const { page, limit, skip } = pagination(req.query, 50);
  const [rows, total] = await Promise.all([m.SmsCampaign.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), m.SmsCampaign.countDocuments()]);
  const data = await Promise.all(rows.map(async ({ recipients, ...c }) => ({ ...c, stats: await stats(recipients.map((r) => r.jobId!).filter(Boolean)) })));
  res.json({ success: true, data, meta: { page, limit, total } });
}));

router.get('/:id', h(async (req, res) => {
  const m = req.tenant!.models;
  const c = await m.SmsCampaign.findById(oid(req.params.id, 'Campaign')).lean();
  if (!c) throw notFound('Campaign not found');
  const jobs = await meta().Job.find({ _id: { $in: c.recipients.map((r) => r.jobId) } }).select('status lastError').lean();
  const byId = new Map(jobs.map((j) => [String(j._id), j]));
  const recipients = c.recipients.map((r) => { const j = byId.get(String(r.jobId)); return { phone: (r.phone ?? '').replace(/\d(?=\d{3})/g, '*'), patientId: r.patientId, status: j?.status === 'completed' ? 'sent' : j?.status === 'dead' ? (j.lastError === 'Cancelled' ? 'cancelled' : 'failed') : 'pending', error: j?.status === 'dead' && j.lastError !== 'Cancelled' ? j.lastError : undefined }; });
  res.json({ success: true, data: { ...c, recipients, stats: await stats(c.recipients.map((r) => r.jobId!).filter(Boolean)) } });
}));

/** Stops messages that have not gone out yet. Sent messages cannot be recalled. */
router.post('/:id/cancel', h(async (req, res) => {
  const m = req.tenant!.models;
  const c = await m.SmsCampaign.findById(oid(req.params.id, 'Campaign'));
  if (!c) throw notFound('Campaign not found');
  if (c.status === 'cancelled') throw conflict('This campaign is already cancelled');
  const r = await meta().Job.updateMany({ _id: { $in: c.recipients.map((x) => x.jobId) }, status: 'queued' }, { status: 'dead', lastError: 'Cancelled' });
  c.status = 'cancelled';
  c.cancelledByName = req.user!.name;
  c.cancelledAt = new Date();
  await c.save();
  await audit(req, { action: 'sms.campaign_cancel', resource: 'sms_campaign', resourceId: String(c._id), newValue: { stopped: r.modifiedCount } });
  res.json({ success: true, data: { stopped: r.modifiedCount } });
}));

export default router;
