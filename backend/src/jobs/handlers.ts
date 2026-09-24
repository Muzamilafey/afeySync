import { registerHandler, PermanentJobError } from './queue';
import { resolveIntegration } from '../modules/integrations/integrationConfigService';
import { sendSms } from '../integrations/africastalking/smsService';
import { sendMail } from '../integrations/smtp/smtpService';
import { processCallbackEvent } from '../modules/callbacks/callbacks.routes';
import { AppError } from '../utils/errors';

const permanentIfConfig = (err: unknown) => {
  if (err instanceof AppError && ['INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY', 'SMS_AUTH_ERROR'].includes(err.code)) throw new PermanentJobError(err.message);
  throw err;
};

export function registerJobHandlers() {
  registerHandler('SMS', async (payload, job) => {
    const cfg = await resolveIntegration('africastalking', job.tenantId ?? null).catch(permanentIfConfig);
    const to = String(payload.to ?? '');
    if (!/^\+?\d{9,15}$/.test(to)) throw new PermanentJobError('Invalid recipient phone number');
    const recipients = await sendSms(cfg!, [to.startsWith('+') ? to : `+${to}`], String(payload.message ?? '').slice(0, 918));
    return { recipients };
  });

  registerHandler('EMAIL', async (payload, job) => {
    const cfg = await resolveIntegration('smtp', job.tenantId ?? null).catch(permanentIfConfig);
    return sendMail(cfg!, { to: String(payload.to), subject: String(payload.subject), text: String(payload.text ?? ''), html: payload.html ? String(payload.html) : undefined });
  });

  registerHandler('SHA_CALLBACK', async (payload) => {
    await processCallbackEvent(String(payload.eventId));
    return { ok: true };
  });
}
