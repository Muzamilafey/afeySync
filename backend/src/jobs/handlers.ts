import { meta } from '../models/meta';
import { IntegrationSecretService } from '../modules/integrations/secretService';
import { creditWallet, debitWallet, smsSegments } from '../modules/sms/smsWallet';
import { registerHandler, PermanentJobError } from './queue';
import { resolveIntegration } from '../modules/integrations/integrationConfigService';
import { resolveSmsGateway, sendSmsVia } from '../integrations/sms/gateway';
import { resolveMailConfig, sendMail } from '../integrations/smtp/smtpService';
import { processCallbackEvent } from '../modules/callbacks/callbacks.routes';
import { AppError } from '../utils/errors';
import { loadTenant } from '../modules/tenants/tenantLoader';
import { DHASharedHealthRecordService } from '../integrations/hie/services';

const permanentIfConfig = (err: unknown) => {
  if (err instanceof AppError && ['INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY', 'SMS_AUTH_ERROR', 'SMTP_NOT_CONFIGURED'].includes(err.code)) throw new PermanentJobError(err.message);
  throw err;
};

export function registerJobHandlers() {
  registerHandler('SMS', async (payload, job) => {
    const to = String(payload.to ?? '');
    if (!/^\+?\d{9,15}$/.test(to)) throw new PermanentJobError('Invalid recipient phone number');
    const message = (payload.messageEnc ? IntegrationSecretService.decrypt(payload.messageEnc as never) : String(payload.message ?? '')).slice(0, 918);
    const tenantId = job.tenantId ? String(job.tenantId) : null;
    const { gateway, cfg } = (await resolveSmsGateway(tenantId).catch(permanentIfConfig))!;
    // Facility SMS through the platform gateway is paid from the facility's SMS wallet (own accounts are not charged).
    const charged = !!tenantId && cfg.source === 'platform';
    const credits = smsSegments(message);
    const attemptKey = `sms:${job.id}:${job.attempts}`;
    if (charged && (await debitWallet(tenantId!, credits, attemptKey, { critical: payload.critical === true, jobId: job.id, note: `SMS to ${to.replace(/\d(?=\d{3})/g, '*')}` })) === null) {
      throw new PermanentJobError('The SMS wallet is empty. Top up in Admin → SMS wallet to send SMS again.');
    }
    let result;
    try {
      result = await sendSmsVia(gateway, cfg, to, message);
    } catch (err) {
      if (charged) await creditWallet(tenantId!, credits, 'refund', `refund:${attemptKey}`, { jobId: job.id, note: 'SMS not sent: credits returned' });
      throw err;
    }
    if (payload.messageEnc) await meta().Job.updateOne({ _id: job.id }, { $unset: { 'payload.messageEnc': '' } });
    return { gateway, result, credits: charged ? credits : 0 };
  });

  registerHandler('EMAIL', async (payload, job) => {
    const cfg = await resolveMailConfig(job.tenantId ?? null).catch(permanentIfConfig);
    const text = payload.textEnc ? IntegrationSecretService.decrypt(payload.textEnc as never) : String(payload.text ?? '');
    const html = payload.htmlEnc ? IntegrationSecretService.decrypt(payload.htmlEnc as never) : payload.html ? String(payload.html) : undefined;
    const sent = await sendMail(cfg!, { to: String(payload.to), subject: String(payload.subject), text, html, attachments: Array.isArray(payload.attachments) ? (payload.attachments as Array<{ filename: string; contentBase64: string; contentType?: string }>).map((a) => ({ filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType })) : undefined });
    if (payload.textEnc) await meta().Job.updateOne({ _id: job.id }, { $unset: { 'payload.textEnc': '', 'payload.htmlEnc': '' } });
    return sent;
  });

  /** FHIR outbox → DHA Shared Health Record. Configuration problems park the entry as "blocked". */
  registerHandler('FHIR_SYNC', async (payload, job) => {
    const tenant = await loadTenant(job.tenantId!, { requireActive: false });
    const entry = await tenant.models.FhirOutbox.findById(String(payload.outboxId));
    if (!entry) throw new PermanentJobError('Outbox entry not found');
    if (entry.status === 'sent') return { alreadySent: true };
    entry.attempts = (entry.attempts ?? 0) + 1;
    try {
      const res = (await DHASharedHealthRecordService.write({ tenantId: tenant.id }, entry.payload, entry.idempotencyKey)) as Record<string, unknown> | null;
      entry.status = 'sent';
      entry.sentAt = new Date();
      entry.externalId = res && typeof res === 'object' ? String(res.id ?? '') || undefined : undefined;
      entry.lastError = undefined;
      await entry.save();
      return { sent: true };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'ERROR';
      const permanent = ['INTEGRATION_OPERATION_NOT_CONFIGURED', 'INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY', 'DHA_VALIDATION_ERROR', 'DHA_AUTH_ERROR', 'DHA_DUPLICATE'].includes(code);
      entry.status = permanent ? 'blocked' : 'failed';
      entry.lastError = `${code}: ${(err as Error).message}`.slice(0, 500);
      await entry.save();
      if (permanent) throw new PermanentJobError(entry.lastError);
      throw err;
    }
  });

  registerHandler('SHA_CALLBACK', async (payload) => {
    await processCallbackEvent(String(payload.eventId));
    return { ok: true };
  });
}
