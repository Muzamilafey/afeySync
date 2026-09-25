import type { Model } from 'mongoose';
import { meta } from '../../models/meta';
import { resolveMailConfig } from '../../integrations/smtp/smtpService';
import { randomToken, sha256 } from '../../utils/crypto';
import { notifyEmail } from '../notifications/notify';
import { publicBranding } from '../branding/brandingService';

/**
 * Account emails for new users and administrator resets. They carry the sign-in address, the user's
 * email and a single-use link to choose their own password. Passwords are never emailed.
 */
export const WELCOME_LINK_HOURS = 72;
export const RESET_LINK_HOURS = 24;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface AccountEmailInput {
  tenantId: string;
  PasswordReset: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  user: { _id: unknown; name: string; email: string };
  /** The facility's own address, e.g. https://famzahra.afeysync.com */
  origin: string;
  kind: 'welcome' | 'admin_reset';
  roleNames?: string[];
  byName?: string;
}

/** Whether email can currently be sent for this facility (facility SMTP, platform SMTP, or the API .env). */
export async function emailConfigured(tenantId: string) {
  try {
    await resolveMailConfig(tenantId);
    return true;
  } catch {
    return false;
  }
}

export async function sendAccountEmail(i: AccountEmailInput): Promise<{ emailed: boolean }> {
  const tenant = await meta().Tenant.findById(i.tenantId).select('name slug branding').lean();
  const brand = tenant ? publicBranding(tenant) : { name: 'AfeySync', primaryColor: null };
  const color = brand.primaryColor ?? '#0b8a72';
  const hours = i.kind === 'welcome' ? WELCOME_LINK_HOURS : RESET_LINK_HOURS;

  // Earlier unused links for this user stop working when a new one is sent.
  await i.PasswordReset.updateMany({ userId: i.user._id, usedAt: null }, { usedAt: new Date() });
  const token = randomToken(32);
  await i.PasswordReset.create({ userId: i.user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000), purpose: i.kind });
  const setLink = `${i.origin}/reset-password?token=${token}&welcome=${i.kind === 'welcome' ? 1 : 0}`;
  const loginLink = `${i.origin}/login`;
  const address = i.origin.replace(/^https?:\/\//, '');
  const roles = i.roleNames?.length ? i.roleNames.join(', ') : null;

  const subject = i.kind === 'welcome' ? `Welcome to ${brand.name} on AfeySync` : `${brand.name}: your password was reset`;
  const intro =
    i.kind === 'welcome'
      ? `${i.byName ? `${i.byName} has` : 'An administrator has'} created your AfeySync account at ${brand.name}.`
      : `${i.byName ? `${i.byName} has` : 'An administrator has'} reset the password for your AfeySync account at ${brand.name}.`;

  const text = [
    `Hello ${i.user.name},`,
    '',
    intro,
    '',
    `Sign-in address: ${loginLink}`,
    `Your email (username): ${i.user.email}`,
    ...(roles ? [`Role: ${roles}`] : []),
    '',
    `Choose your password here (the link works once and expires in ${hours} hours):`,
    setLink,
    '',
    'If your administrator gave you a temporary password instead, sign in with it and you will be asked to choose a new password straight away.',
    '',
    'Never share your password. AfeySync staff will never ask for it.',
    i.kind === 'admin_reset' ? 'If you did not expect this, contact your administrator immediately.' : '',
    '',
    `— ${brand.name}, powered by AfeySync`,
  ].join('\n');

  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#64748b;width:150px">${esc(k)}</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${v}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${color};padding:20px 24px;color:#ffffff;font-size:20px;font-weight:700">${esc(brand.name)}</td></tr>
<tr><td style="padding:24px;color:#0f172a;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">Hello ${esc(i.user.name)},</p>
<p style="margin:0 0 16px">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;font-size:14px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">
${row('Sign-in address', `<a href="${esc(loginLink)}" style="color:${color}">${esc(address)}</a>`)}
${row('Your email (username)', esc(i.user.email))}
${roles ? row('Role', esc(roles)) : ''}
</table>
<p style="margin:0 0 16px"><a href="${esc(setLink)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Choose your password</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#475569">The button works once and expires in ${hours} hours. If your administrator gave you a temporary password instead, sign in with it and you will be asked to choose a new one straight away.</p>
<p style="margin:0;font-size:13px;color:#475569">Never share your password. AfeySync staff will never ask for it.${i.kind === 'admin_reset' ? ' If you did not expect this email, contact your administrator immediately.' : ''}</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:center">${esc(brand.name)} · powered by AfeySync</td></tr>
</table></td></tr></table></body></html>`;

  await notifyEmail(i.tenantId, `account:${i.kind}:${String(i.user._id)}:${sha256(token).slice(0, 12)}`, i.user.email, subject, text, html);
  return { emailed: await emailConfigured(i.tenantId) };
}
