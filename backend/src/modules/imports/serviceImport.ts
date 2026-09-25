import type { Request } from 'express';
import { SERVICE_CATEGORIES } from '../../models/tenant/billing';
import { meta } from '../../models/meta';
import { publicBranding } from '../branding/brandingService';
import { audit } from '../audit/auditService';
import { AppError } from '../../utils/errors';
import { buildTemplate, parseNumber, readImport, summarize, yesNo, type ImportColumn, type RowResult } from './excel';

const DEFAULT_PRICE_LISTS = ['cash', 'sha', 'insurance', 'foreigner'];
const CODE_RE = /^[A-Za-z0-9-_.]+$/;
const LIST_RE = /^[a-z0-9_-]{2,40}$/;
const priceHeader = (list: string) => `Price: ${list} (KES)`;

export async function priceLists(req: Request) {
  const used = (await req.tenant!.models.ServiceItem.distinct('prices.priceList')) as string[];
  return [...new Set([...DEFAULT_PRICE_LISTS, ...used.filter((l) => LIST_RE.test(l))])];
}

function columns(lists: string[]): ImportColumn[] {
  return [
    { key: 'code', header: 'Code', required: true, width: 14, note: 'Unique service code, e.g. CONS-GP. Letters, numbers and - _ . only. An existing code updates that service.' },
    { key: 'name', header: 'Name', required: true, width: 36, note: 'Service name as it appears on invoices.' },
    { key: 'category', header: 'Category', required: true, width: 16, list: SERVICE_CATEGORIES },
    { key: 'department', header: 'Department', width: 18, note: 'Optional, e.g. OPD, Laboratory.' },
    { key: 'shaInterventionCode', header: 'SHA intervention code', width: 22, note: 'Optional. The SHA intervention code this service maps to for claims.' },
    { key: 'active', header: 'Active', width: 10, kind: 'yesno', note: 'Yes or No. Blank means Yes for new services and no change for existing ones.' },
    ...lists.map((l): ImportColumn => ({ key: `price:${l}`, header: priceHeader(l), width: 18, kind: 'number', note: `Price in KES on the "${l}" price list. Leave blank to skip this price list (existing prices are kept).` })),
  ];
}

export async function serviceTemplate(req: Request) {
  const tenant = await meta().Tenant.findById(req.tenant!.id).select('name slug branding').lean();
  const brand = publicBranding(tenant!);
  const lists = await priceLists(req);
  return buildTemplate({
    facility: brand.name,
    color: brand.primaryColor,
    title: 'Services & prices',
    sheetName: 'Services',
    columns: columns(lists),
    examples: [
      { code: 'CONS-GP', name: 'General consultation', category: 'consultation', department: 'OPD', active: 'Yes', 'price:cash': 1000, 'price:sha': 1000, 'price:insurance': 1500, 'price:foreigner': 2500 },
      { code: 'LAB-FBC', name: 'Full blood count', category: 'laboratory', department: 'Laboratory', active: 'Yes', 'price:cash': 800, 'price:insurance': 1200 },
      { code: 'RAD-CXR', name: 'Chest X-ray', category: 'radiology', department: 'Radiology', active: 'Yes', 'price:cash': 2500, 'price:sha': 2000 },
      { code: 'BED-GEN', name: 'General ward bed (per day)', category: 'bed', department: 'Inpatient', active: 'Yes', 'price:cash': 3000 },
    ],
    instructions: [
      'Fill in the "Services" sheet from row 4, one service per row. Columns marked * are required.',
      'Code identifies the service. If the code already exists, that service is updated; otherwise a new service is created.',
      'Enter prices as plain numbers in KES (no currency symbol needed). Leave a price blank to skip that price list; existing prices on other lists are kept.',
      `Current price lists: ${lists.join(', ')}. To add a new price list, add a column titled "Price: <name> (KES)", using lower-case letters, numbers, - or _ for the name.`,
      'Upload the file on Billing → Services → Import from Excel. You will see a preview with any problems per row before anything is saved.',
      'Nothing is saved if any row has a problem. Fix the rows shown and upload again.',
    ],
  });
}

interface ParsedService { code: string; name: string; category: (typeof SERVICE_CATEGORIES)[number]; department?: string; shaInterventionCode?: string; active: boolean | null; prices: Array<{ priceList: string; amount: number }> }

export async function importServices(req: Request, commit: boolean) {
  const lists = await priceLists(req);
  const rows = await readImport(req.file, columns(lists), (h) => {
    const m = /^price:\s*([a-z0-9_-]{2,40})(\s*\(kes\))?$/.exec(h);
    return m ? `price:${m[1]}` : null;
  });
  const { ServiceItem } = req.tenant!.models;
  const codes = rows.map((r) => r.values.code?.toUpperCase()).filter(Boolean);
  const existing = new Map((await ServiceItem.find({ code: { $in: codes } }).lean()).map((s) => [s.code, s]));
  const seen = new Map<string, number>();
  const results: Array<RowResult & { parsed?: ParsedService }> = [];

  for (const { row, values } of rows) {
    const errors: string[] = [];
    const code = (values.code ?? '').trim().toUpperCase();
    const name = (values.name ?? '').trim();
    const category = (values.category ?? '').trim().toLowerCase();
    if (!code) errors.push('Code is required');
    else if (!CODE_RE.test(code) || code.length > 30) errors.push('Code can only contain letters, numbers and - _ . (up to 30 characters)');
    else if (seen.has(code)) errors.push(`Code ${code} is also on row ${seen.get(code)}`);
    if (code) seen.set(code, row);
    const current = code ? existing.get(code) : undefined;
    if (!name && !current) errors.push('Name is required');
    else if (name && (name.length < 2 || name.length > 160)) errors.push('Name must be 2 to 160 characters');
    if (!category && !current) errors.push('Category is required');
    else if (category && !(SERVICE_CATEGORIES as readonly string[]).includes(category)) errors.push(`Category must be one of: ${SERVICE_CATEGORIES.join(', ')}`);
    const active = yesNo(values.active ?? '');
    if (active === undefined) errors.push('Active must be Yes or No');
    const prices: Array<{ priceList: string; amount: number }> = [];
    for (const [k, v] of Object.entries(values)) {
      if (!k.startsWith('price:') || !v) continue;
      const n = parseNumber(v);
      const list = k.slice(6);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0 || n > 10_000_000) errors.push(`${priceHeader(list)} must be a number between 0 and 10,000,000`);
      else prices.push({ priceList: list, amount: Math.round(n * 100) / 100 });
    }
    if (!current && !prices.length) errors.push('Enter at least one price for a new service');
    if ((values.department ?? '').length > 80) errors.push('Department must be at most 80 characters');
    if ((values.shaInterventionCode ?? '').length > 40) errors.push('SHA intervention code must be at most 40 characters');

    if (errors.length) {
      results.push({ row, key: code || `(row ${row})`, name, action: 'error', errors });
      continue;
    }
    const parsed: ParsedService = { code, name: name || current!.name, category: (category || current!.category) as ParsedService['category'], department: values.department || undefined, shaInterventionCode: values.shaInterventionCode || undefined, active, prices };
    if (!current) {
      results.push({ row, key: code, name: parsed.name, action: 'create', errors: [], parsed, changes: prices.map((p) => `${p.priceList}: ${p.amount}`) });
      continue;
    }
    const changes: string[] = [];
    if (name && name !== current.name) changes.push(`name → ${name}`);
    if (category && category !== current.category) changes.push(`category → ${category}`);
    if (values.department && values.department !== (current.department ?? '')) changes.push(`department → ${values.department}`);
    if (values.shaInterventionCode && values.shaInterventionCode !== (current.shaInterventionCode ?? '')) changes.push(`SHA code → ${values.shaInterventionCode}`);
    if (active !== null && active !== (current.active !== false)) changes.push(active ? 'activated' : 'deactivated');
    for (const p of prices) {
      const was = current.prices?.find((x) => x.priceList === p.priceList)?.amount;
      if (was !== p.amount) changes.push(`${p.priceList}: ${was ?? '—'} → ${p.amount}`);
    }
    results.push({ row, key: code, name: parsed.name, action: changes.length ? 'update' : 'unchanged', errors: [], parsed, changes });
  }

  const summary = summarize(results);
  const publicRows = results.map(({ parsed: _p, ...r }) => r);
  if (!commit) return { committed: false, summary, rows: publicRows };
  if (summary.errors) throw new AppError(422, 'IMPORT_HAS_ERRORS', `Nothing was imported: ${summary.errors} row(s) have problems. Fix them and upload again.`, { summary, rows: publicRows });

  for (const r of results) {
    const p = r.parsed!;
    if (r.action === 'create') {
      const s = await ServiceItem.create({ code: p.code, name: p.name, category: p.category, department: p.department, shaInterventionCode: p.shaInterventionCode, active: p.active ?? true, prices: p.prices });
      await audit(req, { action: 'billing.service_create', resource: 'service_item', resourceId: String(s._id), newValue: { ...p, source: 'excel_import' } });
    } else if (r.action === 'update') {
      const s = await ServiceItem.findOne({ code: p.code });
      if (!s) continue;
      const before = s.toObject();
      const merged = [...(s.prices ?? []).map((x) => ({ priceList: x.priceList, amount: x.amount }))];
      for (const np of p.prices) {
        const i = merged.findIndex((x) => x.priceList === np.priceList);
        if (i >= 0) merged[i] = np;
        else merged.push(np);
      }
      s.set({ name: p.name, category: p.category, ...(p.department ? { department: p.department } : {}), ...(p.shaInterventionCode ? { shaInterventionCode: p.shaInterventionCode } : {}), ...(p.active !== null ? { active: p.active } : {}), prices: merged });
      await s.save();
      await audit(req, { action: 'billing.price_change', resource: 'service_item', resourceId: String(s._id), oldValue: before, newValue: { ...s.toObject(), source: 'excel_import' } });
    }
  }
  await audit(req, { action: 'billing.services_import', resource: 'service_item', resourceId: 'bulk', newValue: { file: req.file?.originalname, ...summary } });
  return { committed: true, summary, rows: publicRows };
}
