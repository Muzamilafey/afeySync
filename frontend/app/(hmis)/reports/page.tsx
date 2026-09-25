'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart } from 'lucide-react';
import { api, downloadFile } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Button, Card, EmptyState, ErrorText, Input, KV, Loading, PageHeader, Table, Td } from '@/components/ui';
import { cn, fmtDate } from '@/lib/utils';

interface ReportMeta { key: string; title: string; group: string }
interface ReportResult { key: string; title: string; range: { from: string; to: string }; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>>; summary?: Record<string, unknown> }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS: Array<[string, () => { from: string; to: string }]> = [
  ['Today', () => ({ from: iso(new Date()), to: iso(new Date()) })],
  ['Last 7 days', () => ({ from: iso(new Date(Date.now() - 6 * 86400_000)), to: iso(new Date()) })],
  ['This month', () => { const d = new Date(); d.setDate(1); return { from: iso(d), to: iso(new Date()) }; }],
  ['Last 30 days', () => ({ from: iso(new Date(Date.now() - 29 * 86400_000)), to: iso(new Date()) })],
];

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function fmtValue(v: unknown): React.ReactNode {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('en-KE', { maximumFractionDigits: 2 });
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${humanize(k)}: ${typeof x === 'number' ? x.toLocaleString('en-KE') : String(x)}`).join(' · ') || '—';
  return String(v);
}

export default function ReportsPage() {
  const can = useCan();
  const [key, setKey] = useState<string | null>(null);
  const [range, setRange] = useState(PRESETS[3][1]());
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const list = useQuery({ queryKey: ['reports'], queryFn: async () => (await api<ReportMeta[]>('/reports')).data });
  const report = useQuery({ queryKey: ['report', key, range], queryFn: async () => (await api<ReportResult>(`/reports/${key}`, { query: range })).data, enabled: !!key });
  const groups = Object.entries((list.data ?? []).reduce<Record<string, ReportMeta[]>>((acc, r) => ({ ...acc, [r.group]: [...(acc[r.group] ?? []), r] }), {}));
  const r = report.data;
  const exportCsv = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await downloadFile(`/reports/${key}`, `${key}-${range.from}-to-${range.to}.csv`, { query: { ...range, format: 'csv' } });
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Computed live for your branch scope" crumbs={['Finance', 'Reports']} />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card title="Reports" bodyClass="p-2">
          {list.isLoading && <Loading />}
          <ErrorText error={list.error} />
          {groups.map(([g, items]) => (
            <div key={g} className="mb-3">
              <p className="muted px-2 pb-1 text-xs font-semibold uppercase tracking-wide">{g}</p>
              {items.map((x) => (
                <button key={x.key} onClick={() => setKey(x.key)} className={cn('block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]', key === x.key && 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-200')}>
                  {x.title}
                </button>
              ))}
            </div>
          ))}
        </Card>
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-end gap-2">
              {PRESETS.map(([label, fn]) => <Button key={label} size="sm" variant="ghost" onClick={() => setRange(fn())}>{label}</Button>)}
              <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" aria-label="From" />
              <span className="muted pb-2 text-sm">to</span>
              <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" aria-label="To" />
              <div className="ml-auto flex gap-2 print:hidden">
                {key && can('reports.export') && <Button size="sm" variant="secondary" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" /> CSV</Button>}
                {r && <Button size="sm" variant="ghost" onClick={() => window.print()}>Print</Button>}
              </div>
            </div>
            <ErrorText error={exportError} />
          </Card>
          {!key ? (
            <Card><EmptyState title="Select a report" icon={<FileBarChart className="h-6 w-6" />}>Choose a report from the list to run it for the selected period.</EmptyState></Card>
          ) : report.isLoading ? <Loading /> : report.error ? <ErrorText error={report.error} /> : r && (
            <Card title={<span>{r.title} <span className="muted text-sm font-normal">· {fmtDate(r.range.from)} – {fmtDate(r.range.to)}</span></span>}>
              {r.summary && Object.keys(r.summary).length > 0 && <div className="mb-4"><KV items={Object.entries(r.summary).map(([k, v]) => [humanize(k), fmtValue(v)])} /></div>}
              <Table head={r.columns.map((c) => c.label)} empty={r.rows.length === 0}>
                {r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <Td key={c.key}>{fmtValue(row[c.key])}</Td>)}</tr>)}
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
