'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Td, statusTone } from '@/components/ui';
import { fmtDate, money } from '@/lib/utils';

interface Summary {
  collections: number; collectionsByMethod: Record<string, number>; refunds: number; expenses: number; expensesByCategory: Record<string, number>; netCash: number;
  receivables: { total: number; aging: Record<string, number>; byPayer: Record<string, number> };
  shaReceivables: { claimed: number; approved: number; byStatus: Record<string, number> };
}
interface Expense { _id: string; expenseNumber: string; category: string; description?: string; amount: number; paidTo?: string; method?: string; reference?: string; date: string; status: string; recordedBy: string }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const CATEGORIES = ['Salaries', 'Utilities', 'Rent', 'Medical supplies', 'Maintenance', 'Transport', 'Communication', 'Professional fees', 'Taxes & licences', 'Other'];

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="muted text-sm">Nothing in this period.</p> : (
        <ul className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <li key={k}>
              <div className="flex justify-between"><span className="capitalize">{k.replace(/_/g, ' ')}</span><span className="font-medium">{money(v)}</span></div>
              <div className="mt-1 h-1.5 rounded bg-[var(--surface-2)]"><div className="h-1.5 rounded bg-brand-500" style={{ width: `${(v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function FinancePage() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [tab, setTab] = useState<'overview' | 'expenses'>('overview');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'Utilities', description: '', amount: '', paidTo: '', method: 'mpesa', reference: '', date: today() });
  const summary = useQuery({ queryKey: ['finance-summary', range], queryFn: async () => (await api<Summary>('/finance/summary', { query: range })).data });
  const expenses = useQuery({ queryKey: ['expenses', range, status], queryFn: async () => (await api<Expense[]>('/finance/expenses', { query: { ...range, status, limit: 100 } })).data, enabled: tab === 'expenses' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }); };
  const create = useMutation({
    mutationFn: () => api('/finance/expenses', { method: 'POST', body: { ...f, amount: Number(f.amount), description: f.description || undefined, paidTo: f.paidTo || undefined, reference: f.reference || undefined } }),
    onSuccess: () => { setOpen(false); setF({ ...f, description: '', amount: '', paidTo: '', reference: '' }); setTab('expenses'); refresh(); },
  });
  const decide = useMutation({ mutationFn: ({ id, d }: { id: string; d: 'approve' | 'reject' }) => api(`/finance/expenses/${id}/${d}`, { method: 'POST' }), onSuccess: refresh });
  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Cash-basis summary for the selected period and branch scope"
        crumbs={['Finance']}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" aria-label="From" />
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" aria-label="To" />
            {can('finance.manage') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record expense</Button>}
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'expenses', label: 'Expenses' }]} />
      {tab === 'overview' && (summary.isLoading ? <Loading /> : summary.error ? <ErrorText error={summary.error} /> : s && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Collections" value={money(s.collections)} tone="green" />
            <Stat label="Refunds" value={money(s.refunds)} tone="amber" />
            <Stat label="Approved expenses" value={money(s.expenses)} tone="red" />
            <Stat label="Net cash" value={money(s.netCash)} tone={s.netCash >= 0 ? 'green' : 'red'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Breakdown title="Collections by method" data={s.collectionsByMethod} />
            <Breakdown title="Expenses by category" data={s.expensesByCategory} />
            <Card title="Receivables (open invoices)">
              <p className="mb-3 text-2xl font-semibold">{money(s.receivables.total)}</p>
              <Table head={['Age (days)', 'Balance']}>
                {['0-30', '31-60', '61-90', '90+'].map((b) => <tr key={b}><Td>{b}</Td><Td>{money(s.receivables.aging[b] ?? 0)}</Td></tr>)}
              </Table>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title="Receivables by payer" data={s.receivables.byPayer} />
            <Card title="SHA receivables (open claims)">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Stat label="Claimed" value={money(s.shaReceivables.claimed)} />
                <Stat label="Approved" value={money(s.shaReceivables.approved)} tone="green" />
              </div>
              <ul className="space-y-1 text-sm">{Object.entries(s.shaReceivables.byStatus).map(([k, v]) => <li key={k} className="flex justify-between"><Badge tone={statusTone(k)}>{k.replace(/_/g, ' ')}</Badge><span>{money(v)}</span></li>)}</ul>
            </Card>
          </div>
        </div>
      ))}
      {tab === 'expenses' && (
        <Card actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select>}>
          <ErrorText error={decide.error} />
          {expenses.isLoading && <Loading />}
          <Table head={['No.', 'Date', 'Category', 'Paid to', 'Method / ref', 'Amount', 'Status', '']} empty={(expenses.data ?? []).length === 0}>
            {expenses.data?.map((e) => (
              <tr key={e._id}>
                <Td className="font-mono text-xs">{e.expenseNumber}</Td>
                <Td>{fmtDate(e.date)}</Td>
                <Td>{e.category}<span className="muted block text-xs">{e.description}</span></Td>
                <Td>{e.paidTo ?? '—'}</Td>
                <Td className="text-xs">{e.method ?? '—'} {e.reference && <span className="muted block">{e.reference}</span>}</Td>
                <Td className="font-medium">{money(e.amount)}</Td>
                <Td><Badge tone={statusTone(e.status)}>{e.status}</Badge></Td>
                <Td className="whitespace-nowrap text-right">
                  {e.status === 'pending' && can('finance.manage') && (e.recordedBy === me.data?.user.id ? <span className="muted text-xs">Needs another approver</span> : <>
                    <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: e._id, d: 'approve' })}>Approve</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: e._id, d: 'reject' })}>Reject</Button>
                  </>)}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Record expense">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Amount (KES)"><Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Paid to"><Input value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['cash', 'mpesa', 'bank', 'cheque', 'card'].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <p className="muted text-xs sm:col-span-2">Expenses count in reports only after approval by a second finance user.</p>
          <div className="space-y-2 sm:col-span-2"><ErrorText error={create.error} /><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!(Number(f.amount) > 0)}>Save</Button></div>
        </div>
      </Modal>
    </>
  );
}
