import { meta } from '../../models/meta';
import { resolveIntegration, type ResolvedIntegration } from '../../modules/integrations/integrationConfigService';
import { AppError } from '../../utils/errors';
import * as africastalking from '../africastalking/smsService';
import * as talksasa from '../talksasa/smsService';

export type SmsGateway = 'africastalking' | 'talksasa';
const LABEL: Record<SmsGateway, string> = { africastalking: "Africa's Talking", talksasa: 'Talksasa' };
const CONFIG_ERRORS = ['INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY'];

/**
 * Picks the SMS gateway for a facility (or the platform when tenantId is null). The facility's choice
 * set by the owner wins; "auto" uses Africa's Talking and falls back to Talksasa when Africa's Talking
 * is not set up. Falling back happens only for configuration, never after a send attempt, so a
 * message is never sent twice.
 */
export async function resolveSmsGateway(tenantId: string | null): Promise<{ gateway: SmsGateway; cfg: ResolvedIntegration }> {
  let order: SmsGateway[] = ['africastalking', 'talksasa'];
  if (tenantId) {
    const t = await meta().Tenant.findById(tenantId).select('smsGateway').lean();
    if (t?.smsGateway === 'talksasa') order = ['talksasa'];
    else if (t?.smsGateway === 'africastalking') order = ['africastalking'];
  }
  let last: unknown;
  for (const gateway of order) {
    try {
      return { gateway, cfg: await resolveIntegration(gateway, tenantId) };
    } catch (err) {
      if (!(err instanceof AppError) || !CONFIG_ERRORS.includes(err.code)) throw err;
      last = err;
    }
  }
  if (order.length === 1 && last instanceof AppError) throw new AppError(503, last.code, `${LABEL[order[0]]} SMS is selected for this facility but is not available: ${last.message}`);
  throw new AppError(503, 'INTEGRATION_DISABLED', "SMS is not set up: enable Africa's Talking or Talksasa in Owner → Integrations and for this facility.");
}

export async function sendSmsVia(gateway: SmsGateway, cfg: ResolvedIntegration, to: string, message: string) {
  if (gateway === 'talksasa') return talksasa.sendSms(cfg, [to], message);
  return africastalking.sendSms(cfg, [to.startsWith('+') ? to : `+${to}`], message);
}
