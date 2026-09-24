import type { TenantModels } from '../../models/tenant';
import type { Types } from 'mongoose';
import { enqueueJob } from '../../jobs/queue';
import { logger } from '../../utils/logger';

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

export async function notifyEmail(tenantId: string | null, key: string, to: string, subject: string, text: string) {
  try {
    await enqueueJob('EMAIL', `${tenantId ?? 'platform'}:${key}`, { to, subject, text }, tenantId ?? undefined);
  } catch (err) {
    logger.warn({ err }, 'email enqueue failed');
  }
}
