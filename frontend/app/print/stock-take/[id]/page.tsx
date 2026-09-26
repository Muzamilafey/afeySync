'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface Line { _id: string; code: string; name: string; unit: string; batchNumber: string; expiryDate: string; systemQuantity: number; countedQuantity?: number | null; note?: string }
interface Take { takeNumber: string; status: string; category?: string; createdAt: string; createdByName?: string; submittedByName?: string; approvedByName?: string; location?: { name: string } | null; lines: Line[] }

/** The count sheet: blank while counting (counters write on it), filled with counts and variances once submitted. */
export default function StockTakeSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['stock-take', id], queryFn: async () => (await api<Take>(`/inventory/stock-takes/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const st = q.data;
  const blank = st.status === 'counting';
  const cell = 'border border-slate-300 px-2 py-1';
  return (
    <div className="space-y-4 text-sm">
      <PrintButton />
      <Letterhead title="STOCK TAKE SHEET" meta={<p className="text-xs">{st.takeNumber}<br />Started {fmtDateTime(st.createdAt)}<br />Status: {st.status}</p>} />
      <p>Location: <strong>{st.location?.name}</strong> · Items: <strong className="capitalize">{st.category ?? 'All items'}</strong></p>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-slate-100 text-left">{['#', 'Code', 'Item', 'Batch', 'Expiry', 'Unit', blank ? 'System' : 'System', 'Counted', 'Variance', 'Note'].map((h, i) => <th key={i} className={cell}>{h}</th>)}</tr></thead>
        <tbody>
          {st.lines.map((l, i) => {
            const d = l.countedQuantity == null ? null : l.countedQuantity - l.systemQuantity;
            return (
              <tr key={l._id}>
                <td className={cell}>{i + 1}</td><td className={`${cell} font-mono`}>{l.code}</td><td className={cell}>{l.name}</td><td className={`${cell} font-mono`}>{l.batchNumber}</td><td className={cell}>{fmtDate(l.expiryDate)}</td><td className={cell}>{l.unit}</td>
                <td className={cell}>{l.systemQuantity}</td>
                <td className={`${cell} w-20`}>{blank ? '' : l.countedQuantity}</td>
                <td className={`${cell} w-16`}>{d == null ? '' : d > 0 ? `+${d}` : d}</td>
                <td className={`${cell} w-32`}>{l.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="grid grid-cols-3 gap-6 pt-8 text-xs">
        {[['Counted by', st.submittedByName], ['Checked by', ''], ['Approved by', st.approvedByName]].map(([k, v]) => <div key={k}><p className="border-t border-slate-400 pt-1">{k}: {v}</p><p className="mt-4">Signature &amp; date</p></div>)}
      </div>
    </div>
  );
}
