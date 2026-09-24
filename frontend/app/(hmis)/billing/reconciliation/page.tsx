'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Button, Card, ErrorText, Input, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { Invoice, Payment } from '@/features/billing/types';

export default function ReconciliationPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [sel, setSel] = useState<Payment | null>(null);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['unallocated'], queryFn: async () => (await api<Payment[]>('/billing/payments', { query: { status: 'unallocated', limit: 100 } })).data });
  const invoices = useQuery({ queryKey: ['recon-invoices', q], queryFn: async () => (await api<Invoice[]>('/billing/invoices', { query: { q, outstanding: 'true', limit: 10 } })).data, enabled: !!sel });
  const alloc = useMutation({ mutationFn: (invoiceId: string) => api(`/billing/payments/${sel!._id}/allocate`, { method: 'POST', body: { invoiceId } }), onSuccess: () => { setSel(null); qc.invalidateQueries({ queryKey: ['unallocated'] }); } });
  return (
    <>
      <PageHeader title="Payment Reconciliation" crumbs={['Billing', 'Reconciliation']} subtitle="M-Pesa paybill (C2B) payments whose account reference did not match an open invoice." />
      <Card>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error} />
        {list.data && (
          <Table head={['Received', 'M-Pesa receipt', 'Payer', 'Phone', 'Account ref', 'Amount', '']} empty={list.data.length === 0}>
            {list.data.map((p) => (
              <tr key={p._id}>
                <Td>{fmtDateTime(p.createdAt)}</Td>
                <Td className="font-mono text-xs">{p.mpesa?.receiptNumber}</Td>
                <Td>{p.mpesa?.payerName ?? '—'}</Td>
                <Td>{p.mpesa?.phone}</Td>
                <Td className="font-mono text-xs">{p.mpesa?.billRefNumber || '—'}</Td>
                <Td className="font-semibold">{money(p.amount)}</Td>
                <Td>{can('billing.create') && <Button size="sm" onClick={() => setSel(p)}>Allocate</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Allocate ${money(sel?.amount)} (${sel?.mpesa?.receiptNumber})`} wide>
        <div className="space-y-3">
          <Input placeholder="Invoice number" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} />
          <ErrorText error={alloc.error} />
          {invoices.data?.length === 0 && <Alert tone="amber">No outstanding invoice matches.</Alert>}
          <ul className="divide-y divide-[var(--border)]">
            {invoices.data?.map((i) => {
              const p = typeof i.patientId === 'object' ? i.patientId : null;
              return (
                <li key={i._id} className="flex items-center justify-between py-2 text-sm">
                  <span><span className="font-mono">{i.invoiceNumber}</span> · {p?.firstName} {p?.lastName} · balance {money(i.totals.balance)}</span>
                  <Button size="sm" onClick={() => alloc.mutate(i._id)} disabled={(sel?.amount ?? 0) > i.totals.balance}>Allocate here</Button>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    </>
  );
}
