'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import { useMe } from '@/hooks/useMe';

interface Z {
  date: string;
  sales: { count: number; gross: number; paid: number; awaitingPayment: number; returnsValue: number };
  collections: { byMethod: Record<string, number>; total: number };
  bySeller: Array<{ name: string; sales: number; value: number }>;
  itemsSold: Array<{ name: string; quantity: number; value: number }>;
  dispensing: { opdPrescriptions: number; wardRequests: number; byPerson: Array<{ name: string; prescriptions: number; units: number }> };
}
const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ZReport() {
  const date = useSearchParams().get('date') ?? new Date().toISOString().slice(0, 10);
  const me = useMe();
  const q = useQuery({ queryKey: ['z-report', date], queryFn: async () => (await api<Z>('/pharmacy/z-report', { query: { date } })).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const z = q.data;
  const row = 'flex justify-between border-b border-slate-200 py-1';
  return (
    <div className="space-y-5 text-sm">
      <PrintButton />
      <Letterhead title="PHARMACY Z-REPORT" meta={<p className="text-xs">Date: {fmtDate(z.date)}<br />Printed: {fmtDateTime(new Date())}<br />By: {me.data?.user.name}</p>} />
      <section>
        <h2 className="mb-1 font-bold">Counter sales</h2>
        <p className={row}><span>Number of sales</span><span>{z.sales.count}</span></p>
        <p className={row}><span>Gross sales</span><span>{kes(z.sales.gross)}</span></p>
        <p className={row}><span>Returns</span><span>{kes(z.sales.returnsValue)}</span></p>
        <p className={row}><span>Awaiting payment</span><span>{z.sales.awaitingPayment}</span></p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">Collections by method</h2>
        {Object.entries(z.collections.byMethod).map(([m, v]) => <p key={m} className={row}><span className="capitalize">{m}</span><span>{kes(v)}</span></p>)}
        <p className="flex justify-between py-1 font-bold"><span>Total collected</span><span>{kes(z.collections.total)}</span></p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">By staff</h2>
        {z.bySeller.map((s) => <p key={s.name} className={row}><span>{s.name}</span><span>{s.sales} sale(s) · {kes(s.value)}</span></p>)}
      </section>
      <section>
        <h2 className="mb-1 font-bold">Items sold</h2>
        <table className="w-full"><thead><tr className="border-b border-slate-400 text-left"><th>Item</th><th className="text-right">Qty</th><th className="text-right">Value</th></tr></thead>
          <tbody>{z.itemsSold.map((i) => <tr key={i.name} className="border-b border-slate-200"><td className="py-1">{i.name}</td><td className="text-right">{i.quantity}</td><td className="text-right">{kes(i.value)}</td></tr>)}</tbody>
        </table>
      </section>
      <section>
        <h2 className="mb-1 font-bold">Dispensing summary (prescriptions)</h2>
        <p className={row}><span>Outpatient prescriptions dispensed</span><span>{z.dispensing.opdPrescriptions}</span></p>
        <p className={row}><span>Ward requests dispensed</span><span>{z.dispensing.wardRequests}</span></p>
        {z.dispensing.byPerson.map((p) => <p key={p.name} className={row}><span>{p.name}</span><span>{p.prescriptions} dispense(s) · {p.units} unit(s)</span></p>)}
      </section>
      <div className="grid grid-cols-2 gap-10 pt-10 text-xs"><p className="border-t border-slate-500 pt-1">Pharmacist in charge</p><p className="border-t border-slate-500 pt-1">Cashier / Accounts</p></div>
    </div>
  );
}

export default function ZReportPage() {
  return <Suspense fallback={<p>Loading…</p>}><ZReport /></Suspense>;
}
