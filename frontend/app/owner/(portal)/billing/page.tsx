'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, FileText, Plus, Receipt, Settings2, Wallet } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Badge, Button, ErrorText, Input, Loading, PageHeader, Select, Stat, Table, Tabs, Td } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { STATUS_TONE, money, type BillingDocument, type DocType, type Payment } from '@/features/billing-docs/shared';

type Tab = 'invoice' | 'quotation' | 'contract' | 'payments';

function Payments() {
  const q = useQuery({ queryKey: ['owner-payments'], queryFn: async () => (await ownerApi<Payment[]>('/billing/payments', { query: { limit: 200 } })).data });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  return (
    <Table head={['Date', 'Method', 'Reference', 'Invoice', 'Amount', 'Status', 'Recorded by']} empty={!q.data.length}>
      {q.data.map((p) => (
        <tr key={p._id}>
          <Td className="text-xs">{fmtDateTime(p.receivedAt ?? p.createdAt)}</Td>
          <Td className="capitalize">{p.method.replace('_', ' ')}</Td>
          <Td className="font-mono text-xs">{p.reference ?? p.mpesa?.receiptNumber ?? '—'}</Td>
          <Td>{p.document ? <Link className="text-brand-600" href={`/owner/billing/${p.document._id}`}>{p.document.number}</Link> : <Badge tone="amber">unallocated{p.mpesa?.billRef ? ` · ${p.mpesa.billRef}` : ''}</Badge>}</Td>
          <Td>{money(p.amount)}</Td>
          <Td><Badge tone={p.status === 'completed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>{p.status}</Badge>{p.status === 'failed' && p.mpesa?.resultDesc && <div className="muted text-xs">{p.mpesa.resultDesc}</div>}</Td>
          <Td className="text-xs">{p.recordedByName ?? p.initiatedBy ?? (p.method.startsWith('mpesa') ? 'M-Pesa' : '—')}</Td>
        </tr>
      ))}
    </Table>
  );
}

function BillingInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) || 'invoice';
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const docs = useQuery({
    queryKey: ['owner-docs', tab, status, q],
    queryFn: async () => ownerApi<BillingDocument[]>('/billing/documents', { query: { type: tab, status: status || undefined, q: q.trim() || undefined, limit: 200 } }),
    enabled: tab !== 'payments',
  });
  const summary = useQuery({ queryKey: ['owner-docs-summary'], queryFn: async () => (await ownerApi<BillingDocument[]>('/billing/documents', { query: { limit: 1 } })).meta as { outstanding: number; openInvoices: number } });
  const setTab = (t: Tab) => router.replace(`/owner/billing?tab=${t}`);
  return (
    <>
      <PageHeader
        title="Billing"
        crumbs={['Owner', 'Billing']}
        subtitle="Quotations, invoices and service agreements for facilities — signed automatically with your signature and stamp"
        actions={<div className="flex flex-wrap gap-2"><Link href="/owner/billing/settings"><Button variant="outline"><Settings2 className="h-4 w-4" /> Settings & signature</Button></Link><Link href={`/owner/billing/new?type=${tab === 'payments' ? 'invoice' : tab}`}><Button><Plus className="h-4 w-4" /> New {tab === 'contract' ? 'agreement' : tab === 'payments' ? 'invoice' : tab}</Button></Link></div>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Outstanding" value={money(summary.data?.outstanding)} tone="amber" icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Open invoices" value={summary.data?.openInvoices ?? 0} icon={<Receipt className="h-4 w-4" />} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'invoice', label: 'Invoices' }, { key: 'quotation', label: 'Quotations' }, { key: 'contract', label: 'Agreements' }, { key: 'payments', label: 'Payments' }]} />
      {tab === 'payments' ? <Payments /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Input className="max-w-xs" placeholder="Number or customer" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
          </div>
          {docs.isLoading ? <Loading /> : docs.error ? <ErrorText error={docs.error} /> : (
            <Table head={['Number', 'Customer', 'Date', tab === 'invoice' ? 'Due' : tab === 'quotation' ? 'Valid until' : 'Start', 'Total', tab === 'invoice' ? 'Balance' : 'Signed', 'Status']} empty={!docs.data?.data.length}>
              {docs.data?.data.map((d) => (
                <tr key={d._id} className="cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => router.push(`/owner/billing/${d._id}`)}>
                  <Td><span className="inline-flex items-center gap-2 font-medium text-brand-600">{(d.type as DocType) === 'contract' ? <FileSignature className="h-4 w-4" /> : <FileText className="h-4 w-4" />}{d.number}</span></Td>
                  <Td>{d.customer?.name}{!d.tenantId && <span className="muted ml-1 text-xs">(prospect)</span>}</Td>
                  <Td className="text-xs">{fmtDate(d.issueDate ?? d.createdAt)}</Td>
                  <Td className="text-xs">{fmtDate(d.type === 'invoice' ? d.dueDate : d.type === 'quotation' ? d.validUntil : d.contract?.startDate)}</Td>
                  <Td>{money(d.type === 'contract' ? d.contract?.amount : d.total, d.currency)}</Td>
                  <Td>{d.type === 'invoice' ? money(d.balance, d.currency) : d.signing?.signedAt ? <Badge tone="green">signed</Badge> : '—'}</Td>
                  <Td><Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge></Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </>
  );
}

export default function OwnerBillingPage() {
  return <Suspense><BillingInner /></Suspense>;
}
