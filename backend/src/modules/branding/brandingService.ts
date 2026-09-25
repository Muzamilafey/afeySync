import crypto from 'node:crypto';
import { z } from 'zod';
import { meta } from '../../models/meta';
import { AppError, notFound } from '../../utils/errors';
import { sniffImage, toBuffer } from '../platformBilling/business';

/**
 * Facility branding: the name, tagline, colour and logo shown on the facility's own address (sign-in
 * page, app header, installed app). It is public by design — it appears before anyone signs in — so
 * nothing sensitive belongs here.
 */
export const MAX_LOGO_BYTES = 512 * 1024;
export const DEFAULT_PRIMARY = '#0b8a72';

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Contrast of white text on the colour; buttons and the active menu item use white text on it. */
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

const text = (max: number) => z.string().trim().max(max);
export const brandingSchema = z.object({
  displayName: text(80).optional(),
  tagline: text(120).optional(),
  welcomeMessage: text(300).optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0b8a72')
    .transform((v) => v.toLowerCase())
    .refine((v) => contrastWithWhite(v) >= 3, 'This colour is too light for white text on buttons. Choose a darker shade.')
    .optional()
    .or(z.literal('')),
});
export type BrandingInput = z.infer<typeof brandingSchema>;

type TenantLike = { _id: unknown; name: string; slug: string; branding?: { displayName?: string | null; tagline?: string | null; welcomeMessage?: string | null; primaryColor?: string | null; logoVersion?: string | null } | null };

/** What the sign-in page, header and manifest use. */
export function publicBranding(t: TenantLike) {
  const b = t.branding ?? {};
  return {
    name: b.displayName || t.name,
    legalName: t.name,
    tagline: b.tagline || null,
    welcomeMessage: b.welcomeMessage || null,
    primaryColor: b.primaryColor || null,
    logoUrl: b.logoVersion ? `/api/v1/auth/branding/logo?v=${b.logoVersion}` : null,
  };
}

export async function getBranding(tenantId: string) {
  const t = await meta().Tenant.findById(tenantId).select('name slug branding').lean();
  if (!t) throw notFound('Facility not found');
  return publicBranding(t as TenantLike);
}

/** Saves the text and colour; empty strings clear a field (falls back to the defaults). */
export async function updateBranding(tenantId: string, input: BrandingInput) {
  const before = await getBranding(tenantId);
  const $set: Record<string, unknown> = { 'branding.updatedAt': new Date() };
  const $unset: Record<string, ''> = {};
  for (const k of ['displayName', 'tagline', 'welcomeMessage', 'primaryColor'] as const) {
    const v = input[k];
    if (v === undefined) continue;
    if (v === '') $unset[`branding.${k}`] = '';
    else $set[`branding.${k}`] = v;
  }
  await meta().Tenant.updateOne({ _id: tenantId }, Object.keys($unset).length ? { $set, $unset } : { $set });
  return { before, after: await getBranding(tenantId) };
}

export function decodeLogo(dataBase64: string) {
  const data = Buffer.from(dataBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (data.length > MAX_LOGO_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The logo must be 512 KB or smaller');
  // PNG/JPEG only, detected from the file itself: SVG can carry scripts and is refused.
  const mimeType = sniffImage(data);
  if (!mimeType) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload the logo as a PNG (transparent background works best) or JPEG image');
  return { data, mimeType };
}

export async function setLogo(tenantId: string, dataBase64: string) {
  const { data, mimeType } = decodeLogo(dataBase64);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const { TenantLogo, Tenant } = meta();
  await TenantLogo.updateOne({ tenantId }, { $set: { mimeType, data, sha256: sha, sizeBytes: data.length } }, { upsert: true });
  await Tenant.updateOne({ _id: tenantId }, { $set: { 'branding.logoVersion': sha.slice(0, 16), 'branding.logoMimeType': mimeType, 'branding.updatedAt': new Date() } });
  return { sha256: sha, sizeBytes: data.length, mimeType };
}

export async function removeLogo(tenantId: string) {
  await meta().TenantLogo.deleteOne({ tenantId });
  await meta().Tenant.updateOne({ _id: tenantId }, { $unset: { 'branding.logoVersion': '', 'branding.logoMimeType': '' }, $set: { 'branding.updatedAt': new Date() } });
}

export async function logoFile(tenantId: string) {
  const l = await meta().TenantLogo.findOne({ tenantId }).lean();
  return l ? { data: toBuffer(l.data), mimeType: l.mimeType, sha256: l.sha256 ?? '' } : null;
}

export const logoUploadSchema = z.object({ dataBase64: z.string().min(20).max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 100) });

/** For the branding editors (facility settings and the owner portal, which is on another address): includes the logo inline for preview. */
export async function editorBranding(tenantId: string) {
  const b = await getBranding(tenantId);
  const logo = b.logoUrl ? await logoFile(tenantId) : null;
  return { ...b, logoDataUrl: logo ? `data:${logo.mimeType};base64,${logo.data.toString('base64')}` : null };
}
