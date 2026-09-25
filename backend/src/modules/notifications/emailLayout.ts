import { env } from '../../config/env';

/**
 * The AfeySync email design: wordmark header, title, greeting, body, an optional large sign-in code,
 * button and detail rows, a "didn't request this?" note, sign-off and footer. Table-based with inline
 * styles so it renders the same in Gmail, Outlook and phone mail apps.
 */
export interface EmailContent {
  title: string;
  /** Shown under the wordmark, e.g. the facility the email is about. */
  facility?: string | null;
  greeting?: string | null;
  paragraphs?: string[];
  code?: { value: string; expires?: string };
  button?: { label: string; url: string };
  details?: Array<[string, string]>;
  /** Security note, e.g. what to do if the reader did not request this. */
  notice?: string | null;
  signOff?: string | null;
}

const BRAND = '#0b8a72';
const INK = '#0f172a';
const MUTED = '#475569';

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Escapes text and turns bare https links into links. */
function rich(text: string) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${BRAND};word-break:break-all">$1</a>`)
    .replace(/(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=$|[\s),.;:!?])/g, `$1<a href="mailto:$2" style="color:${BRAND}">$2</a>`)
    .replace(/\n/g, '<br>');
}

/** Footer links from EMAIL_FOOTER_LINKS ("Website|https://…,LinkedIn|https://…"). Only configured links are shown. */
function footerLinks() {
  return (env.EMAIL_FOOTER_LINKS ?? '')
    .split(',')
    .map((p) => p.split('|').map((x) => x.trim()))
    .filter(([label, url]) => label && url && /^https:\/\//.test(url))
    .map(([label, url]) => `<a href="${escapeHtml(url)}" style="color:${MUTED};text-decoration:none;margin:0 8px">${escapeHtml(label)}</a>`)
    .join('<span style="color:#cbd5e1">·</span>');
}

/** Plain text (it is escaped and linked where it is used): "Please contact support@… or call …". */
export function supportLine() {
  const parts = [env.SUPPORT_EMAIL ?? '', env.SUPPORT_PHONE ? `call ${env.SUPPORT_PHONE}` : ''].filter(Boolean);
  return parts.length ? `Please contact ${parts.join(' or ')}.` : '';
}

export function renderEmail(c: EmailContent) {
  const year = new Date().getFullYear();
  const code = c.code
    ? `<p style="margin:24px 0 8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:34px;font-weight:700;letter-spacing:12px;color:${BRAND}">${escapeHtml(c.code.value)}</p>` +
      (c.code.expires ? `<p style="margin:0 0 20px;color:${INK}">This code expires in <strong>${escapeHtml(c.code.expires)}</strong> and can only be used once.</p>` : '')
    : '';
  const details = c.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 20px;font-size:14px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${c.details
        .map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;width:42%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:8px 0;color:${INK};font-weight:600">${rich(v)}</td></tr>`)
        .join('')}</table>`
    : '';
  const button = c.button
    ? `<p style="margin:8px 0 22px"><a href="${escapeHtml(c.button.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${escapeHtml(c.button.label)}</a></p>` +
      `<p style="margin:0 0 18px;font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(c.button.url)}</span></p>`
    : '';
  const links = footerLinks();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(c.title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fafafa;border:1px solid #e2e8f0">
<tr><td style="padding:28px 28px 8px">
  <div style="font-size:30px;font-weight:800;letter-spacing:-0.5px;line-height:1"><span style="color:${BRAND}">Afey</span><span style="color:${INK}">Sync</span> <span style="color:${INK};font-weight:700">HMIS</span></div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>
    <td style="width:28px;border-top:1.5px solid ${BRAND}"></td>
    <td style="padding:0 6px;font-size:12px;font-weight:600;color:${BRAND};white-space:nowrap">${c.facility ? escapeHtml(c.facility) : 'Hospital Management Information System'}</td>
    <td style="width:28px;border-top:1.5px solid ${BRAND}"></td>
  </tr></table>
</td></tr>
<tr><td style="padding:12px 28px 28px;color:${INK};font-size:15px;line-height:1.6">
  <h1 style="margin:10px 0 22px;font-size:22px;line-height:1.3;color:${INK}">${escapeHtml(c.title)}</h1>
  ${c.greeting ? `<p style="margin:0 0 16px">${escapeHtml(c.greeting)}</p>` : ''}
  ${(c.paragraphs ?? []).map((p) => `<p style="margin:0 0 16px">${rich(p)}</p>`).join('')}
  ${code}${details}${button}
  ${c.notice ? `<p style="margin:0 0 18px;color:${INK}">${rich(c.notice)}</p>` : ''}
  <p style="margin:18px 0 4px">Warm regards,</p>
  <p style="margin:0;font-weight:700">${escapeHtml(c.signOff ?? 'From AfeySync HMIS')}</p>
</td></tr>
<tr><td style="border-top:1px solid #e2e8f0;padding:18px 28px;text-align:center;font-size:13px;color:${MUTED};background:#ffffff">
  ${links ? `<p style="margin:0 0 10px">${links}</p>` : ''}
  <p style="margin:0">&copy; ${year} AfeySync HMIS. All Rights Reserved.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Wraps a plain-text email (the text every email already has) in the AfeySync design: the first
 * "Hello …," line becomes the greeting, a final "— …" line the sign-off, the rest paragraphs.
 */
export function renderPlainEmail(subject: string, text: string, facility?: string | null, code?: EmailContent['code']) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let greeting: string | null = null;
  let signOff: string | null = null;
  if (blocks[0] && /^(hello|hi|dear)\b[^\n]{0,80},?$/i.test(blocks[0])) greeting = blocks.shift()!;
  const last = blocks.at(-1);
  if (last && /^[—-]\s*\S/.test(last) && !last.includes('\n')) signOff = last.replace(/^[—-]\s*/, '');
  if (signOff) blocks.pop();
  // "Facility: something" subjects read better as the title without the facility prefix (it is in the header).
  const title = facility && subject.startsWith(`${facility}: `) ? subject.slice(facility.length + 2) : subject;
  const didNot = blocks.findIndex((b) => /^if (you did not|this was not you|you didn't)/i.test(b));
  const notice = didNot >= 0 ? blocks.splice(didNot, 1)[0] : null;
  return renderEmail({ title: title.charAt(0).toUpperCase() + title.slice(1), facility, greeting, paragraphs: blocks, code, notice: notice ? [notice, supportLine()].filter(Boolean).join(' ') : null, signOff: signOff ?? (facility ? `${facility}, via AfeySync HMIS` : null) });
}
