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

function applyValidation(ws: ExcelJS.Worksheet, columns: ImportColumn[], rows: number) {
  const dv = (ws as unknown as { dataValidations: RangeValidations }).dataValidations;
  columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const ref = `${letter}${FIRST_DATA_ROW}:${letter}${FIRST_DATA_ROW + rows - 1}`;
    const list = c.kind === 'yesno' ? ['Yes', 'No'] : c.list;
    if (list?.length) {
      // Excel accepts an inline list up to 255 characters.
      dv.add(ref, { type: 'list', allowBlank: !c.required, formulae: [`"${list.join(',')}"`], showErrorMessage: true, errorTitle: c.header, error: `Choose one of: ${list.join(', ')}` });
    } else if (c.kind === 'number' || c.kind === 'integer') {
      dv.add(ref, { type: c.kind === 'integer' ? 'whole' : 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: c.header, error: 'Enter a number of 0 or more' });
      ws.getColumn(i + 1).numFmt = c.kind === 'integer' ? '#,##0' : '#,##0.00';
    }
  });
}

export async function buildTemplate(opts: { facility: string; color?: string | null; title: string; sheetName: string; columns: ImportColumn[]; examples: Array<Record<string, unknown>>; instructions: string[] }) {
  const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? opts.color! : '#0b8a72';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AfeySync';
  wb.created = new Date();

  const data = wb.addWorksheet(opts.sheetName, { properties: { tabColor: { argb: argb(color) } } });
  headerRows(data, opts.columns, `${opts.facility} · ${opts.title}`, 'Fill in one row per entry from row 4. Columns marked * are required. See the Instructions and Examples sheets. Do not rename the header row.', color);
  applyValidation(data, opts.columns, 2000);
  for (let r = FIRST_DATA_ROW; r < FIRST_DATA_ROW + 200; r++) {
    if (r % 2 === 0) data.getRow(r).eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }));
  }

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 26;
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
  r++;
  const head = help.getRow(r);
  head.values = ['Column', 'What to enter'];
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(mix(color, 0.85)) } }));
  r++;
  for (const c of opts.columns) {
    const allowed = c.kind === 'yesno' ? 'Yes or No' : c.list ? `One of: ${c.list.join(', ')}` : '';
    help.getRow(r).values = [`${c.header}${c.required ? ' (required)' : ''}`, [c.note, allowed].filter(Boolean).join(' ')];
    help.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' };
    help.getCell(`A${r}`).font = { bold: !!c.required };
    r++;
  }

  const ex = wb.addWorksheet('Examples');
  headerRows(ex, opts.columns, 'Examples (for reference only, this sheet is not imported)', 'Copy the pattern into the first sheet.', color);
  opts.examples.forEach((e, i) => {
    const row = ex.getRow(FIRST_DATA_ROW + i);
    opts.columns.forEach((c, j) => (row.getCell(j + 1).value = (e[c.key] ?? null) as ExcelJS.CellValue));
  });

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
export async function readImport(file: Express.Multer.File | undefined, columns: ImportColumn[], extraHeader?: (header: string) => string | null): Promise<ReadRow[]> {
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
    if (/^(instructions|examples)$/i.test(ws.name)) continue;
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
      if (!rows.length) throw new AppError(400, 'NO_ROWS', 'The file has no rows to import. Fill in the first sheet from row 4.');
      return rows;
    }
  }
  throw new AppError(400, 'TEMPLATE_NOT_RECOGNISED', 'The column headers were not recognised. Download the template and keep its header row.');
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

export interface RowResult { row: number; key: string; name?: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: string[]; changes?: string[] }
export function summarize(results: RowResult[]) {
  return {
    total: results.length,
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    errors: results.filter((r) => r.action === 'error').length,
  };
}
