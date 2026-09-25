import ExcelJS from 'exceljs';
import multer from 'multer';
import { AppError } from '../../utils/errors';

/**
 * Excel (.xlsx) templates and bulk import shared by the catalog imports (services & prices, inventory
 * items). Templates carry the facility's name and colour, required-column markers, drop-down lists for
 * fixed values, an Instructions sheet and an Examples sheet. Reading tolerates re-ordered columns,
 * extra columns and blank rows, and reports problems per row.
 */
export interface ImportColumn {
  key: string;
  header: string;
  width?: number;
  required?: boolean;
  note?: string;
  /** Allowed values: shown as a drop-down in Excel and checked on import. */
  list?: readonly string[];
  /** Suggested values: a drop-down in Excel that still accepts other text (not checked on import). */
  suggest?: readonly string[];
  kind?: 'text' | 'number' | 'integer' | 'yesno';
}

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const FIRST_DATA_ROW = 4; // 1: title, 2: subtitle, 3: headers
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 5 } }).single('file');

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const mix = (hex: string, white: number) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v + (255 - v) * white).toString(16).padStart(2, '0')).join('')}`;
};

function headerRows(ws: ExcelJS.Worksheet, columns: ImportColumn[], title: string, subtitle: string, color: string) {
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width ?? Math.max(14, c.header.length + 6) }));
  const last = ws.getColumn(columns.length).letter;
  ws.mergeCells(`A1:${last}1`);
  ws.mergeCells(`A2:${last}2`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  const s = ws.getCell('A2');
  s.value = subtitle;
  s.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(mix(color, 0.9)) } };
  s.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  ws.getRow(2).height = 30;
  const h = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = h.getCell(i + 1);
    cell.value = c.required ? `${c.header} *` : c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.required ? color : mix(color, 0.35)) } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    if (c.note) cell.note = { texts: [{ text: c.note }] };
  });
  h.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 0 }];
}

/** exceljs supports range validations at runtime; its type definitions only describe per-cell ones. */
type RangeValidations = { add(range: string, v: ExcelJS.DataValidation): void };

/** Long drop-down lists live on a hidden "Lists" sheet (Excel's inline lists are limited to 255 characters). */
function listFormula(ws: ExcelJS.Worksheet, values: readonly string[]) {
  const inline = `"${values.join(',')}"`;
  if (inline.length <= 250 && !values.some((v) => v.includes(','))) return inline;
  const wb = ws.workbook;
  const lists = wb.getWorksheet('Lists') ?? wb.addWorksheet('Lists', { state: 'hidden' });
  const col = lists.columnCount + 1;
  values.forEach((v, i) => (lists.getRow(i + 1).getCell(col).value = v));
  const letter = lists.getColumn(col).letter;
  return `Lists!$${letter}$1:$${letter}$${values.length}`;
}

function applyValidation(ws: ExcelJS.Worksheet, columns: ImportColumn[], rows: number) {
  const dv = (ws as unknown as { dataValidations: RangeValidations }).dataValidations;
  columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const ref = `${letter}${FIRST_DATA_ROW}:${letter}${FIRST_DATA_ROW + rows - 1}`;
    const list = c.kind === 'yesno' ? ['Yes', 'No'] : c.list;
    if (c.suggest?.length) {
      dv.add(ref, { type: 'list', allowBlank: true, formulae: [listFormula(ws, c.suggest)], showErrorMessage: true, errorStyle: 'warning', errorTitle: c.header, error: 'This is not one of the usual values. Keep it anyway?' });
    } else if (list?.length) {
      dv.add(ref, { type: 'list', allowBlank: !c.required, formulae: [listFormula(ws, list)], showErrorMessage: true, errorTitle: c.header, error: `Choose one of: ${list.join(', ')}` });
    } else if (c.kind === 'number' || c.kind === 'integer') {
      dv.add(ref, { type: c.kind === 'integer' ? 'whole' : 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: c.header, error: 'Enter a number of 0 or more' });
      ws.getColumn(i + 1).numFmt = c.kind === 'integer' ? '#,##0' : '#,##0.00';
    }
  });
}

export interface TemplateSheet { sheetName: string; title: string; columns: ImportColumn[]; examples: Array<Record<string, unknown>> }

/**
 * Builds a template workbook: the data sheet(s), an Instructions sheet describing every column, and an
 * example sheet per data sheet (named "Examples…", never imported).
 */
export async function buildTemplate(opts: { facility: string; color?: string | null; title: string; instructions: string[] } & ({ sheetName: string; columns: ImportColumn[]; examples: Array<Record<string, unknown>> } | { sheets: TemplateSheet[] })) {
  const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? opts.color! : '#0b8a72';
  const sheets: TemplateSheet[] = 'sheets' in opts ? opts.sheets : [{ sheetName: opts.sheetName, title: opts.title, columns: opts.columns, examples: opts.examples }];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AfeySync';
  wb.created = new Date();

  for (const sh of sheets) {
    const data = wb.addWorksheet(sh.sheetName, { properties: { tabColor: { argb: argb(color) } } });
    headerRows(data, sh.columns, `${opts.facility} · ${sh.title}`, 'Fill in one row per entry from row 4. Columns marked * are required. See the Instructions and Examples sheets. Do not rename the header row.', color);
    applyValidation(data, sh.columns, 2000);
    for (let r = FIRST_DATA_ROW; r < FIRST_DATA_ROW + 200; r++) {
      if (r % 2 === 0) data.getRow(r).eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }));
    }
  }

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 28;
  help.getColumn(2).width = 90;
  help.mergeCells('A1:B1');
  help.getCell('A1').value = `How to fill in: ${opts.title}`;
  help.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  help.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } };
  help.getRow(1).height = 28;
  let r = 3;
  for (const line of opts.instructions) {
    help.mergeCells(`A${r}:B${r}`);
    help.getCell(`A${r}`).value = `• ${line}`;
    help.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'top' };
    help.getRow(r).height = 30;
    r++;
  }
  for (const sh of sheets) {
    r++;
    const head = help.getRow(r);
    head.values = [sheets.length > 1 ? `"${sh.sheetName}" sheet column` : 'Column', 'What to enter'];
    head.font = { bold: true };
    head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(mix(color, 0.85)) } }));
    r++;
    for (const c of sh.columns) {
      const allowed = c.kind === 'yesno' ? 'Yes or No' : c.list ? `One of: ${c.list.join(', ')}` : c.suggest ? `Pick from the list (${c.suggest.length} options) or type your own.` : '';
      help.getRow(r).values = [`${c.header}${c.required ? ' (required)' : ''}`, [c.note, allowed].filter(Boolean).join(' ')];
      help.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' };
      help.getCell(`A${r}`).font = { bold: !!c.required };
      r++;
    }
  }

  for (const sh of sheets) {
    const ex = wb.addWorksheet(sheets.length > 1 ? `Examples - ${sh.sheetName}` : 'Examples');
    headerRows(ex, sh.columns, 'Examples (for reference only, this sheet is not imported)', `Copy the pattern into the "${sh.sheetName}" sheet.`, color);
    sh.examples.forEach((e, i) => {
      const row = ex.getRow(FIRST_DATA_ROW + i);
      sh.columns.forEach((c, j) => (row.getCell(j + 1).value = (e[c.key] ?? null) as ExcelJS.CellValue));
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function sendXlsx(res: import('express').Response, filename: string, buf: Buffer) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}
const norm = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export interface ReadRow { row: number; values: Record<string, string> }

/** Reads the first sheet whose row 1–10 contains the template headers. Header matching ignores case and "*". */
export async function readImport(file: Express.Multer.File | undefined, columns: ImportColumn[], extraHeader?: (header: string) => string | null, opts: { sheet?: string; allowEmpty?: boolean } = {}): Promise<ReadRow[]> {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Choose the filled-in Excel file (.xlsx) to import.');
  if (!/\.xlsx$/i.test(file.originalname) && file.mimetype !== XLSX_MIME) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload an Excel .xlsx file (use the template). Older .xls and CSV files are not supported.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    throw new AppError(400, 'INVALID_FILE', 'This file could not be read as an Excel workbook. Save it as .xlsx and try again.');
  }
  const wanted = new Map(columns.map((c) => [norm(c.header), c.key]));
  for (const ws of wb.worksheets) {
    if (/^(instructions|examples|lists)/i.test(ws.name)) continue;
    if (opts.sheet && ws.name.trim().toLowerCase() !== opts.sheet.toLowerCase()) continue;
    for (let hr = 1; hr <= Math.min(10, ws.rowCount); hr++) {
      const map = new Map<number, string>();
      ws.getRow(hr).eachCell((cell, col) => {
        const text = norm(cellText(cell.value));
        const key = wanted.get(text) ?? extraHeader?.(text) ?? undefined;
        if (key) map.set(col, key);
      });
      const missing = columns.filter((c) => c.required && ![...map.values()].includes(c.key));
      if (map.size < Math.min(2, columns.length) || missing.length) {
        if (map.size >= 2 && missing.length) throw new AppError(400, 'TEMPLATE_COLUMNS_MISSING', `The file is missing required column(s): ${missing.map((c) => c.header).join(', ')}. Download a fresh template.`);
        continue;
      }
      const rows: ReadRow[] = [];
      for (let r = hr + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const values: Record<string, string> = {};
        let any = false;
        for (const [col, key] of map) {
          const t = cellText(row.getCell(col).value).trim();
          values[key] = t;
          if (t) any = true;
        }
        if (!any) continue;
        rows.push({ row: r, values });
        if (rows.length > MAX_IMPORT_ROWS) throw new AppError(413, 'TOO_MANY_ROWS', `A single import can have at most ${MAX_IMPORT_ROWS} rows. Split the file.`);
      }
      if (!rows.length && !opts.allowEmpty) throw new AppError(400, 'NO_ROWS', `The file has no rows to import. Fill in the ${opts.sheet ? `"${opts.sheet}"` : 'first'} sheet from row 4.`);
      return rows;
    }
  }
  if (opts.sheet && opts.allowEmpty) return [];
  throw new AppError(400, 'TEMPLATE_NOT_RECOGNISED', `The column headers${opts.sheet ? ` on the "${opts.sheet}" sheet` : ''} were not recognised. Download the template and keep its header rows.`);
}

export const yesNo = (v: string): boolean | null => {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return undefined as unknown as null;
};
export const parseNumber = (v: string) => {
  const s = v.replace(/,/g, '').replace(/^KES\s*/i, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

export interface RowResult { row: number; sheet?: string; key: string; name?: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: string[]; changes?: string[] }
export function summarize(results: RowResult[]) {
  return {
    total: results.length,
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    errors: results.filter((r) => r.action === 'error').length,
  };
}
