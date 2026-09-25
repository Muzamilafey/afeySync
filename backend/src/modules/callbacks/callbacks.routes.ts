import { env } from '../../config/env';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { h } from '../../utils/asyncHandler';
import { meta } from '../../models/meta';
import { hmacSha256, safeEqual, sha256 } from '../../utils/crypto';
import { IntegrationSecretService } from '../integrations/secretService';
import { loadTenant } from '../tenants/tenantLoader';
import { pick } from '../../integrations/hie/normalize';
import { logger } from '../../utils/logger';
import { enqueueJob } from '../../jobs/queue';

/**
 * Public HIE status-callback receiver: POST /api/v1/{sha|dha}/callbacks/:token
 *
 *   Verify (secret path token + optional HMAC) → identify tenant → dedupe → persist event →
 *   match claim/preauth/authorization → update status → audit → notify.
 *
 * Unverified callbacks are rejected and never touch tenant data.
 */
const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

const STATUS_MAP: Array<[RegExp, string]> = [
  [/intervention|query|clarif|more.?info/i, 'intervention_required'],
  [/reject|declin|denied/i, 'rejected'],
  [/paid|settled/i, 'paid'],
  [/approv|accept|authori[sz]ed/i, 'approved'],
  [/pend|review|process|submitted|received/i, 'pending'],
  [/cancel|void|withdraw/i, 'cancelled'],
];

export function mapExternalStatus(s?: string): string | undefined {
  if (!s) return undefined;
  return STATUS_MAP.find(([re]) => re.test(s))?.[1];
}

export async function processCallbackEvent(eventId: string) {
  const { CallbackEvent } = meta();
  const ev = await CallbackEvent.findById(eventId);
  if (!ev || !ev.tenantId) return;
  const tenant = await loadTenant(String(ev.tenantId), { requireActive: false });
  const m = tenant.models;
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const refs = [ev.externalReference, pick(payload, 'reference', 'claim_reference', 'preauth_reference', 'authorization_reference', 'claim_id', 'preauth_id', 'authorization_id', 'id', 'data.reference', 'data.id')].filter(Boolean) as string[];
  const tx = refs.length ? await m.ShaTransaction.findOne({ $or: [{ externalReference: { $in: refs } }, { reference: { $in: refs } }] }) : null;
  if (!tx) {
    ev.processing = { state: 'unmatched', processedAt: new Date(), error: 'No matching claim/preauthorization/authorization' } as never;
    await ev.save();
    return;
  }
  const mapped = mapExternalStatus(ev.status ?? undefined);
  const before = tx.status;
  if (mapped && mapped !== tx.status) {
    tx.status = mapped as never;
    tx.statusHistory.push({ status: mapped, at: new Date(), source: `callback:${ev.provider}`, note: ev.status ?? undefined });
  }
  const approved = Number(pick(payload, 'approved_amount', 'approvedAmount', 'data.approved_amount'));
  const paid = Number(pick(payload, 'paid_amount', 'paidAmount', 'data.paid_amount'));
  if (!Number.isNaN(approved)) tx.set('amounts.approved', approved);
  if (!Number.isNaN(paid)) tx.set('amounts.paid', paid);
  tx.lastResponse = payload;
  await tx.save();
  await m.AuditLog.create({ actorType: 'integration', action: 'sha.callback.applied', resource: 'sha_transaction', resourceId: String(tx._id), oldValue: { status: before }, newValue: { status: tx.status, externalStatus: ev.status } });
  if (tx.createdBy) await m.Notification.create({ userId: tx.createdBy, branchId: tx.branchId, event: tx.kind === 'claim' ? 'Claim' : tx.kind === 'preauthorization' ? 'Preauthorization' : 'Authorization', title: `${tx.reference}: ${tx.status.replace('_', ' ')}`, body: `SHA status update received (${ev.status ?? 'status change'})`, link: `/sha/transactions/${tx._id}` });
  ev.processing = { state: 'processed', processedAt: new Date(), matchedResource: 'sha_transaction', matchedId: tx._id } as never;
  await ev.save();
}

function verify(req: Request, ep: { hmacHeader?: string | null; hmacSecret?: { ciphertext?: string | null } | null }) {
  if (!ep.hmacSecret?.ciphertext) return { ok: true, method: 'path_token' };
  const header = req.get(ep.hmacHeader || 'x-signature') ?? '';
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
  const expected = hmacSha256(IntegrationSecretService.decrypt(ep.hmacSecret.ciphertext), raw);
  const provided = header.replace(/^sha256=/, '').toLowerCase();
  return { ok: provided.length > 0 && safeEqual(provided, expected), method: 'path_token+hmac' };
}

for (const provider of ['sha', 'dha'] as const) {
  router.post(
    `/${provider}/callbacks/:token`,
    h(async (req, res) => {
      if (env.DHA_ENABLE_CALLBACKS !== 'true') return res.status(503).json({ success: false, error: { code: 'CALLBACKS_DISABLED', message: 'Status callbacks are disabled on this deployment' } });
      const token = String(req.params.token ?? '');
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown callback endpoint' } });
      const { CallbackEndpoint, CallbackEvent } = meta();
      const ep = await CallbackEndpoint.findOne({ tokenHash: sha256(token), provider, active: true });
      if (!ep) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown callback endpoint' } });
      const v = verify(req, ep);
      if (!v.ok) {
        logger.warn({ endpoint: String(ep._id) }, 'Callback signature verification failed');
        return res.status(401).json({ success: false, error: { code: 'CALLBACK_VERIFICATION_FAILED', message: 'Signature verification failed' } });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(body);
      const eventId = pick(body, 'event_id', 'eventId', 'id', 'notification_id');
      const dedupeKey = sha256(`${ep._id}:${eventId ?? raw}`);
      const existing = await CallbackEvent.findOne({ dedupeKey }).select('_id').lean();
      if (existing) return res.status(200).json({ success: true, duplicate: true });
      const ev = await CallbackEvent.create({
        provider,
        tenantId: ep.tenantId,
        endpointId: ep._id,
        dedupeKey,
        eventType: pick(body, 'event', 'event_type', 'type', 'operation'),
        resourceType: pick(body, 'resource_type', 'resourceType', 'entity'),
        externalReference: pick(body, 'reference', 'claim_reference', 'preauth_reference', 'authorization_reference', 'id'),
        status: pick(body, 'status', 'claim_status', 'state', 'data.status'),
        verified: true,
        verificationMethod: v.method,
        payload: body,
        sourceIp: req.ip,
      });
      ep.lastEventAt = new Date();
      await ep.save();
      try {
        await processCallbackEvent(String(ev._id));
      } catch (err) {
        logger.error({ err }, 'Callback processing failed; queued for retry');
        await CallbackEvent.updateOne({ _id: ev._id }, { 'processing.state': 'failed', 'processing.error': (err as Error).message.slice(0, 300) });
        await enqueueJob('SHA_CALLBACK', `callback:${ev._id}`, { eventId: String(ev._id) }, ep.tenantId ? String(ep.tenantId) : undefined);
      }
      // Acknowledge quickly; processing state is tracked on the event.
      res.status(200).json({ success: true });
    }),
  );
}

export default router;
