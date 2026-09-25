import nodemailer from 'nodemailer';
import type { ResolvedIntegration } from '../../modules/integrations/integrationConfigService';

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
  const from = `"${cfg.settings.fromName || 'AfeySync'}" <${cfg.settings.fromEmail}>`;
  const info = await transport.sendMail({ from, ...msg });
  return { messageId: info.messageId };
}
