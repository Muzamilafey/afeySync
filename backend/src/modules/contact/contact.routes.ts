import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse } from '../../utils/validate';
import { notFound } from '../../utils/errors';
import { isValidObjectId } from 'mongoose';
import { meta } from '../../models/meta';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { platformAudit } from '../audit/auditService';
import { notifyEmail } from '../notifications/notify';
import { logger } from '../../utils/logger';

/**
 * The website's contact form. Every message is kept for the owner portal's Messages inbox, and also emailed to
 * the platform's own inbox (CONTACT_EMAIL, else SUPPORT_EMAIL) when one is set. Mail never goes to an address
 * typed into the form, so the form cannot be used to send mail to third parties.
 */
export const TOPICS = ['demo', 'pricing', 'support', 'sha', 'partnership', 'other'] as const;
const TOPIC_LABEL: Record<(typeof TOPICS)[number], string> = { demo: 'Request a demo', pricing: 'Pricing', support: 'Support', sha: 'SHA / insurance', partnership: 'Partnership', other: 'Other' };

const oneLine = (max: number) => z.string().trim().max(max).regex(/^[^\r\n]*$/, 'Use a single line');
const schema = z.object({
  name: oneLine(120).min(2, 'Enter your name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160),
  phone: oneLine(30).regex(/^[0-9+()\s-]*$/, 'Enter a valid phone number').optional().or(z.literal('').transform(() => undefined)),
  facility: oneLine(160).optional().or(z.literal('').transform(() => undefined)),
  topic: z.enum(TOPICS).default('other'),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(3000),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(200).optional(),
});

const contactLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 5, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many messages. Please try again later or call us.' } } });

export const contactRouter = Router();

contactRouter.post('/contact', contactLimiter, h(async (req, res) => {
  const body = parse(schema, req.body);
  // Bots get the same answer as people, so they cannot tell they were caught.
  if (body.website) return res.status(202).json({ success: true, data: { received: true } });
  const inbox = env.CONTACT_EMAIL ?? env.SUPPORT_EMAIL;
  const topic = TOPIC_LABEL[body.topic];
  const saved = await meta().ContactMessage.create({ name: body.name, email: body.email, phone: body.phone, facility: body.facility, topic: body.topic, message: body.message, emailed: Boolean(inbox) });
  if (!inbox) {
    logger.info({ topic: body.topic }, 'Website contact message saved (no email inbox configured)');
    return res.status(202).json({ success: true, data: { received: true } });
  }
  const text = [
    `New message from the AfeySync website.`,
    [`Topic: ${topic}`, `Name: ${body.name}`, `Email: ${body.email}`, `Phone: ${body.phone ?? '-'}`, `Facility: ${body.facility ?? '-'}`].join('\n'),
    body.message,
    `Reply to ${body.email} to answer.`,
  ].join('\n\n');
  await notifyEmail(null, `contact:${String(saved._id)}`, inbox, `Website enquiry: ${topic} from ${body.name}`, text);
  logger.info({ topic: body.topic }, 'Website contact message queued');
  res.status(202).json({ success: true, data: { received: true } });
}));

/* ------------------------------------------------------------------ Owner portal: Messages inbox */
export const contactOwnerRouter = Router();
contactOwnerRouter.use(authenticatePlatform, requirePermission('owner.support'));

const STATUSES = ['new', 'read', 'replied', 'archived'] as const;

contactOwnerRouter.get('/', h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, 100);
  const filter: Record<string, unknown> = {};
  const status = String(req.query.status ?? '');
  if ((STATUSES as readonly string[]).includes(status)) filter.status = status;
  else filter.status = { $ne: 'archived' };
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 80)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { facility: rx }, { phone: rx }, { message: rx }];
  }
  const { ContactMessage } = meta();
  const [rows, total, unread] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ status: 'new' }),
  ]);
  res.json({ success: true, data: rows.map((m) => ({ ...m, topicLabel: TOPIC_LABEL[m.topic as (typeof TOPICS)[number]] ?? 'Other' })), meta: { page, limit, total, unread } });
}));

contactOwnerRouter.get('/unread', h(async (_req, res) => {
  res.json({ success: true, data: { unread: await meta().ContactMessage.countDocuments({ status: 'new' }) } });
}));

contactOwnerRouter.patch('/:id', h(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Message not found');
  const body = parse(z.object({ status: z.enum(STATUSES).optional(), note: z.string().trim().max(2000).optional() }), req.body);
  const m = await meta().ContactMessage.findById(req.params.id);
  if (!m) throw notFound('Message not found');
  const before = { status: m.status };
  if (body.status) {
    m.status = body.status;
    if (body.status !== 'new') { m.handledByName = req.platformUser!.name; m.handledAt = new Date(); }
  }
  if (body.note !== undefined) m.note = body.note || undefined;
  await m.save();
  await platformAudit(req, { action: 'contact_message.update', resource: 'contact_message', resourceId: String(m._id), oldValue: before, newValue: { status: m.status, noted: body.note !== undefined } });
  res.json({ success: true, data: m });
}));
