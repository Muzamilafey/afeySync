'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Alert, Badge, Button, ErrorText, Modal } from '@/components/ui';
import { apiRaw, downloadFile } from '@/services/api';
import { cn } from '@/lib/utils';

interface RowResult { row: number; sheet?: string; key: string; name?: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: string[]; changes?: string[] }
interface ImportResult { committed: boolean; summary: { total: number; create: number; update: number; unchanged: number; errors: number }; rows: RowResult[] }

const TONE = { create: 'green', update: 'blue', unchanged: 'gray', error: 'red' } as const;
const LABEL = { create: 'New', update: 'Update', unchanged: 'No change', error: 'Problem' } as const;

/**
 * Excel bulk import: download the facility-branded template, upload the filled file, review a
 * row-by-row preview (nothing is saved yet), then import. Nothing is saved while any row has a problem.
 */
export function ExcelImport({ open, onClose, onDone, title, noun, templatePath, templateName, importPath }: { open: boolean; onClose: () => void; onDone: () => void; title: string; noun: string; templatePath: string; templateName: string; importPath: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'template' | 'preview' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setFile(null); setPreview(null); setDone(null); setError(null); setFilter('all'); };
  const close = () => { reset(); onClose(); };

  const send = async (f: File, commit: boolean) => {
    const form = new FormData();
    form.append('commit', String(commit));
    form.append('file', f);
    return ((await (await apiRaw(importPath, { form })).json()) as { data: ImportResult }).data;
  };
  const choose = async (f?: File | null) => {
    if (!f) return;
    setError(null); setPreview(null); setDone(null);
    if (!/\.xlsx$/i.test(f.name)) return setError(new Error('Choose an Excel .xlsx file (use the template).'));
    if (f.size > 5 * 1024 * 1024) return setError(new Error('The file is larger than 5 MB. Split it into smaller files.'));
    setFile(f);
    setBusy('preview');
    try {
      const p = await send(f, false);
      setPreview(p);
      setFilter(p.summary.errors ? 'error' : 'all');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const commit = async () => {
    if (!file) return;
    setBusy('import'); setError(null);
    try {
      setDone(await send(file, true));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const template = async () => {
    setBusy('template');
    try { await downloadFile(templatePath, templateName); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  const s = preview?.summary;
  const rows = preview ? (filter === 'error' ? preview.rows.filter((r) => r.action === 'error') : preview.rows) : [];
  const toImport = s ? s.create + s.update : 0;

  return (
    <Modal open={open} onClose={close} title={title} wide>
      {done ? (
        <div className="space-y-4 py-2 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <div>
            <p className="text-lg font-semibold">Import complete</p>
            <p className="muted text-sm">{done.summary.create} new and {done.summary.update} updated {noun}. {done.summary.unchanged ? `${done.summary.unchanged} had no changes.` : ''}</p>
          </div>
          <div className="flex justify-center gap-2"><Button variant="outline" onClick={reset}>Import another file</Button><Button onClick={close}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              ['1', 'Download the template', 'Branded Excel file with drop-downs, instructions and examples.'],
              ['2', 'Fill it in', 'One row per entry. Existing codes are updated, new codes are added.'],
              ['3', 'Upload and review', 'Check the preview. Nothing is saved until you import.'],
            ].map(([n, h, d]) => (
              <li key={n} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <span className="mb-1 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{n}</span>
                <p className="text-sm font-medium">{h}</p>
                <p className="muted text-xs">{d}</p>
              </li>
            ))}
          </ol>
          <Button variant="outline" onClick={template} loading={busy === 'template'}><Download className="h-4 w-4" /> Download Excel template</Button>

          <div
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition', drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border)] hover:border-brand-500')}
          >
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
            {file ? <FileSpreadsheet className="h-8 w-8 text-emerald-600" /> : <Upload className="h-8 w-8 text-slate-400" />}
            <p className="text-sm font-medium">{busy === 'preview' ? 'Checking the file…' : file ? file.name : 'Drop the filled-in Excel file here, or click to choose'}</p>
            <p className="muted text-xs">.xlsx, up to 5 MB and 5,000 rows</p>
          </div>

          <ErrorText error={error} />

          {s && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="green">{s.create} new</Badge>
                <Badge tone="blue">{s.update} to update</Badge>
                <Badge tone="gray">{s.unchanged} unchanged</Badge>
                {s.errors > 0 && <Badge tone="red">{s.errors} with problems</Badge>}
                <span className="muted ml-auto text-xs">{s.total} rows read</span>
              </div>
              {s.errors > 0 ? (
                <Alert tone="amber" title="Fix these rows, then upload again">Nothing will be imported until every row is valid. Row numbers match the rows in Excel.</Alert>
              ) : toImport === 0 ? (
                <Alert tone="blue">Everything in this file already matches. There is nothing to import.</Alert>
              ) : null}
              {s.errors > 0 && (
                <div className="flex gap-2 text-xs">
                  <button className={cn('rounded px-2 py-1', filter === 'error' ? 'bg-[var(--surface-2)] font-semibold' : 'muted')} onClick={() => setFilter('error')}>Problems only</button>
                  <button className={cn('rounded px-2 py-1', filter === 'all' ? 'bg-[var(--surface-2)] font-semibold' : 'muted')} onClick={() => setFilter('all')}>All rows</button>
                </div>
              )}
              <div className="max-h-80 overflow-auto rounded-lg border border-[var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[var(--surface-2)] text-xs uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Details</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.sheet ?? ''}${r.row}`} className="border-t border-[var(--border)] align-top">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.sheet && <span className="muted mr-1 font-sans">{r.sheet}</span>}{r.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.key}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2"><Badge tone={TONE[r.action]}>{LABEL[r.action]}</Badge></td>
                        <td className="px-3 py-2 text-xs">
                          {r.errors.length ? <ul className="space-y-0.5 text-red-600 dark:text-red-400">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="muted">{r.changes?.join(' · ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={commit} loading={busy === 'import'} disabled={s.errors > 0 || toImport === 0}>Import {toImport} {noun}</Button>
                <Button variant="outline" onClick={() => input.current?.click()}>Choose another file</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
