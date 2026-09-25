import { IntegrationSecretService } from '../integrations/secretService';
import type { TenantModels } from '../../models/tenant';
import type { Types } from 'mongoose';
import { enqueueJob } from '../../jobs/queue';
import { logger } from '../../utils/logger';
import { meta } from '../../models/meta';
import { renderEmail, renderPlainEmail, supportLine, type EmailContent } from './emailLayout';

export const fmtEAT = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) + ' EAT';

export type NotifyEvent = 'Appointment' | 'Payment' | 'Lab Result' | 'Prescription' | 'Claim' | 'Authorization' | 'Preauthorization' | 'Intervention' | 'Discharge' | 'Password' | 'Security' | 'System';

/**
 * Central notification engine: in-app for staff; SMS/email for patients via the durable job queue.
 * Channel failures never break the clinical transaction that triggered them.
 */
export async function notifyStaff(m: TenantModels, userIds: Array<string | Types.ObjectId | null | undefined>, n: { event: NotifyEvent; title: string; body?: string; link?: string; branchId?: string | Types.ObjectId }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    await m.Notification.insertMany(ids.map((userId) => ({ userId, branchId: n.branchId, event: n.event, title: n.title, body: n.body, link: n.link })));
  } catch (err) {
    logger.warn({ err }, 'in-app notification failed');
  }
}

export async function notifyPatientSms(tenant: { id: string; name: string }, patient: { _id: unknown; phone?: string | null; consent?: { sms?: boolean | null } | null }, key: string, message: string) {
  if (!patient.phone || patient.consent?.sms === false) return;
  try {
    await enqueueJob('SMS', `${tenant.id}:${key}`, { to: patient.phone, message: `${tenant.name}: ${message}`.slice(0, 459) }, tenant.id);
  } catch (err) {
    logger.warn({ err }, 'patient SMS enqueue failed');
  }
}

export async function notifyEmail(tenantId: string | null, key: string, to: string, subject: string, text: string, html?: string, opts: { sensitive?: boolean; code?: EmailContent['code']; title?: string; intro?: string; notice?: string } = {}) {
  try {
    // Every email goes out in the AfeySync design; callers without their own HTML get it from their text.
    if (!html) {
      const facility = tenantId ? await meta().Tenant.findById(tenantId).select('name branding.displayName').lean().catch(() => null) : null;
      const facilityName = facility ? facility.branding?.displayName || facility.name : null;
      html = opts.code
        ? renderEmail({ title: opts.title ?? subject, facility: facilityName, paragraphs: opts.intro ? [opts.intro] : [], code: opts.code, notice: [opts.notice, supportLine()].filter(Boolean).join(' ') || null, signOff: facilityName ? `${facilityName}, via AfeySync HMIS` : null })
        : renderPlainEmail(subject, text, facilityName);
    }
    // Sensitive bodies (sign-in codes) are stored encrypted in the queue and wiped once sent.
    const body = opts.sensitive ? { textEnc: IntegrationSecretService.encrypt(text), ...(html ? { htmlEnc: IntegrationSecretService.encrypt(html) } : {}) } : html ? { text, html } : { text };
    await enqueueJob('EMAIL', `${tenantId ?? 'platform'}:${key}`, { to, subject, ...body }, tenantId ?? undefined);
  } catch (err) {
    logger.warn({ err }, 'email enqueue failed');
  }
}

/**
 * Queues an SMS. The facility's SMS wallet pays for it when it is sent. `critical` (sign-in codes) may use
 * the small wallet reserve; `sensitive` stores the text encrypted and wipes it after sending.
 */
export async function enqueueSms(tenantId: string | null, key: string, to: string, message: string, opts: { critical?: boolean; sensitive?: boolean; maxAttempts?: number; runAt?: Date } = {}) {
  const body = opts.sensitive ? { messageEnc: IntegrationSecretService.encrypt(message) } : { message };
  return enqueueJob('SMS', key, { to, ...body, ...(opts.critical ? { critical: true } : {}) }, tenantId ?? undefined, { maxAttempts: opts.maxAttempts, runAt: opts.runAt });
}
