import JSZip from 'jszip';

/**
 * A values-only .xlsx reader, used when ExcelJS rejects a workbook. ExcelJS is strict about styles,
 * data validations and drawings written by other programs (Google Sheets, LibreOffice, WPS, scripts);
 * an import only needs the cell values, which every valid .xlsx stores the same way.
 */
export interface ValueSheet { name: string; rows: Map<number, Map<number, string>>; rowCount: number }

const decode = (s: string) =>
  s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Text of every <t> inside an element (plain and rich-text runs), ignoring phonetic runs. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join('');

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** "AB12" → column 28. */
const colOf = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.toUpperCase().charCodeAt(0) - 64, 0);

export async function readXlsxValues(buf: Buffer): Promise<ValueSheet[]> {
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? null;
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('not a spreadsheet: xl/workbook.xml missing');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id') ?? '', (attr(m[0], 'Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/')]));
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]));

  const sheets: ValueSheet[] = [];
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)) {
    const name = decode(attr(m[0], 'name') ?? '');
    const path = target.get(attr(m[0], 'r:id') ?? '') ?? '';
    const xml = path ? await read(path) : null;
    if (!xml) continue;
    const rows = new Map<number, Map<number, string>>();
    let rowCount = 0;
    let nextRow = 1;
    for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>|<(?:\w+:)?row\b[^>]*\/>/g)) {
      const r = Number(attr(` ${rm[1] ?? ''}`, 'r')) || nextRow;
      nextRow = r + 1;
      const cells = new Map<number, string>();
      let nextCol = 1;
      for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attr(` ${cm[1]}`, 'r');
        const col = ref ? colOf(ref) : nextCol;
        nextCol = col + 1;
        const type = attr(` ${cm[1]}`, 't');
        const inner = cm[2] ?? '';
        const v = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let text = '';
        if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = textOf(inner);
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (type === 'e') text = '';
        else text = v !== undefined ? decode(v) : '';
        if (text !== '') cells.set(col, text);
      }
      if (cells.size) rows.set(r, cells);
      rowCount = Math.max(rowCount, r);
    }
    sheets.push({ name, rows, rowCount });
  }
  return sheets;
}
