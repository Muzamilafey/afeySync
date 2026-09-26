'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';

interface Data {
  sale: { saleNumber: string; createdAt: string; customerName?: string; customerPhone?: string; walkIn: boolean; soldByName?: string; status: string; total: number; externalPrescription?: { prescriber?: string; facility?: string; reference?: string }; lines: Array<{ name: string; quantity: number; unitPrice: number; amount: number; returnedQuantity?: number; batches: Array<{ batchNumber: string; expiryDate: string }> }> };
  invoice: { invoiceNumber: string; status: string; totals: { net: number; paid: number; balance: number; credited?: number } } | null;
  payments: Array<{ receiptNumber?: string; method: string; amount: number; reference?: string }>;
  location: { name: string } | null;
}
const kes = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Counter-sale receipt, narrow enough for an 80 mm receipt printer and fine on A4. */
export default function PosReceipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['pos-sale', id], queryFn: async () => (await api<Data>(`/pharmacy/sales/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const { sale: s, invoice, payments } = q.data;
  return (
    <div className="mx-auto max-w-sm space-y-3 text-xs">
      <PrintButton />
      <Letterhead compact title="PHARMACY RECEIPT" />
      <div className="flex justify-between"><span>{s.saleNumber}</span><span>{fmtDateTime(s.createdAt)}</span></div>
      <p>Customer: <strong>{s.customerName}</strong>{s.customerPhone ? ` · ${s.customerPhone}` : ''}</p>
      {s.externalPrescription?.prescriber && <p>Prescribed by: {s.externalPrescription.prescriber}{s.externalPrescription.facility ? `, ${s.externalPrescription.facility}` : ''}{s.externalPrescription.reference ? ` (Rx ${s.externalPrescription.reference})` : ''}</p>}
      <table className="w-full border-y border-dashed border-slate-500">
        <thead><tr className="text-left"><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-1">{l.name}<br /><span className="text-[10px] text-slate-500">Batch {l.batches.map((b) => b.batchNumber).join(', ')}</span>{l.returnedQuantity ? <><br /><span className="text-[10px]">Returned: {l.returnedQuantity}</span></> : null}</td>
              <td className="text-right">{l.quantity}</td><td className="text-right">{kes(l.unitPrice)}</td><td className="text-right">{kes(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-0.5 text-right">
        <p className="text-sm font-bold">TOTAL KES {kes(invoice?.totals.net ?? s.total)}</p>
        {payments.map((p, i) => <p key={i}>{p.method.toUpperCase()}{p.reference ? ` ${p.reference}` : ''}: {kes(p.amount)}{p.receiptNumber ? ` · ${p.receiptNumber}` : ''}</p>)}
        {invoice && invoice.totals.balance > 0 && <p className="font-semibold">BALANCE DUE: {kes(invoice.totals.balance)} (pay at cashier, {invoice.invoiceNumber})</p>}
      </div>
      <p>Served by: {s.soldByName} · {q.data.location?.name}</p>
      <p className="border-t border-dashed border-slate-500 pt-2 text-center">Take medicines as directed. Keep out of reach of children. Thank you.</p>
    </div>
  );
}
