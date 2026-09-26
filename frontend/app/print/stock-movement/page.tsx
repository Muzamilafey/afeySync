'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface Row { itemId: string; code: string; name: string; unit: string; opening: number; received: number; issued: number; adjusted: number; closing: number }

function Report() {
  const sp = useSearchParams();
  const query = Object.fromEntries(['from', 'to', 'locationId', 'category', 'q'].map((k) => [k, sp.get(k) ?? undefined]));
  const q = useQuery({ queryKey: ['movement-report-print', query], queryFn: () => api<Row[]>('/inventory/stock/movement-report', { query }) });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const cell = 'border border-slate-300 px-2 py-1';
  return (
    <div className="space-y-4 text-sm">
      <PrintButton />
      <Letterhead title="STOCK MOVEMENT REPORT" meta={<p className="text-xs">{fmtDate(String(q.data.meta?.from))} to {fmtDate(String(q.data.meta?.to))}<br />Printed {fmtDateTime(new Date())}</p>} />
      {query.category && <p className="capitalize">Category: {query.category}</p>}
      {query.q && <p>Items matching: “{query.q}”</p>}
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-slate-100 text-left">{['Code', 'Item', 'Unit', 'Opening', 'Received', 'Issued', 'Adjusted', 'Closing'].map((h) => <th key={h} className={cell}>{h}</th>)}</tr></thead>
        <tbody>{q.data.data.map((r) => <tr key={r.itemId}><td className={`${cell} font-mono`}>{r.code}</td><td className={cell}>{r.name}</td><td className={cell}>{r.unit}</td><td className={cell}>{r.opening}</td><td className={cell}>{r.received}</td><td className={cell}>{r.issued}</td><td className={cell}>{r.adjusted}</td><td className={`${cell} font-semibold`}>{r.closing}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function StockMovementPrint() {
  return <Suspense><Report /></Suspense>;
}
