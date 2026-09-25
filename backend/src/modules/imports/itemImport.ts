import type { Request } from 'express';
import { meta } from '../../models/meta';
import { publicBranding } from '../branding/brandingService';
import { syncItemPrices } from '../pharmacy/itemPrices';
import { audit } from '../audit/auditService';
import { AppError } from '../../utils/errors';
import { buildTemplate, parseNumber, readImport, summarize, yesNo, type ImportColumn, type RowResult } from './excel';

const CATEGORIES = ['drug', 'consumable', 'reagent', 'equipment', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
const CODE_RE = /^[A-Za-z0-9-_.]+$/;
/** Kept in step with the inventory form (frontend features/pharmacy/dosageForms.ts). */
const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Oral solution', 'Oral drops', 'Powder for oral suspension', 'Sachet / granules', 'Lozenge', 'Injection', 'Injection (ampoule)', 'IV infusion / fluid', 'Cream', 'Ointment', 'Gel', 'Lotion', 'Eye drops', 'Eye ointment', 'Ear drops', 'Nasal drops / spray', 'Inhaler', 'Nebuliser solution', 'Suppository', 'Pessary', 'Transdermal patch', 'Mouthwash', 'Implant', 'Vaccine'];
const STOCK_UNITS = ['unit', 'tablet', 'capsule', 'bottle', 'vial', 'ampoule', 'bag', 'tube', 'sachet', 'inhaler', 'nebule', 'suppository', 'pessary', 'patch', 'lozenge', 'implant', 'box', 'pack', 'strip', 'piece', 'pair', 'roll', 'kit', 'litre', 'ml', 'g', 'kg'];

const COLUMNS: ImportColumn[] = [
  { key: 'code', header: 'Code', required: true, width: 14, note: 'Unique item code, e.g. PCM500. Letters, numbers and - _ . only. An existing code updates that item.' },
  { key: 'name', header: 'Name', required: true, width: 32, note: 'Item name as it appears in stock and on prescriptions.' },
  { key: 'genericName', header: 'Generic name', width: 24 },
  { key: 'form', header: 'Form', width: 22, suggest: DOSAGE_FORMS, note: 'Dosage form, e.g. Tablet, Capsule, Syrup, Injection. Pick from the list or type your own.' },
  { key: 'strength', header: 'Strength', width: 12, note: 'e.g. 500mg, 125mg/5ml.' },
  { key: 'unit', header: 'Unit', width: 12, suggest: STOCK_UNITS, note: 'How stock is counted, e.g. tablet, bottle, vial. Defaults to "unit".' },
  { key: 'category', header: 'Category', width: 14, list: CATEGORIES, note: 'Defaults to drug.' },
  { key: 'reorderLevel', header: 'Reorder level', width: 14, kind: 'integer', note: 'Alert when stock falls to this quantity. Defaults to 0.' },
  { key: 'controlled', header: 'Controlled drug', width: 16, kind: 'yesno', note: 'Yes for controlled/scheduled drugs (extra dispensing checks).' },
  { key: 'serviceCode', header: 'Billing service code', width: 20, note: 'Optional. The billing service used to charge for this item. Defaults to RX-<code>.' },
  { key: 'active', header: 'Active', width: 10, kind: 'yesno', note: 'Blank means Yes for new items and no change for existing ones.' },
  { key: 'priceCash', header: 'Price: Cash', width: 13, kind: 'number', note: 'Selling price per unit (KES) for Kenyan cash patients. Also used for any list left blank. Blank = no change.' },
  { key: 'priceSha', header: 'Price: SHA', width: 13, kind: 'number', note: 'Price per unit billed to SHA. Blank = cash price.' },
  { key: 'priceInsurance', header: 'Price: Insurance', width: 15, kind: 'number', note: 'Price per unit for insurance and corporate payers. Blank = cash price.' },
  { key: 'priceForeigner', header: 'Price: Foreigner', width: 15, kind: 'number', note: 'Price per unit for cash-paying non-Kenyan patients. Blank = cash price.' },
];
const PRICE_COLUMNS = [['priceCash', 'cash'], ['priceSha', 'sha'], ['priceInsurance', 'insurance'], ['priceForeigner', 'foreigner']] as const;

export async function itemTemplate(req: Request) {
  const tenant = await meta().Tenant.findById(req.tenant!.id).select('name slug branding').lean();
  const brand = publicBranding(tenant!);
  return buildTemplate({
    facility: brand.name,
    color: brand.primaryColor,
    title: 'Inventory items',
    sheetName: 'Items',
    columns: COLUMNS,
    examples: [
      { code: 'PCM500', name: 'Paracetamol 500mg tablets', genericName: 'Paracetamol', form: 'tablet', strength: '500mg', unit: 'tablet', category: 'drug', reorderLevel: 500, controlled: 'No', active: 'Yes', priceCash: 5, priceSha: 4, priceInsurance: 6, priceForeigner: 10 },
      { code: 'AMOX250S', name: 'Amoxicillin 125mg/5ml suspension', genericName: 'Amoxicillin', form: 'suspension', strength: '125mg/5ml', unit: 'bottle', category: 'drug', reorderLevel: 30, controlled: 'No', active: 'Yes' },
      { code: 'MORPH10', name: 'Morphine 10mg/ml injection', genericName: 'Morphine', form: 'injection', strength: '10mg/ml', unit: 'ampoule', category: 'drug', reorderLevel: 20, controlled: 'Yes', active: 'Yes' },
      { code: 'GLOVE-M', name: 'Examination gloves (medium)', unit: 'box', category: 'consumable', reorderLevel: 10, controlled: 'No', active: 'Yes' },
    ],
    instructions: [
      'Fill in the "Items" sheet from row 4, one item per row. Columns marked * are required.',
      'Code identifies the item. If the code already exists, that item is updated; otherwise a new item is created.',
      'This sets up the item list and its selling prices. Receive stock quantities, batches and expiry dates through Inventory → Receive.',
      'Prices are per unit, in KES. Only staff who manage prices can import them; leave the price columns blank otherwise.',
      'Upload the file on Inventory → Import from Excel. You will see a preview with any problems per row before anything is saved.',
      'Nothing is saved if any row has a problem. Fix the rows shown and upload again.',
    ],
  });
}

interface Parsed { code: string; name: string; genericName?: string; form?: string; strength?: string; unit?: string; category?: Category; reorderLevel?: number; controlled: boolean | null; serviceCode?: string; active: boolean | null; prices?: Record<string, number> }

export async function importItems(req: Request, commit: boolean) {
  const rows = await readImport(req.file, COLUMNS);
  const { Item } = req.tenant!.models;
  const codes = rows.map((r) => r.values.code?.toUpperCase()).filter(Boolean);
  const existing = new Map((await Item.find({ code: { $in: codes } }).lean()).map((i) => [i.code, i]));
  const canPrice = req.user!.permissions.has('billing.prices');
  const services = new Map((await req.tenant!.models.ServiceItem.find({ code: { $in: [...codes.map((c) => `RX-${c}`), ...rows.map((r) => r.values.serviceCode?.toUpperCase()).filter(Boolean)] } }).select('code prices').lean()).map((sv) => [sv.code, sv]));
  const seen = new Map<string, number>();
  const results: Array<RowResult & { parsed?: Parsed }> = [];

  for (const { row, values } of rows) {
    const errors: string[] = [];
    const code = (values.code ?? '').trim().toUpperCase();
    const name = (values.name ?? '').trim();
    if (!code) errors.push('Code is required');
    else if (!CODE_RE.test(code) || code.length > 30) errors.push('Code can only contain letters, numbers and - _ . (up to 30 characters)');
    else if (seen.has(code)) errors.push(`Code ${code} is also on row ${seen.get(code)}`);
    if (code) seen.set(code, row);
    const current = code ? existing.get(code) : undefined;
    if (!name && !current) errors.push('Name is required');
    else if (name && (name.length < 2 || name.length > 160)) errors.push('Name must be 2 to 160 characters');
    const category = (values.category ?? '').trim().toLowerCase();
    if (category && !(CATEGORIES as readonly string[]).includes(category)) errors.push(`Category must be one of: ${CATEGORIES.join(', ')}`);
    const reorder = parseNumber(values.reorderLevel ?? '');
    if (reorder !== null && (Number.isNaN(reorder) || reorder < 0 || !Number.isInteger(reorder))) errors.push('Reorder level must be a whole number of 0 or more');
    const controlled = yesNo(values.controlled ?? '');
    if (controlled === undefined) errors.push('Controlled drug must be Yes or No');
    const active = yesNo(values.active ?? '');
    if (active === undefined) errors.push('Active must be Yes or No');
    for (const [k, max] of [['genericName', 160], ['form', 60], ['strength', 60], ['unit', 30], ['serviceCode', 40]] as const) {
      if ((values[k] ?? '').length > max) errors.push(`${COLUMNS.find((c) => c.key === k)!.header} must be at most ${max} characters`);
    }
    const prices: Record<string, number> = {};
    for (const [col, list] of PRICE_COLUMNS) {
      const v = parseNumber(values[col] ?? '');
      if (v === null) continue;
      if (Number.isNaN(v) || v < 0 || v > 10_000_000) errors.push(`${COLUMNS.find((c) => c.key === col)!.header} must be a number of 0 or more`);
      else prices[list] = Math.round(v * 100) / 100;
    }
    const hasPrices = Object.keys(prices).length > 0;
    if (hasPrices && !canPrice) errors.push('You cannot set prices (needs billing.prices). Leave the price columns blank.');
    const svcCode = ((values.serviceCode || current?.serviceCode || '') as string).toUpperCase() || `RX-${code}`;
    const currentPrices = Object.fromEntries((services.get(svcCode)?.prices ?? []).map((p) => [p.priceList, p.amount]));
    if (hasPrices && prices.cash === undefined && currentPrices.cash === undefined) errors.push('Price: Cash is required when setting prices (it is the fallback for blank lists)');
    if (errors.length) {
      results.push({ row, key: code || `(row ${row})`, name, action: 'error', errors });
      continue;
    }
    const parsed: Parsed = {
      code,
      name: name || current!.name,
      genericName: values.genericName || undefined,
      form: values.form || undefined,
      strength: values.strength || undefined,
      unit: values.unit || undefined,
      category: (category || undefined) as Category | undefined,
      reorderLevel: reorder ?? undefined,
      controlled,
      serviceCode: values.serviceCode ? values.serviceCode.toUpperCase() : undefined,
      active,
      prices: hasPrices ? prices : undefined,
    };
    const priceChanges = Object.entries(prices).filter(([l, v]) => currentPrices[l] !== v).map(([l, v]) => `${l} price → ${v}`);
    if (!current) {
      results.push({ row, key: code, name: parsed.name, action: 'create', errors: [], parsed });
      continue;
    }
    const changes: string[] = [];
    const cmp: Array<[string, unknown, unknown]> = [
      ['name', parsed.name, current.name],
      ['generic name', parsed.genericName, current.genericName],
      ['form', parsed.form, current.form],
      ['strength', parsed.strength, current.strength],
      ['unit', parsed.unit, current.unit],
      ['category', parsed.category, current.category],
      ['reorder level', parsed.reorderLevel, current.reorderLevel],
      ['billing code', parsed.serviceCode, current.serviceCode],
    ];
    for (const [label, next, was] of cmp) if (next !== undefined && next !== was) changes.push(`${label} → ${String(next)}`);
    if (controlled !== null && controlled !== !!current.controlled) changes.push(controlled ? 'marked controlled' : 'not controlled');
    if (active !== null && active !== (current.active !== false)) changes.push(active ? 'activated' : 'deactivated');
    changes.push(...priceChanges);
    results.push({ row, key: code, name: parsed.name, action: changes.length ? 'update' : 'unchanged', errors: [], parsed, changes });
  }

  const summary = summarize(results);
  const publicRows = results.map(({ parsed: _p, ...r }) => r);
  if (!commit) return { committed: false, summary, rows: publicRows };
  if (summary.errors) throw new AppError(422, 'IMPORT_HAS_ERRORS', `Nothing was imported: ${summary.errors} row(s) have problems. Fix them and upload again.`, { summary, rows: publicRows });

  for (const r of results) {
    const p = r.parsed!;
    const fields = Object.fromEntries(Object.entries({ name: p.name, genericName: p.genericName, form: p.form, strength: p.strength, unit: p.unit, category: p.category, reorderLevel: p.reorderLevel, serviceCode: p.serviceCode }).filter(([, v]) => v !== undefined));
    if (r.action === 'create') {
      const category = p.category ?? 'drug';
      const i = await Item.create({ ...fields, code: p.code, unit: p.unit ?? 'unit', category, isDrug: category === 'drug', controlled: p.controlled ?? false, reorderLevel: p.reorderLevel ?? 0, active: p.active ?? true });
      await syncItemPrices(req, i, p.prices);
      await audit(req, { action: 'inventory.item_create', resource: 'item', resourceId: String(i._id), newValue: { ...p, source: 'excel_import' } });
    } else if (r.action === 'update') {
      const set: Record<string, unknown> = { ...fields };
      if (p.category) set.isDrug = p.category === 'drug';
      if (p.controlled !== null) set.controlled = p.controlled;
      if (p.active !== null) set.active = p.active;
      const i = await Item.findOneAndUpdate({ code: p.code }, { $set: set }, { returnDocument: 'after' });
      if (i) await syncItemPrices(req, i, p.prices);
      if (i) await audit(req, { action: 'inventory.item_update', resource: 'item', resourceId: String(i._id), newValue: { ...set, source: 'excel_import' } });
    }
  }
  await audit(req, { action: 'inventory.items_import', resource: 'item', resourceId: 'bulk', newValue: { file: req.file?.originalname, ...summary } });
  return { committed: true, summary, rows: publicRows };
}
