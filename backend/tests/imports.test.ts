import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'importfac';
let admin = '';

async function download(url: string) {
  const res = await t(S, admin).get(url).buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('spreadsheetml');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb;
}
async function fill(wb: ExcelJS.Workbook, rows: Array<Record<string, unknown>>) {
  const ws = wb.worksheets[0];
  const headers = (ws.getRow(3).values as unknown[]).map((v) => String(v ?? '').replace(' *', ''));
  rows.forEach((r, i) => {
    const row = ws.getRow(4 + i);
    for (const [h, v] of Object.entries(r)) row.getCell(headers.indexOf(h)).value = v as ExcelJS.CellValue;
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const upload = (url: string, buf: Buffer, commit = false, token = admin) => t(S, token).post(url).field('commit', String(commit)).attach('file', buf, 'filled.xlsx');

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  await createFacility(owner, S);
  await t(S, (await tenantLogin(S, `admin@${S}.test`)).token).put('/api/v1/admin/branding').send({ displayName: 'Import Test Hospital', primaryColor: '#1d4ed8' });
  admin = (await tenantLogin(S, `admin@${S}.test`)).token;
});
afterAll(teardown);

describe('form validation messages', () => {
  it('accepts one-character codes and names the field and problem in plain language', async () => {
    const ok = await t(S, admin).post('/api/v1/billing/services').send({ code: '1', name: 'pcm', category: 'consultation', prices: [{ priceList: 'cash', amount: 1500 }, { priceList: 'sha', amount: 2500 }] });
    expect(ok.status).toBe(201);
    const item = await t(S, admin).post('/api/v1/inventory/items').send({ code: '1', name: 'test', genericName: 'pcm', form: 'tablets', strength: '500mg', unit: 'unit', category: 'drug', reorderLevel: 100, serviceCode: 'PCM1', controlled: true });
    expect(item.status).toBe(201);
    const bad = await t(S, admin).post('/api/v1/billing/services').send({ code: 'A B', name: 'x', category: 'nope', prices: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/^Please check: Code: can only contain letters, numbers and - _ \.; Name: must be at least 2 characters; Category: must be one of: consultation/);
    expect(bad.body.error.details.map((d: { field: string }) => d.field)).toEqual(['Code', 'Name', 'Category', 'Prices']);
    const dup = await t(S, admin).post('/api/v1/inventory/items').send({ code: '1', name: 'again' });
    expect(dup.status).toBe(409);
  });
});

describe('services & prices import', () => {
  it('provides a branded template with price-list columns, drop-downs, instructions and examples', async () => {
    const wb = await download('/api/v1/billing/services/import-template');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Services', 'Instructions', 'Examples']);
    const ws = wb.getWorksheet('Services')!;
    expect(String(ws.getCell('A1').value)).toBe('Import Test Hospital · Services & prices');
    expect((ws.getCell('A1').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1D4ED8');
    const headers = (ws.getRow(3).values as unknown[]).filter(Boolean).map(String);
    expect(headers.slice(0, 3)).toEqual(['Code *', 'Name *', 'Category *']);
    expect(headers).toEqual(expect.arrayContaining(['Price: cash (KES)', 'Price: sha (KES)', 'Price: insurance (KES)']));
    expect(ws.getCell('C4').dataValidation?.type).toBe('list');
    expect(String(wb.getWorksheet('Examples')!.getCell('A4').value)).toBe('CONS-GP');
    // Only values allowed by the OOXML schema, so Excel opens the file without a repair prompt.
    const raw = Buffer.from(await wb.xlsx.writeBuffer());
    const zip = await JSZip.loadAsync(raw);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<dataValidation');
    for (const m of sheet.matchAll(/errorStyle="([^"]+)"/g)) expect(['stop', 'warning', 'information']).toContain(m[1]);
  });

  it('previews row by row without saving, refuses to import with errors, then imports and updates', async () => {
    const wb = await download('/api/v1/billing/services/import-template');
    const bad = await fill(wb, [
      { Code: 'CONS-GP', Name: 'General consultation', Category: 'consultation', 'Price: cash (KES)': 1000, 'Price: sha (KES)': 1000 },
      { Code: 'LAB-FBC', Name: 'Full blood count', Category: 'lab', 'Price: cash (KES)': 'eight hundred' },
      { Code: 'cons-gp', Name: 'Duplicate', Category: 'consultation', 'Price: cash (KES)': 5 },
    ]);
    const preview = await upload('/api/v1/billing/services/import', bad);
    expect(preview.status).toBe(200);
    expect(preview.body.data.committed).toBe(false);
    expect(preview.body.data.summary).toMatchObject({ total: 3, create: 1, errors: 2 });
    expect(preview.body.data.rows[1]).toMatchObject({ row: 5, action: 'error' });
    expect(preview.body.data.rows[1].errors.join(' ')).toMatch(/Category must be one of.*Price: cash \(KES\) must be a number/);
    expect(preview.body.data.rows[2].errors[0]).toBe('Code CONS-GP is also on row 4');
    const refused = await upload('/api/v1/billing/services/import', bad, true);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('IMPORT_HAS_ERRORS');
    expect((await t(S, admin).get('/api/v1/billing/services?q=CONS-GP')).body.data).toHaveLength(0);

    const good = await fill(await download('/api/v1/billing/services/import-template'), [
      { Code: 'CONS-GP', Name: 'General consultation', Category: 'consultation', Department: 'OPD', 'Price: cash (KES)': 1000, 'Price: sha (KES)': 1000 },
      { Code: 'LAB-FBC', Name: 'Full blood count', Category: 'Laboratory', 'Price: cash (KES)': '1,200', 'Price: insurance (KES)': 1500 },
    ]);
    const done = await upload('/api/v1/billing/services/import', good, true);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ committed: true, summary: { create: 2, errors: 0 } });
    const fbc = (await t(S, admin).get('/api/v1/billing/services?q=LAB-FBC')).body.data[0];
    expect(fbc.prices).toEqual([{ priceList: 'cash', amount: 1200 }, { priceList: 'insurance', amount: 1500 }]);

    // update: change one price, add a new price list column, keep the other prices
    const wb2 = await download('/api/v1/billing/services/import-template');
    const ws = wb2.worksheets[0];
    const next = ws.getRow(3).cellCount + 1;
    ws.getRow(3).getCell(next).value = 'Price: nhif-corporate (KES)';
    const upd = await fill(wb2, [{ Code: 'LAB-FBC', 'Price: cash (KES)': 1300 }, { Code: 'CONS-GP' }]);
    ws.getRow(4).getCell(next).value = 999;
    const buf = Buffer.from(await wb2.xlsx.writeBuffer());
    void upd;
    const p2 = await upload('/api/v1/billing/services/import', buf);
    expect(p2.body.data.summary).toMatchObject({ update: 1, unchanged: 1, errors: 0 });
    expect(p2.body.data.rows[0].changes).toEqual(['cash: 1200 → 1300', 'nhif-corporate: — → 999']);
    await upload('/api/v1/billing/services/import', buf, true);
    const fbc2 = (await t(S, admin).get('/api/v1/billing/services?q=LAB-FBC')).body.data[0];
    expect(fbc2.prices).toEqual([{ priceList: 'cash', amount: 1300 }, { priceList: 'insurance', amount: 1500 }, { priceList: 'nhif-corporate', amount: 999 }]);
    expect(fbc2.name).toBe('Full blood count');
  });

  it('rejects files that are not the template and is limited to price managers', async () => {
    expect((await t(S, admin).post('/api/v1/billing/services/import').attach('file', Buffer.from('a,b\n1,2'), 'prices.csv')).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Foo', 'Bar']);
    const other = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await upload('/api/v1/billing/services/import', other)).body.error.code).toBe('TEMPLATE_NOT_RECOGNISED');
    const nurse = await createUser(S, admin, { email: 'nurse@importfac.test', roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    expect((await upload('/api/v1/billing/services/import', other, false, nurse)).status).toBe(403);
    expect((await t(S, nurse).get('/api/v1/billing/services/import-template')).status).toBe(403);
  });
});

describe('inventory items import', () => {
  it('imports and updates items from the template', async () => {
    const wb = await download('/api/v1/inventory/items/import-template');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Items', 'Instructions', 'Examples']);
    const buf = await fill(wb, [
      { Code: 'PCM500', Name: 'Paracetamol 500mg tablets', 'Generic name': 'Paracetamol', Form: 'tablet', Strength: '500mg', Unit: 'tablet', Category: 'drug', 'Reorder level': 500, 'Controlled drug': 'No' },
      { Code: 'MORPH10', Name: 'Morphine 10mg/ml injection', Category: 'drug', 'Controlled drug': 'Yes', 'Reorder level': 2.5 },
    ]);
    const p = await upload('/api/v1/inventory/items/import', buf);
    expect(p.body.data.summary).toMatchObject({ create: 1, errors: 1 });
    expect(p.body.data.rows[1].errors).toEqual(['Reorder level must be a whole number of 0 or more']);
    const ok = await fill(await download('/api/v1/inventory/items/import-template'), [
      { Code: 'PCM500', Name: 'Paracetamol 500mg tablets', Unit: 'tablet', Category: 'drug', 'Reorder level': 500, 'Controlled drug': 'No' },
      { Code: 'MORPH10', Name: 'Morphine 10mg/ml injection', Category: 'drug', 'Controlled drug': 'Yes', 'Reorder level': 20 },
      { Code: '1', 'Reorder level': 50 },
    ]);
    const done = await upload('/api/v1/inventory/items/import', ok, true);
    expect(done.body.data.summary).toMatchObject({ create: 2, update: 1, errors: 0 });
    const items = (await t(S, admin).get('/api/v1/inventory/items?q=MORPH10')).body.data;
    expect(items.find((i: { code: string }) => i.code === 'MORPH10')).toMatchObject({ controlled: true, reorderLevel: 20, unit: 'unit', isDrug: true });
    const one = (await t(S, admin).get('/api/v1/inventory/items?q=1')).body.data.find((i: { code: string }) => i.code === '1');
    expect(one).toMatchObject({ name: 'test', reorderLevel: 50, controlled: true });
  });
});

describe('lab test catalog import', () => {
  async function fillSheet(wb: ExcelJS.Workbook, sheet: string, rows: Array<Record<string, unknown>>) {
    const ws = wb.getWorksheet(sheet)!;
    const headers = (ws.getRow(3).values as unknown[]).map((v) => String(v ?? '').replace(' *', ''));
    rows.forEach((r, i) => {
      const row = ws.getRow(4 + i);
      for (const [h, v] of Object.entries(r)) {
        const idx = headers.indexOf(h);
        if (idx < 0) throw new Error(`no column ${h} on ${sheet}`);
        row.getCell(idx).value = v as ExcelJS.CellValue;
      }
      row.commit();
    });
  }

  it('provides a two-sheet template with parameters and reference ranges', async () => {
    const wb = await download('/api/v1/laboratory/tests/import-template');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tests', 'Parameters', 'Instructions', 'Examples - Tests', 'Examples - Parameters']);
    const p = (wb.getWorksheet('Parameters')!.getRow(3).values as unknown[]).filter(Boolean).map(String);
    expect(p.slice(0, 3)).toEqual(['Test code *', 'Parameter code *', 'Parameter name *']);
    expect(p).toEqual(expect.arrayContaining(['Sex', 'Age from', 'Age to', 'Age unit', 'Normal low', 'Normal high', 'Critical low', 'Critical high']));
    expect(String(wb.getWorksheet('Examples - Parameters')!.getCell('A4').value)).toBe('FBC');
  });

  it('imports panels with sex- and age-specific ranges and prices, reporting problems per sheet row', async () => {
    const wb = await download('/api/v1/laboratory/tests/import-template');
    await fillSheet(wb, 'Tests', [
      { 'Test code': 'TFBC', 'Test name': 'Full blood count', Department: 'Haematology', Container: 'EDTA', 'TAT (minutes)': 60, 'Price: cash (KES)': 800 },
      { 'Test code': 'TMPS', 'Test name': 'Malaria parasites', Department: 'Parasitology' },
      { 'Test code': 'NOPARAM', 'Test name': 'Forgot parameters' },
    ]);
    await fillSheet(wb, 'Parameters', [
      { 'Test code': 'TFBC', 'Parameter code': 'HB', 'Parameter name': 'Haemoglobin', Unit: 'g/dL', Sex: 'male', 'Age from': 18, 'Normal low': 13, 'Normal high': 17, 'Critical low': 7, 'Critical high': 20 },
      { 'Test code': 'TFBC', 'Parameter code': 'HB', Sex: 'female', 'Age from': 18, 'Normal low': 12, 'Normal high': 15, 'Critical low': 7, 'Critical high': 20 },
      { 'Test code': 'TFBC', 'Parameter code': 'HB', Sex: 'any', 'Age from': 0, 'Age to': 28, 'Age unit': 'days', 'Normal low': 14, 'Normal high': 22 },
      { 'Test code': 'TFBC', 'Parameter code': 'WBC', 'Parameter name': 'White cell count', Unit: 'x10^9/L', 'Normal low': 11, 'Normal high': 4 },
      { 'Test code': 'TMPS', 'Parameter code': 'TMPS', 'Parameter name': 'Malaria parasites', 'Result type': 'option' },
    ]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await upload('/api/v1/laboratory/tests/import', buf);
    expect(p.status).toBe(200);
    expect(p.body.data.summary).toMatchObject({ total: 3, errors: 3 });
    const byKey = Object.fromEntries(p.body.data.rows.map((r: { key: string }) => [r.key, r]));
    expect(byKey.TFBC.errors).toEqual(['Parameters row 7: Normal low must not be above Normal high']);
    expect(byKey.TMPS.errors).toEqual(['Parameters row 8: Option results need Options, separated by commas']);
    expect(byKey.NOPARAM.errors).toEqual(['Add at least one row for this test on the Parameters sheet']);
    expect(byKey.TFBC).toMatchObject({ sheet: 'Tests', row: 4 });

    const wb2 = await download('/api/v1/laboratory/tests/import-template');
    await fillSheet(wb2, 'Tests', [
      { 'Test code': 'TFBC', 'Test name': 'Full blood count', Department: 'Haematology', Container: 'EDTA', 'TAT (minutes)': 60, 'Price: cash (KES)': 800 },
      { 'Test code': 'TMPS', 'Test name': 'Malaria parasites', Department: 'Parasitology' },
    ]);
    await fillSheet(wb2, 'Parameters', [
      { 'Test code': 'TFBC', 'Parameter code': 'HB', 'Parameter name': 'Haemoglobin', Unit: 'g/dL', Sex: 'male', 'Age from': 18, 'Normal low': 13, 'Normal high': 17, 'Critical low': 7, 'Critical high': 20 },
      { 'Test code': 'TFBC', 'Parameter code': 'HB', Sex: 'female', 'Age from': 18, 'Normal low': 12, 'Normal high': 15, 'Critical low': 7, 'Critical high': 20 },
      { 'Test code': 'TFBC', 'Parameter code': 'HB', Sex: 'any', 'Age from': 0, 'Age to': 28, 'Age unit': 'days', 'Normal low': 14, 'Normal high': 22 },
      { 'Test code': 'TFBC', 'Parameter code': 'WBC', 'Parameter name': 'White cell count', Unit: 'x10^9/L', 'Normal low': 4, 'Normal high': 11 },
      { 'Test code': 'TMPS', 'Parameter code': 'TMPS', 'Parameter name': 'Malaria parasites', 'Result type': 'option', Options: 'Not seen, Seen', 'Reference text': 'Not seen' },
    ]);
    const done = await upload('/api/v1/laboratory/tests/import', Buffer.from(await wb2.xlsx.writeBuffer()), true);
    expect(done.status).toBe(200);
    expect(done.body.data.summary).toMatchObject({ create: 2, errors: 0 });
    const fbc = (await t(S, admin).get('/api/v1/laboratory/tests?q=TFBC')).body.data.find((x: { code: string }) => x.code === 'TFBC');
    expect(fbc).toMatchObject({ department: 'Haematology', container: 'EDTA', serviceCode: 'LAB-TFBC' });
    expect(fbc.parameters.map((x: { code: string }) => x.code)).toEqual(['HB', 'WBC']);
    expect(fbc.parameters[0].ranges).toEqual([
      { sex: 'male', ageMinDays: 18 * 365, ageMaxDays: 54750, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
      { sex: 'female', ageMinDays: 18 * 365, ageMaxDays: 54750, low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
      { sex: 'any', ageMinDays: 0, ageMaxDays: 28, low: 14, high: 22 },
    ]);
    const mps = (await t(S, admin).get('/api/v1/laboratory/tests?q=TMPS')).body.data[0];
    expect(mps.parameters[0]).toMatchObject({ type: 'option', options: ['Not seen', 'Seen'] });
    const svc = (await t(S, admin).get('/api/v1/billing/services?q=LAB-TFBC')).body.data[0];
    expect(svc).toMatchObject({ category: 'laboratory', prices: [{ priceList: 'cash', amount: 800 }] });

    // re-importing the same file changes nothing; parameters only on the Parameters sheet update an existing test
    expect((await upload('/api/v1/laboratory/tests/import', Buffer.from(await wb2.xlsx.writeBuffer()))).body.data.summary).toMatchObject({ unchanged: 1 });
    const wb3 = await download('/api/v1/laboratory/tests/import-template');
    await fillSheet(wb3, 'Parameters', [{ 'Test code': 'TMPS', 'Parameter code': 'TMPS', 'Parameter name': 'Malaria parasites', 'Result type': 'option', Options: 'Not seen, Seen (+), Seen (++)' }]);
    const u = await upload('/api/v1/laboratory/tests/import', Buffer.from(await wb3.xlsx.writeBuffer()), true);
    expect(u.body.data.rows[0]).toMatchObject({ sheet: 'Parameters', key: 'TMPS', action: 'update' });
    expect((await t(S, admin).get('/api/v1/laboratory/tests?q=TMPS')).body.data[0].parameters[0].options).toEqual(['Not seen', 'Seen (+)', 'Seen (++)']);
  });

  it('refuses prices from users who cannot manage prices', async () => {
    const lab = await createUser(S, admin, { email: 'labmanager@importfac.test', roleKey: 'lab_manager', branchAccess: 'all', branchIds: [] });
    const perms = (await t(S, lab).get('/api/v1/auth/me')).body.data.permissions as string[];
    expect(perms).toContain('lab.manage');
    expect(perms).not.toContain('billing.prices');
    const wb = await download('/api/v1/laboratory/tests/import-template');
    await fillSheet(wb, 'Tests', [{ 'Test code': 'TFBC', 'Price: cash (KES)': 1 }]);
    const r = await upload('/api/v1/laboratory/tests/import', Buffer.from(await wb.xlsx.writeBuffer()), false, lab);
    expect(r.body.data.rows[0].errors[0]).toMatch(/permission to set prices/);
  });
});

describe('diagnosis catalog import', () => {
  it('imports and updates diagnoses from the template', async () => {
    const wb = await download('/api/v1/diagnoses/import-template');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Diagnoses', 'Instructions', 'Examples']);
    const buf = await fill(wb, [
      { 'Diagnosis / disease': 'Essential hypertension', Code: 'BA00', 'Code system': 'ICD-11', Category: 'Cardiovascular', 'Other names': 'HTN, high blood pressure', 'Offer when admitting': 'No' },
      { 'Diagnosis / disease': 'Severe malaria', 'Notifiable disease': 'Yes' },
      { 'Diagnosis / disease': 'Bad', Code: 'no spaces allowed' },
    ]);
    const p = await upload('/api/v1/diagnoses/import', buf);
    expect(p.body.data.summary).toMatchObject({ create: 1, update: 1, errors: 1 });
    expect(p.body.data.rows[2].errors.join(' ')).toMatch(/Code can only contain/);
    const ok = await fill(await download('/api/v1/diagnoses/import-template'), [
      { 'Diagnosis / disease': 'Essential hypertension', Code: 'BA00', Category: 'Cardiovascular', 'Other names': 'HTN, high blood pressure' },
      { 'Diagnosis / disease': 'severe MALARIA', 'Notifiable disease': 'Yes' },
    ]);
    expect((await upload('/api/v1/diagnoses/import', ok, true)).body.data.summary).toMatchObject({ create: 1, update: 1, errors: 0 });
    const list = (await t(S, admin).get('/api/v1/diagnoses?q=hypertension')).body.data;
    expect(list[0]).toMatchObject({ name: 'Essential hypertension', code: 'BA00', synonyms: ['HTN', 'high blood pressure'], source: 'import' });
    expect((await t(S, admin).get('/api/v1/diagnoses?q=severe malaria')).body.data[0]).toMatchObject({ name: 'Severe malaria', notifiable: true });
  });
});
