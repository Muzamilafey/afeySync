'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDateTime, money } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import type { Invoice } from '@/features/billing/types';

export default function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['invoice', id], queryFn: async () => (await api<Invoice>(`/billing/invoices/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const inv = q.data;
  return (
    <div className="text-sm">
      <PrintButton />
      <Letterhead title="INVOICE" meta={<><p>{inv.invoiceNumber}</p><p className="text-xs">{fmtDateTime(inv.createdAt)}</p></>} />
      <p className="my-3">Bill to: <strong>{inv.patient?.firstName} {inv.patient?.lastName}</strong> ({inv.patient?.patientNumber}) · Payer: {inv.payer.type.toUpperCase()}</p>
      <table className="w-full border-collapse">
        <thead><tr className="border-b text-left"><th className="py-1">Service</th><th>Qty</th><th>Unit</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{inv.lines.filter((l) => !l.voided).map((l) => <tr key={l._id} className="border-b"><td className="py-1">{l.description}</td><td>{l.quantity}</td><td>{money(l.unitPrice)}</td><td className="text-right">{money(l.amount)}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 ml-auto w-64 space-y-1">
        {([['Gross', inv.totals.gross], ['Discounts', inv.totals.discount + inv.totals.waiver], ['Net', inv.totals.net], ['Paid', inv.totals.paid], ['Balance due', inv.totals.balance]] as Array<[string, number]>).map(([k, v]) => <p key={k} className="flex justify-between"><span>{k}</span><span>{money(v)}</span></p>)}
      </div>
    </div>
  );
}
