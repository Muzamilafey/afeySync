import type { Request } from 'express';
import { meta } from '../../models/meta';
import { publicBranding } from '../branding/brandingService';
import { audit } from '../audit/auditService';
import { AppError } from '../../utils/errors';
import { buildTemplate, parseNumber, readImport, summarize, yesNo, type ImportColumn, type RowResult } from './excel';
import { priceLists } from './serviceImport';

/**
 * Lab test catalog import. Two sheets:
 *   Tests       one row per test (optional price columns create/update its billing service)
 *   Parameters  one row per parameter reference range; repeat the parameter for more ranges
 *               (e.g. separate male and female ranges). A panel such as FBC has several parameters.
 * Parameters given for a test replace that test's parameter list; tests without parameter rows keep
 * theirs. Nothing is saved while any row has a problem.
 */
const CODE_RE = /^[A-Za-z0-9-_]+$/;
const TYPES = ['numeric', 'text', 'option'] as const;
const SEXES = ['any', 'male', 'female'] as const;
const AGE_UNITS = ['years', 'months', 'days'] as const;
const DAYS: Record<(typeof AGE_UNITS)[number], number> = { years: 365, months: 30, days: 1 };
const MAX_AGE_DAYS = 54750;
const priceHeader = (list: string) => `Price: ${list} (KES)`;

function testColumns(lists: string[]): ImportColumn[] {
  return [
    { key: 'code', header: 'Test code', required: true, width: 14, note: 'Unique test code, e.g. FBC. Letters, numbers, - and _ only. An existing code updates that test.' },
    { key: 'name', header: 'Test name', required: true, width: 32 },
    { key: 'department', header: 'Department', width: 16, note: 'e.g. Haematology, Chemistry, Microbiology. Defaults to General.' },
    { key: 'specimen', header: 'Specimen', width: 14, note: 'e.g. Blood, Serum, Urine, Stool. Defaults to Blood.' },
    { key: 'container', header: 'Container', width: 16, note: 'e.g. EDTA (purple), Plain (red), Fluoride (grey).' },
    { key: 'turnaroundMinutes', header: 'TAT (minutes)', width: 14, kind: 'integer', note: 'Expected turnaround time in minutes. Defaults to 60.' },
    { key: 'serviceCode', header: 'Billing service code', width: 20, note: 'The billing service charged when this test is ordered. Defaults to LAB-<test code>.' },
    { key: 'active', header: 'Active', width: 10, kind: 'yesno', note: 'Blank means Yes for new tests and no change for existing ones.' },
    ...lists.map((l): ImportColumn => ({ key: `price:${l}`, header: priceHeader(l), width: 18, kind: 'number', note: `Optional. Price of this test on the "${l}" price list; creates or updates the billing service.` })),
  ];
}

const PARAM_COLUMNS: ImportColumn[] = [
  { key: 'testCode', header: 'Test code', required: true, width: 12, note: 'The test this parameter belongs to (from the Tests sheet, or an existing test).' },
  { key: 'code', header: 'Parameter code', required: true, width: 14, note: 'e.g. HB, WBC. For a single-result test you can repeat the test code.' },
  { key: 'name', header: 'Parameter name', required: true, width: 26 },
  { key: 'unit', header: 'Unit', width: 12, note: 'e.g. g/dL, x10^9/L, mmol/L.' },
  { key: 'type', header: 'Result type', width: 12, list: TYPES, note: 'numeric (default), text, or option (choose from a list).' },
  { key: 'options', header: 'Options', width: 24, note: 'For option results: the choices separated by commas, e.g. Positive, Negative.' },
  { key: 'sex', header: 'Sex', width: 9, list: SEXES, note: 'Which patients this range applies to. Defaults to any.' },
  { key: 'ageFrom', header: 'Age from', width: 10, kind: 'number', note: 'Start of the age band (inclusive). Blank = from birth.' },
  { key: 'ageTo', header: 'Age to', width: 10, kind: 'number', note: 'End of the age band. Blank = no upper limit.' },
  { key: 'ageUnit', header: 'Age unit', width: 10, list: AGE_UNITS, note: 'Unit for Age from / Age to. Defaults to years.' },
  { key: 'low', header: 'Normal low', width: 12, kind: 'number' },
  { key: 'high', header: 'Normal high', width: 12, kind: 'number' },
  { key: 'criticalLow', header: 'Critical low', width: 12, kind: 'number', note: 'Values at or below this are flagged critical and alert the clinician.' },
  { key: 'criticalHigh', header: 'Critical high', width: 12, kind: 'number', note: 'Values at or above this are flagged critical and alert the clinician.' },
  { key: 'text', header: 'Reference text', width: 22, note: 'Optional wording shown on reports, e.g. "Negative" or "< 5.6".' },
];

export async function labTestTemplate(req: Request) {
  const tenant = await meta().Tenant.findById(req.tenant!.id).select('name slug branding').lean();
  const brand = publicBranding(tenant!);
  const lists = await priceLists(req);
  return buildTemplate({
    facility: brand.name,
    color: brand.primaryColor,
    title: 'Laboratory tests',
    sheets: [
      {
        sheetName: 'Tests',
        title: 'Laboratory tests',
        columns: testColumns(lists),
        examples: [
          { code: 'FBC', name: 'Full blood count', department: 'Haematology', specimen: 'Blood', container: 'EDTA (purple)', turnaroundMinutes: 60, active: 'Yes', 'price:cash': 800, 'price:insurance': 1200 },
          { code: 'RBS', name: 'Random blood sugar', department: 'Chemistry', specimen: 'Blood', container: 'Fluoride (grey)', turnaroundMinutes: 30, active: 'Yes', 'price:cash': 300 },
          { code: 'MPS', name: 'Malaria parasites (BS for MPs)', department: 'Parasitology', specimen: 'Blood', container: 'EDTA (purple)', turnaroundMinutes: 45, active: 'Yes', 'price:cash': 250 },
        ],
      },
      {
        sheetName: 'Parameters',
        title: 'Test parameters and reference ranges',
        columns: PARAM_COLUMNS,
        examples: [
          { testCode: 'FBC', code: 'HB', name: 'Haemoglobin', unit: 'g/dL', type: 'numeric', sex: 'male', ageFrom: 18, ageUnit: 'years', low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
          { testCode: 'FBC', code: 'HB', name: 'Haemoglobin', unit: 'g/dL', type: 'numeric', sex: 'female', ageFrom: 18, ageUnit: 'years', low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
          { testCode: 'FBC', code: 'WBC', name: 'White cell count', unit: 'x10^9/L', type: 'numeric', low: 4, high: 11, criticalLow: 2, criticalHigh: 30 },
          { testCode: 'FBC', code: 'PLT', name: 'Platelets', unit: 'x10^9/L', type: 'numeric', low: 150, high: 400, criticalLow: 50, criticalHigh: 1000 },
          { testCode: 'RBS', code: 'RBS', name: 'Random blood sugar', unit: 'mmol/L', type: 'numeric', low: 3.9, high: 7.8, criticalLow: 2.5, criticalHigh: 25 },
          { testCode: 'MPS', code: 'MPS', name: 'Malaria parasites', type: 'option', options: 'Not seen, Seen (+), Seen (++), Seen (+++)', text: 'Not seen' },
        ],
      },
    ],
    instructions: [
      'Fill in two sheets from row 4: "Tests" (one row per test) and "Parameters" (one row per parameter reference range). Columns marked * are required.',
      'Test code links the two sheets. A new test needs at least one row on the Parameters sheet.',
      'For several reference ranges on one parameter (for example male and female, or children and adults), repeat the parameter on another row with the other Sex / Age values. Name, unit and type are taken from its first row.',
      "When a test has rows on the Parameters sheet, they replace that test's parameter list. Tests without parameter rows keep their current parameters.",
      "Price columns are optional. A price creates or updates the test's billing service (LAB-<test code> unless you give another billing service code).",
      'Reference ranges must be verified for your laboratory and population before clinical use.',
      'Upload the file on Laboratory → Test catalog → Import from Excel. You will see a preview with any problems per row before anything is saved. Nothing is saved if any row has a problem.',
    ],
  });
}

interface Range { sex: (typeof SEXES)[number]; ageMinDays: number; ageMaxDays: number; low?: number; high?: number; criticalLow?: number; criticalHigh?: number; text?: string }
interface Param { code: string; name: string; unit?: string; type: (typeof TYPES)[number]; options?: string[]; ranges: Range[] }

const sameParams = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cleanParams = (ps: Array<Record<string, unknown>> = []) =>
  ps.map((p) => ({ code: p.code, name: p.name, unit: p.unit ?? undefined, type: p.type ?? 'numeric', options: (p.options as string[] | undefined)?.length ? p.options : undefined, ranges: ((p.ranges as Array<Record<string, unknown>>) ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null))) }));

export async function importLabTests(req: Request, commit: boolean) {
  const lists = await priceLists(req);
  const priceExtra = (h: string) => {
    const m = /^price:\s*([a-z0-9_-]{2,40})(\s*\(kes\))?$/.exec(h);
    return m ? `price:${m[1]}` : null;
  };
  const testRows = await readImport(req.file, testColumns(lists), priceExtra, { sheet: 'Tests', allowEmpty: true });
  const paramRows = await readImport(req.file, PARAM_COLUMNS, undefined, { sheet: 'Parameters', allowEmpty: true });
  if (!testRows.length && !paramRows.length) throw new AppError(400, 'NO_ROWS', 'The file has no rows to import. Fill in the "Tests" and "Parameters" sheets from row 4.');

  const m = req.tenant!.models;
  const canPrice = req.permissions?.has('billing.prices') ?? false;
  const codes = [...new Set([...testRows.map((r) => r.values.code), ...paramRows.map((r) => r.values.testCode)].map((c) => (c ?? '').trim().toUpperCase()).filter(Boolean))];
  const existing = new Map((await m.LabTest.find({ code: { $in: codes } }).lean()).map((t) => [t.code, t]));

  // ---- Parameters sheet: group ranges into parameters per test
  const params = new Map<string, { firstRow: number; list: Param[]; errors: string[] }>();
  for (const { row, values } of paramRows) {
    const testCode = (values.testCode ?? '').trim().toUpperCase();
    const g = params.get(testCode) ?? { firstRow: row, list: [], errors: [] };
    params.set(testCode, g);
    const err = (e: string) => g.errors.push(`Parameters row ${row}: ${e}`);
    const code = (values.code ?? '').trim().toUpperCase();
    const name = (values.name ?? '').trim();
    if (!testCode) { err('Test code is required'); continue; }
    if (!code) err('Parameter code is required');
    else if (code.length > 20) err('Parameter code must be at most 20 characters');
    const type = ((values.type ?? '').trim().toLowerCase() || 'numeric') as Param['type'];
    if (!(TYPES as readonly string[]).includes(type)) err(`Result type must be one of: ${TYPES.join(', ')}`);
    const sex = ((values.sex ?? '').trim().toLowerCase() || 'any') as Range['sex'];
    if (!(SEXES as readonly string[]).includes(sex)) err(`Sex must be one of: ${SEXES.join(', ')}`);
    const unitName = ((values.ageUnit ?? '').trim().toLowerCase() || 'years') as (typeof AGE_UNITS)[number];
    if (!(AGE_UNITS as readonly string[]).includes(unitName)) err(`Age unit must be one of: ${AGE_UNITS.join(', ')}`);
    const num: Record<string, number | undefined> = {};
    for (const k of ['ageFrom', 'ageTo', 'low', 'high', 'criticalLow', 'criticalHigh'] as const) {
      const n = parseNumber(values[k] ?? '');
      if (n === null) continue;
      if (Number.isNaN(n)) err(`${PARAM_COLUMNS.find((c) => c.key === k)!.header} must be a number`);
      else num[k] = n;
    }
    const f = DAYS[unitName] ?? 365;
    const ageMinDays = num.ageFrom !== undefined ? Math.round(num.ageFrom * f) : 0;
    const ageMaxDays = num.ageTo !== undefined ? Math.min(MAX_AGE_DAYS, Math.round(num.ageTo * f)) : MAX_AGE_DAYS;
    if (ageMinDays < 0 || ageMinDays >= ageMaxDays) err('Age from must be less than Age to');
    if (num.low !== undefined && num.high !== undefined && num.low > num.high) err('Normal low must not be above Normal high');
    if (num.criticalLow !== undefined && num.low !== undefined && num.criticalLow > num.low) err('Critical low must not be above Normal low');
    if (num.criticalHigh !== undefined && num.high !== undefined && num.criticalHigh < num.high) err('Critical high must not be below Normal high');
    if ((values.text ?? '').length > 80) err('Reference text must be at most 80 characters');
    if (!code) continue;
    let p = g.list.find((x) => x.code === code);
    if (!p) {
      if (!name) err('Parameter name is required');
      else if (name.length > 120) err('Parameter name must be at most 120 characters');
      const options = (values.options ?? '').split(',').map((o) => o.trim()).filter(Boolean);
      if (type === 'option' && !options.length) err('Option results need Options, separated by commas');
      if (options.length > 20 || options.some((o) => o.length > 60)) err('Up to 20 options of at most 60 characters each');
      p = { code, name, unit: values.unit || undefined, type, options: options.length ? options : undefined, ranges: [] };
      g.list.push(p);
      if (g.list.length > 40) err('A test can have at most 40 parameters');
    }
    const hasRange = ['low', 'high', 'criticalLow', 'criticalHigh', 'ageFrom', 'ageTo'].some((k) => num[k] !== undefined) || !!values.text || (values.sex ?? '').trim();
    if (hasRange) {
      const r: Range = { sex, ageMinDays, ageMaxDays, low: num.low, high: num.high, criticalLow: num.criticalLow, criticalHigh: num.criticalHigh, text: values.text || undefined };
      if (p.ranges.some((x) => x.sex === r.sex && x.ageMinDays < r.ageMaxDays && r.ageMinDays < x.ageMaxDays)) err(`${code}: this range overlaps another ${sex === 'any' ? '' : `${sex} `}range for the same ages`);
      p.ranges.push(r);
      if (p.ranges.length > 12) err(`${code}: at most 12 reference ranges per parameter`);
    }
  }

  // ---- Tests sheet
  type Planned = { code: string; name: string; fields: Record<string, unknown>; parameters?: Param[]; prices: Array<{ priceList: string; amount: number }>; serviceCode: string; active: boolean | null };
  const results: Array<RowResult & { plan?: Planned }> = [];
  const seen = new Map<string, number>();
  const handled = new Set<string>();

  const finish = (row: number, sheet: string, code: string, name: string, errors: string[], plan?: Planned) => {
    if (errors.length || !plan) return results.push({ row, sheet, key: code || `(row ${row})`, name, action: 'error', errors });
    const cur = existing.get(code);
    if (!cur) return results.push({ row, sheet, key: code, name, action: 'create', errors: [], plan, changes: [`${plan.parameters!.length} parameter(s)`, ...plan.prices.map((p) => `${p.priceList}: ${p.amount}`)] });
    const changes: string[] = [];
    for (const [k, v] of Object.entries(plan.fields)) if (v !== undefined && v !== (cur as Record<string, unknown>)[k]) changes.push(`${k === 'turnaroundMinutes' ? 'TAT' : k} → ${String(v)}`);
    if (plan.active !== null && plan.active !== (cur.active !== false)) changes.push(plan.active ? 'activated' : 'deactivated');
    if (plan.parameters && !sameParams(cleanParams(plan.parameters as never), cleanParams(cur.parameters as never))) changes.push(`parameters replaced (${cur.parameters?.length ?? 0} → ${plan.parameters.length})`);
    if (plan.prices.length) changes.push(...plan.prices.map((p) => `${p.priceList} price → ${p.amount}`));
    results.push({ row, sheet, key: code, name: name || cur.name, action: changes.length ? 'update' : 'unchanged', errors: [], plan, changes });
  };

  for (const { row, values } of testRows) {
    const errors: string[] = [];
    const code = (values.code ?? '').trim().toUpperCase();
    const name = (values.name ?? '').trim();
    if (!code) errors.push('Test code is required');
    else if (!CODE_RE.test(code) || code.length > 30) errors.push('Test code can only contain letters, numbers, - and _ (up to 30 characters)');
    else if (seen.has(code)) errors.push(`Test code ${code} is also on Tests row ${seen.get(code)}`);
    if (code) { seen.set(code, row); handled.add(code); }
    const cur = code ? existing.get(code) : undefined;
    if (!name && !cur) errors.push('Test name is required');
    else if (name && (name.length < 2 || name.length > 160)) errors.push('Test name must be 2 to 160 characters');
    const tat = parseNumber(values.turnaroundMinutes ?? '');
    if (tat !== null && (Number.isNaN(tat) || !Number.isInteger(tat) || tat < 1 || tat > 20160)) errors.push('TAT (minutes) must be a whole number from 1 to 20160');
    const active = yesNo(values.active ?? '');
    if (active === undefined) errors.push('Active must be Yes or No');
    for (const [k, max] of [['department', 60], ['specimen', 80], ['container', 60], ['serviceCode', 40]] as const) if ((values[k] ?? '').length > max) errors.push(`${k} must be at most ${max} characters`);
    const prices: Array<{ priceList: string; amount: number }> = [];
    for (const [k, v] of Object.entries(values)) {
      if (!k.startsWith('price:') || !v) continue;
      const n = parseNumber(v);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0 || n > 10_000_000) errors.push(`${priceHeader(k.slice(6))} must be a number between 0 and 10,000,000`);
      else prices.push({ priceList: k.slice(6), amount: Math.round(n * 100) / 100 });
    }
    if (prices.length && !canPrice) errors.push('You do not have permission to set prices (billing.prices). Leave the price columns empty or ask a billing administrator.');
    const g = code ? params.get(code) : undefined;
    if (g) errors.push(...g.errors);
    if (!cur && !g?.list.length) errors.push('Add at least one row for this test on the Parameters sheet');
    const serviceCode = (values.serviceCode || cur?.serviceCode || `LAB-${code}`).toUpperCase();
    finish(row, 'Tests', code, name, errors, errors.length ? undefined : {
      code,
      name: name || cur!.name,
      fields: { name: name || undefined, department: values.department || undefined, specimen: values.specimen || undefined, container: values.container || undefined, turnaroundMinutes: tat ?? undefined, serviceCode: values.serviceCode ? values.serviceCode.toUpperCase() : undefined },
      parameters: g?.list.length ? g.list : undefined,
      prices,
      serviceCode,
      active,
    });
  }
  // Parameter rows for tests that are not on the Tests sheet: only for existing tests.
  for (const [code, g] of params) {
    if (handled.has(code)) continue;
    const cur = code ? existing.get(code) : undefined;
    const errors = [...g.errors];
    if (code && !cur) errors.push(`Test ${code} is not on the Tests sheet and does not exist yet. Add it to the Tests sheet.`);
    finish(g.firstRow, 'Parameters', code, cur?.name ?? '', errors, errors.length ? undefined : { code, name: cur!.name, fields: {}, parameters: g.list, prices: [], serviceCode: cur!.serviceCode ?? `LAB-${code}`, active: null });
  }

  const summary = summarize(results);
  const publicRows = results.map(({ plan: _p, ...r }) => r);
  if (!commit) return { committed: false, summary, rows: publicRows };
  if (summary.errors) throw new AppError(422, 'IMPORT_HAS_ERRORS', `Nothing was imported: ${summary.errors} row(s) have problems. Fix them and upload again.`, { summary, rows: publicRows });

  for (const r of results) {
    if (r.action !== 'create' && r.action !== 'update') continue;
    const p = r.plan!;
    const fields = Object.fromEntries(Object.entries(p.fields).filter(([, v]) => v !== undefined));
    if (r.action === 'create') {
      const t = await m.LabTest.create({ ...fields, code: p.code, name: p.name, parameters: p.parameters, active: p.active ?? true, serviceCode: p.serviceCode });
      await audit(req, { action: 'lab.test_create', resource: 'lab_test', resourceId: t.code, newValue: { ...fields, parameters: p.parameters, source: 'excel_import' } });
    } else {
      const t = await m.LabTest.findOne({ code: p.code });
      if (!t) continue;
      const before = t.toObject();
      t.set({ ...fields, ...(p.parameters ? { parameters: p.parameters } : {}), ...(p.active !== null ? { active: p.active } : {}) });
      await t.save();
      await audit(req, { action: 'lab.test_update', resource: 'lab_test', resourceId: t.code, oldValue: before, newValue: { ...t.toObject(), source: 'excel_import' } });
    }
    if (p.prices.length) {
      const s = await m.ServiceItem.findOne({ code: p.serviceCode });
      if (!s) {
        const created = await m.ServiceItem.create({ code: p.serviceCode, name: p.name, category: 'laboratory', department: (p.fields.department as string) || 'Laboratory', prices: p.prices, active: true });
        await audit(req, { action: 'billing.service_create', resource: 'service_item', resourceId: String(created._id), newValue: { code: p.serviceCode, prices: p.prices, source: 'lab_excel_import' } });
      } else {
        const before = s.toObject();
        const merged = (s.prices ?? []).map((x) => ({ priceList: x.priceList, amount: x.amount }));
        for (const np of p.prices) {
          const i = merged.findIndex((x) => x.priceList === np.priceList);
          if (i >= 0) merged[i] = np;
          else merged.push(np);
        }
        s.set({ prices: merged });
        await s.save();
        await audit(req, { action: 'billing.price_change', resource: 'service_item', resourceId: String(s._id), oldValue: before, newValue: { ...s.toObject(), source: 'lab_excel_import' } });
      }
    }
  }
  await audit(req, { action: 'lab.tests_import', resource: 'lab_test', resourceId: 'bulk', newValue: { file: req.file?.originalname, ...summary } });
  return { committed: true, summary, rows: publicRows };
}
