import type { Model } from 'mongoose';
import { meta } from '../../models/meta';
import { resolveMailConfig } from '../../integrations/smtp/smtpService';
import { randomToken, sha256 } from '../../utils/crypto';
import { notifyEmail } from '../notifications/notify';
import { renderEmail, supportLine } from '../notifications/emailLayout';
import { publicBranding } from '../branding/brandingService';

/**
 * Account emails for new users and administrator resets. They carry the sign-in address, the user's
 * email and a single-use link to choose their own password. Passwords are never emailed.
 */
export const WELCOME_LINK_HOURS = 72;
export const RESET_LINK_HOURS = 24;


export interface AccountEmailInput {
  tenantId: string;
  PasswordReset: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  user: { _id: unknown; name: string; email: string };
  /** The facility's own address, e.g. https://yourfacility.afeysync.com */
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
  const hours = i.kind === 'welcome' ? WELCOME_LINK_HOURS : RESET_LINK_HOURS;

  // Earlier unused links for this user stop working when a new one is sent.
  await i.PasswordReset.updateMany({ userId: i.user._id, usedAt: null }, { usedAt: new Date() });
  const token = randomToken(32);
  await i.PasswordReset.create({ userId: i.user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000), purpose: i.kind });
  const setLink = `${i.origin}/reset-password?token=${token}&welcome=${i.kind === 'welcome' ? 1 : 0}`;
  const loginLink = `${i.origin}/login`;
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

  const html = renderEmail({
    title: i.kind === 'welcome' ? `Welcome to ${brand.name}` : 'Your password was reset',
    facility: brand.name,
    greeting: `Hello ${i.user.name},`,
    paragraphs: [intro],
    details: [['Sign-in address', loginLink], ['Your email (username)', i.user.email], ...(roles ? ([['Role', roles]] as Array<[string, string]>) : [])],
    button: { label: 'Choose your password', url: setLink },
    notice: [
      `The button works once and expires in ${hours} hours. If your administrator gave you a temporary password instead, sign in with it and you will be asked to choose a new one straight away.`,
      'Never share your password. AfeySync staff will never ask for it.',
      i.kind === 'admin_reset' ? `Didn't expect this email? Contact your administrator immediately. ${supportLine()}` : '',
    ].filter(Boolean).join(' '),
    signOff: `${brand.name}, via AfeySync HMIS`,
  });

  await notifyEmail(i.tenantId, `account:${i.kind}:${String(i.user._id)}:${sha256(token).slice(0, 12)}`, i.user.email, subject, text, html);
  return { emailed: await emailConfigured(i.tenantId) };
}
