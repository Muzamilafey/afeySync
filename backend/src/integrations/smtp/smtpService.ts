import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { resolveIntegration, type ResolvedIntegration } from '../../modules/integrations/integrationConfigService';

export function createTransport(cfg: ResolvedIntegration) {
  const enc = (cfg.settings.encryption || 'starttls').toLowerCase();
  return nodemailer.createTransport({
    host: cfg.settings.host,
    port: Number(cfg.settings.port) || 587,
    secure: enc === 'ssl',
    requireTLS: enc === 'starttls',
    auth: cfg.secrets.username ? { user: cfg.secrets.username, pass: cfg.secrets.password } : undefined,
    connectionTimeout: 15_000,
  });
}

export async function sendMail(cfg: ResolvedIntegration, msg: { to: string; subject: string; text: string; html?: string; attachments?: Array<{ filename: string; content: Buffer; contentType?: string }> }) {
  const transport = createTransport(cfg);
  if (!cfg.settings.host || !cfg.settings.fromEmail) throw new AppError(503, 'SMTP_NOT_CONFIGURED', 'SMTP host or sender address is missing');
  const from = `"${cfg.settings.fromName || 'AfeySync'}" <${cfg.settings.fromEmail}>`;
  const info = await transport.sendMail({ from, ...msg });
  return { messageId: info.messageId };
}

/** SMTP settings from environment variables (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_ENCRYPTION, SMTP_FROM). */
export function envSmtpConfig(): ResolvedIntegration | null {
  if (!env.SMTP_HOST) return null;
  // SMTP_FROM may be "Name <address>" or just an address.
  const from = (env.SMTP_FROM || env.SMTP_USERNAME || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return {
    provider: 'smtp',
    source: 'platform',
    configId: 'env',
    environment: 'production',
    settings: { host: env.SMTP_HOST, port: env.SMTP_PORT || '587', encryption: env.SMTP_ENCRYPTION || (env.SMTP_PORT === '465' ? 'ssl' : 'starttls'), fromEmail: m ? m[2].trim() : from, fromName: m?.[1]?.trim() || 'AfeySync' },
    secrets: { username: env.SMTP_USERNAME ?? '', password: env.SMTP_PASSWORD ?? '' },
  };
}

/**
 * Which mail server to use: the facility's own SMTP when it has one enabled; otherwise the platform
 * SMTP from Owner → Integrations; otherwise the SMTP_* environment variables. Security emails (sign-in
 * codes, password resets) must never fail just because a facility has not set up its own email.
 */
export async function resolveMailConfig(tenantId: string | null): Promise<ResolvedIntegration> {
  if (tenantId) {
    try {
      return await resolveIntegration('smtp', tenantId);
    } catch (err) {
      if (!(err instanceof AppError) || !['INTEGRATION_NOT_ENABLED_FOR_FACILITY', 'INTEGRATION_DISABLED'].includes(err.code)) throw err;
    }
  }
  try {
    return await resolveIntegration('smtp', null);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'INTEGRATION_DISABLED') throw err;
    const fromEnv = envSmtpConfig();
    if (fromEnv) return fromEnv;
    throw new AppError(503, 'INTEGRATION_DISABLED', 'Email is not configured: set up SMTP in Owner → Integrations, or set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM in the API .env.');
  }
}
