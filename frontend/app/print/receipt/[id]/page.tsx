'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { fmtDateTime, money } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';

interface R { payment: { receiptNumber: string; amount: number; method: string; reference?: string; receivedByName?: string; completedAt?: string; createdAt: string; mpesa?: { receiptNumber?: string } }; invoice: { invoiceNumber: string; totals: { net: number; paid: number; balance: number } }; patient: { patientNumber: string; firstName: string; lastName: string }; branch: { branchName: string; phone?: string; physicalAddress?: string }; facility: string }

export default function ReceiptPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['receipt', id], queryFn: async () => (await api<R>(`/billing/payments/${id}/receipt`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const r = q.data;
  return (
    <div className="font-mono text-sm">
      <PrintButton />
      <div className="mx-auto max-w-xs space-y-1 border border-dashed p-4">
        <p className="text-center text-base font-bold">{r.facility}</p>
        <p className="text-center text-xs">{r.branch.branchName} {r.branch.phone && `· ${r.branch.phone}`}</p>
        <p className="border-y border-dashed py-1 text-center font-bold">OFFICIAL RECEIPT</p>
        <p>Receipt: {r.payment.receiptNumber}</p>
        <p>Date: {fmtDateTime(r.payment.completedAt ?? r.payment.createdAt)}</p>
        <p>Patient: {r.patient.firstName} {r.patient.lastName}</p>
        <p>No: {r.patient.patientNumber}</p>
        <p>Invoice: {r.invoice.invoiceNumber}</p>
        <p className="border-t border-dashed pt-1">Method: {r.payment.method.toUpperCase()} {r.payment.mpesa?.receiptNumber ?? r.payment.reference ?? ''}</p>
        <p className="text-lg font-bold">Paid: {money(r.payment.amount)}</p>
        <p>Balance: {money(r.invoice.totals.balance)}</p>
        <p className="border-t border-dashed pt-1 text-xs">Served by: {r.payment.receivedByName}</p>
        <p className="text-center text-xs">Thank you. Get well soon.</p>
      </div>
    </div>
  );
}
