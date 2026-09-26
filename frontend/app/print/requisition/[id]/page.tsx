'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface Req {
  reqNumber: string; status: string; urgency: string; notes?: string; createdAt: string; requestedByName?: string; decidedByName?: string; decidedAt?: string; receivedByName?: string; receivedAt?: string;
  fromLocationId: { name: string } | null; toLocationId: { name: string } | null;
  items: Array<{ _id: string; name: string; unit?: string; quantity: number; approvedQuantity?: number; issuedQuantity?: number }>;
  issues: Array<{ at: string; byName: string; reference: string; lines: Array<{ batchNumber: string; quantity: number }> }>;
}

/** Requisition and issue note: goes with the items from the store to the department. */
export default function RequisitionPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['requisition', id], queryFn: async () => (await api<Req>(`/inventory/requisitions/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const r = q.data;
  const cell = 'border border-slate-300 px-2 py-1';
  return (
    <div className="space-y-4 text-sm">
      <PrintButton />
      <Letterhead title={r.issues.length ? 'REQUISITION & ISSUE NOTE' : 'STORES REQUISITION'} meta={<p className="text-xs">{r.reqNumber}<br />{fmtDateTime(r.createdAt)}<br />{r.urgency === 'urgent' ? 'URGENT' : 'Routine'}</p>} />
      <p>From store: <strong>{r.fromLocationId?.name}</strong> · To: <strong>{r.toLocationId?.name}</strong> · Status: {r.status.replace('_', ' ')}</p>
      {r.notes && <p>Notes: {r.notes}</p>}
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-slate-100 text-left">{['#', 'Item', 'Unit', 'Requested', 'Approved', 'Issued', 'Received'].map((h) => <th key={h} className={cell}>{h}</th>)}</tr></thead>
        <tbody>{r.items.map((i, n) => <tr key={i._id}><td className={cell}>{n + 1}</td><td className={cell}>{i.name}</td><td className={cell}>{i.unit}</td><td className={cell}>{i.quantity}</td><td className={cell}>{i.approvedQuantity ?? ''}</td><td className={cell}>{i.issuedQuantity || ''}</td><td className={`${cell} w-20`} /></tr>)}</tbody>
      </table>
      {r.issues.length > 0 && <p className="text-xs">Batches issued: {r.issues.map((s) => `${s.reference} (${s.lines.map((l) => `${l.batchNumber} × ${l.quantity}`).join(', ')})`).join('; ')}</p>}
      <div className="grid grid-cols-4 gap-4 pt-8 text-xs">
        {[['Requested by', r.requestedByName], ['Approved by', r.decidedByName], ['Issued by', r.issues.at(-1)?.byName], ['Received by', r.receivedByName]].map(([k, v]) => <div key={k}><p className="border-t border-slate-400 pt-1">{k}: {v}</p><p className="mt-4">Signature &amp; date</p></div>)}
      </div>
    </div>
  );
}
