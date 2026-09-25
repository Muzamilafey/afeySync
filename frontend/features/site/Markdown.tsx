import { Fragment, type ReactNode } from 'react';

/**
 * A small Markdown renderer for website articles. It builds React elements directly and never uses raw
 * HTML, so article text cannot run scripts. Supported: # headings, paragraphs, **bold**, *italic*,
 * `code`, [links](https://…), images ![alt](url "caption"), - / 1. lists, > quotes, ``` code blocks,
 * --- rules and | tables |.
 */

const safeHref = (url: string) => (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url.trim()) ? url.trim() : null);
const safeSrc = (url: string) => (/^(https:\/\/|\/api\/v1\/blog\/images\/[0-9a-f]{24}$)/i.test(url.trim()) ? url.trim() : null);
export const headingId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: images before links, code before emphasis.
  const re = /(!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\))|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)|(\n)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) {
      const src = safeSrc(m[3]);
      if (src) out.push(<img key={k} src={src} alt={m[2]} title={m[4]} loading="lazy" className="my-2 inline-block max-w-full rounded-lg" />);
    } else if (m[5]) {
      const href = safeHref(m[7]);
      const external = href ? /^https?:/i.test(href) : false;
      out.push(href ? <a key={k} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>{inline(m[6], k)}</a> : m[6]);
    } else if (m[8]) out.push(<code key={k}>{m[9]}</code>);
    else if (m[10]) out.push(<strong key={k}>{inline(m[11], k)}</strong>);
    else if (m[12]) out.push(<strong key={k}>{inline(m[13], k)}</strong>);
    else if (m[14]) out.push(<em key={k}>{inline(m[15], k)}</em>);
    else if (m[16]) out.push(<em key={k}>{inline(m[17], k)}</em>);
    else if (m[18]) out.push(<br key={k} />);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const isBlockStart = (l: string) => /^(#{1,4}\s|>\s?|```|---+\s*$|\s*[-*]\s+|\s*\d+[.)]\s+|\|)/.test(l) || /^!\[[^\]]*\]\([^)]+\)\s*$/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (!line.trim()) { i++; continue; }

    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const Tag = (['h2', 'h2', 'h3', 'h4'] as const)[level - 1];
      blocks.push(<Tag key={key} id={headingId(text)}>{inline(text, key)}</Tag>);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { blocks.push(<hr key={key} />); i++; continue; }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line.trim());
    if (img) {
      const src = safeSrc(img[2]);
      if (src) {
        blocks.push(
          <figure key={key}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={img[1]} loading="lazy" />
            {(img[3] || img[1]) && <figcaption>{img[3] || img[1]}</figcaption>}
          </figure>,
        );
      }
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(q.join('\n'), key)}</blockquote>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      const itemRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && itemRe.test(lines[i])) {
        let item = lines[i++].replace(itemRe, '');
        // Indented continuation lines belong to the same item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !itemRe.test(lines[i])) item += `\n${lines[i++].trim()}`;
        items.push(item);
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={key}>{items.map((it, j) => <li key={j}>{inline(it, `${key}-${j}`)}</li>)}</L>);
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key} className="md-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}-h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${key}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key}>{inline(para.join('\n'), key)}</p>);
  }
  return <div className={className ?? 'prose-article'}>{blocks.map((x, j) => <Fragment key={j}>{x}</Fragment>)}</div>;
}

/** The article's headings, for a table of contents. */
export function outline(source: string) {
  return source.split('\n').map((l) => /^(#{1,3})\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ level: m[1].length, text: m[2].trim(), id: headingId(m[2].trim()) }));
}
