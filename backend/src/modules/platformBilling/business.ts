import { z } from 'zod';
import { meta } from '../../models/meta';

/**
 * The platform owner's business profile, printed on every quotation, invoice and contract.
 * Stored in PlatformSettings('business'); defaults below keep documents valid before it is completed.
 */
export const DEFAULT_CONTRACT_TEMPLATE = `## 1. Services
{{provider.name}} ("the Provider") will provide {{customer.name}} ("the Customer") with access to the AfeySync hospital management information system as a hosted, multi-tenant service, including the modules listed in Schedule A, a dedicated web address and a separate database for the Customer's records.

## 2. Term
This Agreement starts on {{startDate}} and continues for {{termMonths}} months. It renews automatically for further periods of the same length unless either party gives thirty (30) days' written notice before the end of the current term.

## 3. Fees and payment
The Customer will pay {{fee}} per {{cycle}} as set out in Schedule A, plus any applicable taxes. Invoices are payable within {{dueDays}} days by M-Pesa or bank transfer using the invoice number as the payment reference. The Provider may revise fees at renewal with at least thirty (30) days' written notice.

## 4. Data protection
The Customer is the data controller of all patient and staff information it records in the system; the Provider acts as a data processor and will process that information only to provide the service, in accordance with the Data Protection Act, 2019 (Kenya) and its regulations. The Provider applies access controls, encryption of credentials, audit logging and regular encrypted backups, and will notify the Customer without undue delay of any personal data breach affecting the Customer's data.

## 5. Confidentiality
Each party will keep the other party's confidential information confidential and use it only for the purposes of this Agreement. This obligation survives termination.

## 6. Service levels and support
The Provider will use reasonable efforts to keep the service available at all times, excluding planned maintenance communicated in advance, and will provide support by email and phone during business hours. Integrations with third parties (including SHA, the DHA Health Information Exchange, Safaricom M-Pesa and insurers) depend on those parties' availability and approvals.

## 7. Customer responsibilities
The Customer is responsible for its users' accounts and permissions, the accuracy of the information it records, obtaining any licences and approvals it needs to operate, and keeping its own integration credentials confidential.

## 8. Suspension
If an invoice remains unpaid thirty (30) days after its due date, the Provider may, after written notice, restrict non-essential features. The Provider will not delete the Customer's records for non-payment and will keep read access to clinical records available so that patient care is not put at risk.

## 9. Termination and return of data
Either party may terminate this Agreement for material breach that is not remedied within thirty (30) days of written notice. On termination the Provider will make the Customer's data available for export for sixty (60) days and then delete it, unless the law requires otherwise.

## 10. Limitation of liability
Except for breach of confidentiality or data protection obligations, neither party is liable for indirect or consequential loss, and each party's total liability is limited to the fees paid in the twelve (12) months before the claim.

## 11. Governing law
This Agreement is governed by the laws of Kenya. The parties will first try to resolve any dispute in good faith; failing that, the dispute will be referred to the courts of Kenya.`;

export const businessSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  tagline: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(60).default('Kenya'),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)),
  website: z.string().trim().max(120).optional(),
  kraPin: z.string().trim().toUpperCase().max(20).optional(),
  vatRegistered: z.boolean().default(false),
  vatRate: z.number().min(0).max(50).default(16),
  currency: z.string().trim().length(3).default('KES'),
  bank: z.object({ name: z.string().trim().max(80).optional(), branch: z.string().trim().max(80).optional(), accountName: z.string().trim().max(120).optional(), accountNumber: z.string().trim().max(40).optional(), swift: z.string().trim().max(20).optional() }).default({}),
  signatoryName: z.string().trim().max(120).optional(),
  signatoryTitle: z.string().trim().max(120).optional(),
  invoiceDueDays: z.number().int().min(0).max(120).default(14),
  quotationValidDays: z.number().int().min(1).max(365).default(30),
  invoiceNotes: z.string().trim().max(1000).optional(),
  quotationTerms: z.string().trim().max(2000).optional(),
  contractTemplate: z.string().trim().max(30_000).optional(),
  /** Apply the stamp and signature automatically when a document is issued. */
  autoSign: z.boolean().default(true),
});
export type Business = z.infer<typeof businessSchema>;

export const DEFAULT_BUSINESS: Business = {
  companyName: 'AfeySync',
  country: 'Kenya',
  vatRegistered: false,
  vatRate: 16,
  currency: 'KES',
  bank: {},
  invoiceDueDays: 14,
  quotationValidDays: 30,
  autoSign: true,
  quotationTerms: 'Prices are valid until the date shown. On acceptance we issue an invoice, payable by M-Pesa or bank transfer using the invoice number as the reference. Subscription fees are payable in advance for each billing period.',
  invoiceNotes: 'Thank you for choosing AfeySync.',
};

export async function getBusiness(): Promise<Business> {
  const s = await meta().PlatformSettings.findOne({ key: 'business' }).lean();
  return { ...DEFAULT_BUSINESS, ...((s?.value as Partial<Business>) ?? {}) };
}

export async function saveBusiness(b: Business) {
  await meta().PlatformSettings.updateOne({ key: 'business' }, { $set: { key: 'business', value: b } }, { upsert: true });
}

/* ------------------------------------------------------------------ Brand assets (logo, stamp, signature) */
export type AssetKind = 'logo' | 'stamp' | 'signature';
const MAX_ASSET_BYTES = 1024 * 1024;

/** Detects PNG/JPEG from magic bytes; anything else is refused (PDFs only embed these safely). */
export function sniffImage(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}
export const assetLimit = MAX_ASSET_BYTES;

export async function currentAssets() {
  const rows = await meta().BrandAsset.find({ current: true }).select('kind mimeType sha256 sizeBytes createdAt uploadedByName').lean();
  const pick = (k: AssetKind) => rows.find((r) => r.kind === k) ?? null;
  return { logo: pick('logo'), stamp: pick('stamp'), signature: pick('signature') };
}

export async function assetData(id: unknown): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!id) return null;
  const a = await meta().BrandAsset.findById(id).select('+data mimeType').lean();
  return a ? { data: toBuffer(a.data), mimeType: a.mimeType } : null;
}

/** Lean reads return BSON Binary rather than Buffer for binary fields. */
export function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  const b = v as { buffer?: Uint8Array; position?: number };
  if (b?.buffer) return Buffer.from(typeof b.position === 'number' ? b.buffer.subarray(0, b.position) : b.buffer);
  return Buffer.from(v as Uint8Array);
}
