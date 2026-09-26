import { AppError } from '../../utils/errors';
import { resolveIntegration, type ResolvedIntegration } from '../../modules/integrations/integrationConfigService';

export type PromptGateway = { kind: 'daraja'; cfg: ResolvedIntegration } | { kind: 'payhero'; cfg: ResolvedIntegration };

async function tryResolve(provider: Parameters<typeof resolveIntegration>[0], tenantId: string | null) {
  try {
    return await resolveIntegration(provider, tenantId);
  } catch (err) {
    if (err instanceof AppError && err.status === 503) return null;
    throw err;
  }
}

/**
 * Which service sends an M-Pesa prompt. A facility uses its own Daraja app and/or its own Pay Hero account; the
 * platform owner uses its collections channels for subscriptions and SMS credits. Pay Hero set to "always" wins;
 * set to "backup" it is used only when Daraja is not set up.
 */
export async function promptGateway(scope: 'facility' | 'platform', tenantId: string | null): Promise<PromptGateway> {
  const [daraja, payhero] = await Promise.all(
    scope === 'facility' ? [tryResolve('mpesa', tenantId), tryResolve('payhero', tenantId)] : [tryResolve('mpesa_billing', null), tryResolve('payhero_billing', null)],
  );
  if (payhero && (payhero.settings.role !== 'backup' || !daraja)) return { kind: 'payhero', cfg: payhero };
  if (daraja) return { kind: 'daraja', cfg: daraja };
  throw new AppError(
    503,
    'MPESA_NOT_CONFIGURED',
    scope === 'facility'
      ? 'M-Pesa prompts are not set up for this facility. An administrator can set up M-Pesa (Daraja) or Pay Hero under Administration → Integrations.'
      : 'M-Pesa payments are not set up yet. Contact AfeySync.',
  );
}

/** A still-pending prompt older than this is looked up with the gateway rather than waited on. */
export const QUERY_AFTER_MS = 20_000;
