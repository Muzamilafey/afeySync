'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Input, Loading, PageHeader, Select, Stat, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { Invoice } from '@/features/billing/types';
import { NewInvoiceModal } from '@/features/billing/NewInvoiceModal';

interface Summary { byMethod: Array<{ _id: string; total: number; count: number }>; byCashier: Array<{ _id: string; total: number; count: number }>; refunds: Array<{ _id: string; total: number }>; outstanding: { total: number; count: number }; unallocatedPayments: number }

export default function BillingPage() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [outstanding, setOutstanding] = useState(true);
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['invoices', status, q, outstanding], queryFn: () => api<Invoice[]>('/billing/invoices', { query: { status, q, outstanding: outstanding ? 'true' : undefined, limit: 50 } }) });
  const summary = useQuery({ queryKey: ['billing-summary'], queryFn: async () => (await api<Summary>('/billing/summary')).data, refetchInterval: 60_000 });
  const total = (summary.data?.byMethod ?? []).reduce((s, m) => s + m.total, 0);
  return (
    <>
      <PageHeader title="Billing & Cashier" crumbs={['Billing']} actions={can('billing.create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New invoice</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Collections today" value={money(total)} tone="green" />
        {['cash', 'mpesa', 'card'].map((m) => <Stat key={m} label={m.toUpperCase()} value={money(summary.data?.byMethod.find((x) => x._id === m)?.total ?? 0)} />)}
        <Stat label="Outstanding" value={money(summary.data?.outstanding.total ?? 0)} tone="amber" hint={`${summary.data?.outstanding.count ?? 0} invoices · ${summary.data?.unallocatedPayments ?? 0} unallocated payments`} />
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input className="max-w-60" placeholder="Invoice number" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {['open', 'issued', 'partially_paid', 'paid', 'void'].map((s) => <option key={s}>{s}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={outstanding} onChange={(e) => setOutstanding(e.target.checked)} /> Outstanding only</label>
          <Link href="/billing/reconciliation" className="ml-auto text-sm text-brand-600">Reconciliation →</Link>
        </div>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error} />
        {list.data && (
          <Table head={['Invoice', 'Patient', 'Payer', 'Net', 'Paid', 'Balance', 'Status', 'Date']} empty={list.data.data.length === 0}>
            {list.data.data.map((i) => {
              const p = typeof i.patientId === 'object' ? i.patientId : null;
              return (
                <tr key={i._id} className="hover:bg-[var(--surface-2)]">
                  <Td><Link href={`/billing/invoices/${i._id}`} className="font-mono text-xs font-semibold text-brand-600">{i.invoiceNumber}</Link></Td>
                  <Td>{p ? `${p.firstName} ${p.lastName}` : '—'}<span className="muted block text-xs">{p?.patientNumber}</span></Td>
                  <Td className="uppercase">{i.payer?.type}</Td>
                  <Td>{money(i.totals?.net)}</Td>
                  <Td>{money(i.totals?.paid)}</Td>
                  <Td className="font-semibold">{money(i.totals?.balance)}</Td>
                  <Td><Badge tone={statusTone(i.status === 'paid' ? 'completed' : i.status === 'partially_paid' ? 'pending' : i.status)}>{i.status.replace('_', ' ')}</Badge></Td>
                  <Td>{fmtDateTime(i.createdAt)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <NewInvoiceModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
