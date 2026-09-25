import PDFDocument from 'pdfkit';
import { meta } from '../../models/meta';
import { MODULES, type ModuleKey } from '../plans/planService';
import { assetData, getBusiness, type Business } from './business';
import { CYCLE_LABEL, fmtDate, kes, type BillingDoc } from './documentService';

/**
 * Server-side PDF rendering for quotations, invoices and contracts. Issued documents use the business
 * details and the stamp/signature images frozen at issue; drafts carry a DRAFT watermark and no signature.
 */
const BRAND = '#0b8a72';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const SOFT = '#f1f5f9';
const M = 50; // page margin
const W = 595.28; // A4 width
const CONTENT_W = W - M * 2;
const BOTTOM = 842 - 70;

type PDF = InstanceType<typeof PDFDocument>;

function title(doc: BillingDoc, b: Business) {
  if (doc.type === 'contract') return 'SERVICE AGREEMENT';
  if (doc.type === 'quotation') return 'QUOTATION';
  return b.vatRegistered ? 'TAX INVOICE' : 'INVOICE';
}

function ensure(pdf: PDF, needed: number) {
  if (pdf.y + needed > BOTTOM) pdf.addPage();
}

function header(pdf: PDF, doc: BillingDoc, b: Business, logo: { data: Buffer } | null) {
  pdf.rect(0, 0, W, 6).fill(BRAND);
  let y = 34;
  if (logo) {
    try {
      pdf.image(logo.data, M, y, { fit: [130, 52] });
    } catch {
      /* unreadable image: skip */
    }
  } else {
    pdf.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text(b.companyName, M, y + 10, { width: 240 });
  }
  const right = [b.legalName && b.legalName !== b.companyName ? b.legalName : null, b.address, [b.city, b.country].filter(Boolean).join(', '), b.phone, b.email, b.website, b.kraPin ? `KRA PIN: ${b.kraPin}` : null].filter(Boolean) as string[];
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(b.companyName, M + 250, y, { width: CONTENT_W - 250, align: 'right' });
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  for (const line of right) pdf.text(line, M + 250, pdf.y + 1, { width: CONTENT_W - 250, align: 'right' });
  y = Math.max(pdf.y, 100) + 18;
  pdf.moveTo(M, y).lineTo(W - M, y).lineWidth(0.7).strokeColor(LINE).stroke();

  pdf.y = y + 16;
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(title(doc, b), M, pdf.y);
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED).text(`No. ${doc.number}`, M, pdf.y + 2);
  const afterTitle = pdf.y;
  const status = doc.status === 'draft' ? 'DRAFT' : doc.status.replace('_', ' ').toUpperCase();
  const badgeW = pdf.widthOfString(status) + 18;
  pdf.roundedRect(W - M - badgeW, y + 20, badgeW, 18, 9).fill(doc.status === 'paid' || doc.status === 'accepted' ? '#dcfce7' : doc.status === 'void' ? '#fee2e2' : SOFT);
  pdf.fillColor(doc.status === 'void' ? '#b91c1c' : INK).font('Helvetica-Bold').fontSize(8).text(status, W - M - badgeW, y + 25.5, { width: badgeW, align: 'center' });
  pdf.y = afterTitle + 18;
}

function parties(pdf: PDF, doc: BillingDoc) {
  const top = pdf.y;
  const colW = CONTENT_W / 2 - 10;
  pdf.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text(doc.type === 'contract' ? 'CUSTOMER' : doc.type === 'quotation' ? 'PREPARED FOR' : 'BILL TO', M, top);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(doc.customer?.name ?? '—', M, pdf.y + 3, { width: colW });
  pdf.font('Helvetica').fontSize(9).fillColor(INK);
  for (const l of [doc.customer?.contactName ? `Attn: ${doc.customer.contactName}` : null, doc.customer?.address, doc.customer?.phone, doc.customer?.email, doc.customer?.kraPin ? `KRA PIN: ${doc.customer.kraPin}` : null].filter(Boolean) as string[]) pdf.text(l, M, pdf.y + 1, { width: colW });
  const leftBottom = pdf.y;

  const rows: Array<[string, string]> = [['Date', fmtDate(doc.issueDate ?? doc.createdAt)]];
  if (doc.type === 'invoice') rows.push(['Due date', fmtDate(doc.dueDate)]);
  if (doc.type === 'quotation') rows.push(['Valid until', fmtDate(doc.validUntil)]);
  if (doc.type === 'contract') rows.push(['Start date', fmtDate(doc.contract?.startDate)], ['Term', `${doc.contract?.termMonths ?? 12} months`]);
  rows.push(['Currency', doc.currency ?? 'KES']);
  let y = top;
  const x = M + CONTENT_W / 2 + 10;
  for (const [k, v] of rows) {
    pdf.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, x, y, { width: 90 });
    pdf.fillColor(INK).font('Helvetica-Bold').text(v, x + 90, y, { width: colW - 90, align: 'right' });
    y += 15;
  }
  pdf.y = Math.max(leftBottom, y) + 18;
}

function linesTable(pdf: PDF, doc: BillingDoc) {
  const cols = [
    { h: '#', w: 22, a: 'left' as const },
    { h: 'Description', w: CONTENT_W - 22 - 45 - 95 - 100, a: 'left' as const },
    { h: 'Qty', w: 45, a: 'right' as const },
    { h: 'Unit price', w: 95, a: 'right' as const },
    { h: 'Amount', w: 100, a: 'right' as const },
  ];
  const headRow = () => {
    ensure(pdf, 30);
    const y = pdf.y;
    pdf.rect(M, y, CONTENT_W, 22).fill(BRAND);
    let x = M;
    for (const c of cols) {
      pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5).text(c.h.toUpperCase(), x + 6, y + 7, { width: c.w - 12, align: c.a });
      x += c.w;
    }
    pdf.y = y + 22;
  };
  headRow();
  (doc.lines ?? []).forEach((l, i) => {
    const cells = [String(i + 1), l.description, String(l.quantity), kes(l.unitPrice, '').trim(), kes(l.amount, '').trim()];
    pdf.font('Helvetica').fontSize(9);
    const h = Math.max(20, pdf.heightOfString(l.description, { width: cols[1].w - 12 }) + 10);
    if (pdf.y + h > BOTTOM) {
      pdf.addPage();
      headRow();
    }
    const y = pdf.y;
    if (i % 2 === 1) pdf.rect(M, y, CONTENT_W, h).fill(SOFT);
    let x = M;
    cells.forEach((c, j) => {
      pdf.fillColor(INK).font(j === 1 ? 'Helvetica' : 'Helvetica').fontSize(9).text(c, x + 6, y + 5, { width: cols[j].w - 12, align: cols[j].a });
      x += cols[j].w;
    });
    pdf.y = y + h;
  });
  pdf.moveTo(M, pdf.y).lineTo(W - M, pdf.y).lineWidth(0.7).strokeColor(LINE).stroke();
  pdf.y += 10;
}

function totals(pdf: PDF, doc: BillingDoc) {
  const rows: Array<[string, string, boolean?]> = [['Subtotal', kes(doc.subtotal ?? 0, doc.currency ?? 'KES')]];
  if ((doc.vatRate ?? 0) > 0) rows.push([`VAT (${doc.vatRate}%)`, kes(doc.vatAmount ?? 0, doc.currency ?? 'KES')]);
  rows.push(['Total', kes(doc.total ?? 0, doc.currency ?? 'KES'), true]);
  if (doc.type === 'invoice' && (doc.amountPaid ?? 0) > 0) rows.push(['Paid', `- ${kes(doc.amountPaid ?? 0, doc.currency ?? 'KES')}`], ['Balance due', kes(doc.balance ?? 0, doc.currency ?? 'KES'), true]);
  ensure(pdf, rows.length * 18 + 10);
  const x = W - M - 230;
  for (const [k, v, strong] of rows) {
    const y = pdf.y;
    if (strong) pdf.rect(x, y - 3, 230, 20).fill(SOFT);
    pdf.fillColor(strong ? INK : MUTED).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10.5 : 9.5).text(k, x + 8, y + 1, { width: 100 });
    pdf.fillColor(INK).text(v, x + 100, y + 1, { width: 122, align: 'right' });
    pdf.y = y + (strong ? 22 : 17);
  }
  pdf.y += 8;
}

function paymentBox(pdf: PDF, doc: BillingDoc, b: Business, mpesa: { paybill?: string; till?: string; accountLabel?: string } | null) {
  const lines: string[] = [];
  if (mpesa?.paybill) lines.push(`M-Pesa Paybill ${mpesa.paybill}, account number ${doc.number}`);
  else if (mpesa?.till) lines.push(`M-Pesa Buy Goods till ${mpesa.till} (quote ${doc.number})`);
  if (b.bank?.accountNumber) lines.push(`Bank: ${[b.bank.name, b.bank.branch].filter(Boolean).join(', ')} · Account name ${b.bank.accountName ?? b.companyName} · Account no. ${b.bank.accountNumber}${b.bank.swift ? ` · SWIFT ${b.bank.swift}` : ''}`);
  if (!lines.length) return;
  lines.push(`Always use ${doc.number} as the payment reference.`);
  pdf.font('Helvetica').fontSize(9);
  const h = 26 + lines.reduce((s, l) => s + pdf.heightOfString(l, { width: CONTENT_W - 24 }) + 3, 0);
  ensure(pdf, h + 10);
  const y = pdf.y;
  pdf.roundedRect(M, y, CONTENT_W, h, 6).lineWidth(0.8).strokeColor(BRAND).stroke();
  pdf.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text('HOW TO PAY', M + 12, y + 10);
  pdf.fillColor(INK).font('Helvetica').fontSize(9);
  let ly = y + 24;
  for (const l of lines) {
    pdf.text(l, M + 12, ly, { width: CONTENT_W - 24 });
    ly = pdf.y + 3;
  }
  pdf.y = y + h + 12;
}

function textBlock(pdf: PDF, heading: string, body?: string | null) {
  if (!body) return;
  ensure(pdf, 40);
  pdf.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text(heading.toUpperCase(), M, pdf.y);
  pdf.fillColor(INK).font('Helvetica').fontSize(9).text(body, M, pdf.y + 3, { width: CONTENT_W, lineGap: 1.5 });
  pdf.y += 10;
}

async function signatureBlock(pdf: PDF, doc: BillingDoc, b: Business, x: number, width: number, label: string) {
  const s = doc.signing;
  const [sig, stamp] = await Promise.all([assetData(s?.signatureAssetId), assetData(s?.stampAssetId)]);
  const top = pdf.y;
  pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(label, x, top, { width });
  const imgTop = top + 16;
  if (stamp) {
    try {
      pdf.save().opacity(0.9).image(stamp.data, x + width - 105, imgTop - 8, { fit: [100, 100] }).restore();
    } catch {
      /* skip */
    }
  }
  if (sig) {
    try {
      pdf.image(sig.data, x, imgTop, { fit: [150, 55] });
    } catch {
      /* skip */
    }
  }
  const lineY = imgTop + 62;
  pdf.moveTo(x, lineY).lineTo(x + 170, lineY).lineWidth(0.7).strokeColor(INK).stroke();
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(s?.signatoryName || b.signatoryName || '________________', x, lineY + 5, { width: width - 110 });
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(s?.signatoryTitle || b.signatoryTitle || 'Authorised signatory', x, pdf.y + 1, { width: width - 110 });
  if (s?.signedAt) pdf.text(`Signed electronically on ${fmtDate(s.signedAt)}`, x, pdf.y + 1, { width: width - 20 });
  return Math.max(pdf.y, imgTop + 100);
}

function customerAcceptance(pdf: PDF, doc: BillingDoc, x: number, width: number, top: number) {
  pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(`For and on behalf of ${doc.customer?.name ?? 'the Customer'}`, x, top, { width });
  const a = doc.acceptance;
  if (a?.at) {
    pdf.roundedRect(x, top + 18, width, 58, 6).fill('#ecfdf5');
    pdf.fillColor('#047857').font('Helvetica-Bold').fontSize(9).text('Accepted electronically', x + 10, top + 26, { width: width - 20 });
    pdf.fillColor(INK).font('Helvetica').fontSize(8.5).text(`${a.byName}${a.byTitle ? `, ${a.byTitle}` : ''}`, x + 10, pdf.y + 2, { width: width - 20 });
    pdf.fillColor(MUTED).text(`${a.byEmail ?? ''} · ${fmtDate(a.at)}`, x + 10, pdf.y + 1, { width: width - 20 });
    return top + 90;
  }
  let y = top + 34;
  for (const l of ['Name', 'Title', 'Signature', 'Date']) {
    pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(l, x, y);
    pdf.moveTo(x + 55, y + 9).lineTo(x + width - 10, y + 9).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 20;
  }
  return y;
}

async function contractSections(pdf: PDF, doc: BillingDoc, b: Business) {
  const plan = doc.contract?.planKey ? await meta().SubscriptionPlan.findOne({ key: doc.contract.planKey }).lean() : null;
  pdf.fillColor(INK).font('Helvetica').fontSize(9.5).text(`This Service Agreement is made between ${b.legalName || b.companyName}${b.kraPin ? ` (KRA PIN ${b.kraPin})` : ''} ("the Provider") and ${doc.customer?.name ?? 'the Customer'} ("the Customer").`, M, pdf.y, { width: CONTENT_W, lineGap: 1.5 });
  pdf.y += 12;
  // Schedule A
  ensure(pdf, 120);
  pdf.fillColor(BRAND).font('Helvetica-Bold').fontSize(11).text('Schedule A — Subscription', M, pdf.y);
  pdf.y += 6;
  const cycle = doc.contract?.billingCycle ?? 'monthly';
  const rows: Array<[string, string]> = [
    ['Plan', plan?.name ?? doc.contract?.planKey ?? '—'],
    ['Included modules', ['Registration, front desk, OPD, billing and documents (core)', ...(plan?.modules ?? []).map((m) => MODULES[m as ModuleKey]?.label ?? m)].join(', ')],
    ['Limits', plan ? `Up to ${plan.maxBranches} branch(es) and ${plan.maxUsers} users` : '—'],
    ['Fee', `${kes(doc.contract?.amount ?? 0, doc.currency ?? 'KES')} per ${CYCLE_LABEL[cycle] ?? cycle}${b.vatRegistered ? ` plus VAT at ${b.vatRate}%` : ''}`],
    ['Start date / term', `${fmtDate(doc.contract?.startDate)} · ${doc.contract?.termMonths ?? 12} months`],
  ];
  for (const [k, v] of rows) {
    pdf.font('Helvetica').fontSize(9);
    const h = Math.max(18, pdf.heightOfString(v, { width: CONTENT_W - 140 }) + 8);
    ensure(pdf, h);
    const y = pdf.y;
    pdf.rect(M, y, CONTENT_W, h).fill(SOFT);
    pdf.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text(k, M + 8, y + 5, { width: 120 });
    pdf.fillColor(INK).font('Helvetica').fontSize(9).text(v, M + 132, y + 5, { width: CONTENT_W - 140 });
    pdf.y = y + h + 2;
  }
  pdf.y += 12;
  // "## Heading" lines become headings; every other line is body text.
  let para: string[] = [];
  const flush = () => {
    const t = para.join(' ').trim();
    para = [];
    if (!t) return;
    pdf.fillColor(INK).font('Helvetica').fontSize(9.5).text(t, M, pdf.y, { width: CONTENT_W, lineGap: 1.8, align: 'justify' });
    pdf.y += 6;
  };
  for (const raw of (doc.contract?.body ?? '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      flush();
      ensure(pdf, 50);
      pdf.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(line.slice(3), M, pdf.y + 4, { width: CONTENT_W });
      pdf.y += 3;
    } else if (!line) flush();
    else para.push(line);
  }
  flush();
  if (doc.contract?.specialTerms) {
    ensure(pdf, 40);
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('Special terms', M, pdf.y + 4);
    pdf.font('Helvetica').fontSize(9.5).text(doc.contract.specialTerms, M, pdf.y + 3, { width: CONTENT_W, lineGap: 1.8 });
  }
}

export async function renderDocumentPdf(doc: BillingDoc): Promise<Buffer> {
  const live = await getBusiness();
  // Issued documents print the business details frozen at issue.
  const b = { ...live, ...((doc.signing?.business as Partial<Business> | undefined) ?? {}) } as Business;
  const logo = await assetData(doc.signing?.logoAssetId ?? (doc.status === 'draft' ? (await meta().BrandAsset.findOne({ kind: 'logo', current: true }).select('_id').lean())?._id : null));
  const cfg = await meta().IntegrationConfig.findOne({ scope: 'platform', provider: 'mpesa_billing' }).select('enabled settings').lean();
  const mpesa = cfg?.enabled ? ((cfg.settings as Record<string, string>) ?? {}) : null;

  const pdf = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, bufferPages: true, info: { Title: `${title(doc, b)} ${doc.number}`, Author: b.companyName, Subject: doc.customer?.name ?? '' } });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(chunks))));

  header(pdf, doc, b, logo);
  parties(pdf, doc);
  if (doc.type === 'contract') await contractSections(pdf, doc, b);
  else {
    linesTable(pdf, doc);
    totals(pdf, doc);
    // Payment details go on invoices only: paybill payments are matched by invoice number.
    if (doc.type === 'invoice') paymentBox(pdf, doc, b, mpesa);
    textBlock(pdf, doc.type === 'quotation' ? 'Terms' : 'Notes', doc.type === 'quotation' ? doc.terms || b.quotationTerms : doc.notes || b.invoiceNotes);
  }

  // Signatures
  ensure(pdf, 170);
  pdf.y += 16;
  if (doc.type === 'contract') {
    const top = pdf.y;
    const colW = CONTENT_W / 2 - 12;
    const leftEnd = await signatureBlock(pdf, doc, b, M, colW, `For and on behalf of ${b.legalName || b.companyName}`);
    const rightEnd = customerAcceptance(pdf, doc, M + colW + 24, colW, top);
    pdf.y = Math.max(leftEnd, rightEnd) + 10;
  } else {
    await signatureBlock(pdf, doc, b, M, 300, `For and on behalf of ${b.legalName || b.companyName}`);
    if (doc.type === 'quotation' && doc.acceptance?.at) {
      pdf.y += 8;
      pdf.fillColor('#047857').font('Helvetica-Bold').fontSize(9).text(`Accepted by ${doc.acceptance.byName} on ${fmtDate(doc.acceptance.at)}`, M, pdf.y);
    }
  }
  if (doc.signing?.hash) {
    pdf.y += 8;
    pdf.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`Document fingerprint: ${doc.signing.hash.slice(0, 32).match(/.{1,8}/g)!.join('-')}`, M, pdf.y, { width: CONTENT_W });
  }

  // Watermarks and footers on every page
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    if (doc.status === 'draft' || doc.status === 'void') {
      pdf.save().rotate(-35, { origin: [W / 2, 421] }).fillColor(doc.status === 'void' ? '#dc2626' : '#94a3b8').opacity(0.12).font('Helvetica-Bold').fontSize(110).text(doc.status === 'void' ? 'VOID' : 'DRAFT', 0, 360, { width: W, align: 'center' }).restore();
    }
    // The footer sits inside the bottom margin: lift the margin so pdfkit does not start a new page.
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.fillColor(MUTED).opacity(1).font('Helvetica').fontSize(7.5);
    pdf.text(`${b.companyName}${b.website ? ` · ${b.website}` : ''}${b.email ? ` · ${b.email}` : ''}`, M, 842 - 32, { width: CONTENT_W - 80, lineBreak: false });
    pdf.text(`${doc.number} · Page ${i - range.start + 1} of ${range.count}`, W - M - 150, 842 - 32, { width: 150, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = bottom;
  }
  pdf.end();
  return done;
}
