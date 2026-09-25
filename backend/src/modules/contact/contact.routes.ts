import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError } from '../../utils/errors';
import { notifyEmail } from '../notifications/notify';
import { logger } from '../../utils/logger';

/**
 * The website's contact form. Messages are emailed to the platform's own inbox (CONTACT_EMAIL, else
 * SUPPORT_EMAIL) and never to an address typed into the form, so the form cannot be used to send mail
 * to third parties. Nothing is stored beyond the email job.
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
  if (!inbox) throw new AppError(503, 'CONTACT_UNAVAILABLE', 'Messages cannot be sent right now. Please call or email us instead.');
  const topic = TOPIC_LABEL[body.topic];
  const text = [
    `New message from the AfeySync website.`,
    [`Topic: ${topic}`, `Name: ${body.name}`, `Email: ${body.email}`, `Phone: ${body.phone ?? '-'}`, `Facility: ${body.facility ?? '-'}`].join('\n'),
    body.message,
    `Reply to ${body.email} to answer.`,
  ].join('\n\n');
  await notifyEmail(null, `contact:${crypto.randomUUID()}`, inbox, `Website enquiry: ${topic} from ${body.name}`, text);
  logger.info({ topic: body.topic }, 'Website contact message queued');
  res.status(202).json({ success: true, data: { received: true } });
}));
