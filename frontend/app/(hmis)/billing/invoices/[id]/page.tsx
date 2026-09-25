'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Smartphone } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { ServicePicker } from '@/features/billing/ServicePicker';
import { CreateClaimButton } from '@/features/sha/CreateClaimButton';
import { MpesaPayout } from '@/features/billing/MpesaPayout';
import type { Invoice, Payment } from '@/features/billing/types';

const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function PaymentForm({ inv, onDone }: { inv: Invoice; onDone: () => void }) {
  const { data: me } = useMe();
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(inv.totals.balance);
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState(inv.patient?.phone?.replace(/^254/, '0') ?? '');
  const [idem, setIdem] = useState(key);
  const [pending, setPending] = useState<Payment | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice', inv._id] });
  const pay = useMutation({
    mutationFn: () => api<Payment>('/billing/payments', { method: 'POST', body: { invoiceId: inv._id, method, amount: Number(amount), reference: reference || undefined, idempotencyKey: idem } }),
    onSuccess: () => { setIdem(key()); setReference(''); refresh(); onDone(); },
  });
  const stk = useMutation({
    mutationFn: async () => (await api<Payment>('/payments/mpesa/stk', { method: 'POST', body: { invoiceId: inv._id, phone, amount: Number(amount), idempotencyKey: idem } })).data,
    onSuccess: (p) => { setPending(p); setIdem(key()); },
  });
  // Poll the payment while the patient completes the prompt on their phone.
  const poll = useQuery({
    queryKey: ['stk', pending?._id],
    queryFn: async () => (await api<Payment>(`/payments/mpesa/${pending!._id}/query`, { method: 'POST' })).data,
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 5000),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'pending') refresh();
  }, [poll.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const mpesaEnabled = me?.integrations.mpesa.enabled;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa_stk" disabled={!mpesaEnabled}>M-Pesa (STK push){!mpesaEnabled ? ' — disabled' : ''}</option>
            <option value="mpesa">M-Pesa (enter receipt)</option>
            <option value="card">Card</option>
            <option value="bank">Bank</option>
            <option value="insurance">Insurance</option>
          </Select>
        </Field>
        <Field label="Amount (KES)"><Input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        {method === 'mpesa_stk' ? (
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" /></Field>
        ) : method !== 'cash' ? (
          <Field label={method === 'mpesa' ? 'M-Pesa receipt' : 'Reference'}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        ) : null}
      </div>
      <ErrorText error={pay.error || stk.error} />
      {pending && (
        <Alert tone={poll.data?.status === 'completed' ? 'green' : poll.data?.status === 'failed' ? 'red' : 'amber'} title={poll.data?.status === 'completed' ? `Paid — receipt ${poll.data.receiptNumber}` : poll.data?.status === 'failed' ? 'M-Pesa payment failed' : 'Waiting for customer to enter M-Pesa PIN…'}>
          {poll.data?.mpesa?.resultDesc ?? `Prompt sent to ${pending.mpesa?.phone}.`}
        </Alert>
      )}
      {method === 'mpesa_stk' ? (
        <Button onClick={() => stk.mutate()} loading={stk.isPending} disabled={!phone || amount <= 0}><Smartphone className="h-4 w-4" /> Send STK push</Button>
      ) : (
        <Button onClick={() => pay.mutate()} loading={pay.isPending} disabled={amount <= 0}>Receive payment</Button>
      )}
    </div>
  );
}

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: async () => (await api<Invoice>(`/billing/invoices/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice', id] });
  const [modal, setModal] = useState<null | { kind: 'void' | 'reprice'; lineId: string } | { kind: 'adjust' } | { kind: 'refund'; payment: Payment } | { kind: 'credit' }>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(0);
  const [adjType, setAdjType] = useState('discount');
  const [refundMethod, setRefundMethod] = useState('cash');
  const close = () => { setModal(null); setReason(''); setAmount(0); };
  const act = useMutation({
    mutationFn: async () => {
      if (!modal) return;
      if (modal.kind === 'void') return api(`/billing/invoices/${id}/lines/${modal.lineId}/void`, { method: 'POST', body: { reason } });
      if (modal.kind === 'reprice') return api(`/billing/invoices/${id}/lines/${modal.lineId}/reprice`, { method: 'POST', body: { unitPrice: amount, reason } });
      if (modal.kind === 'adjust') return api(`/billing/invoices/${id}/adjustments`, { method: 'POST', body: { type: adjType, amount, reason } });
      if (modal.kind === 'refund') return api(`/billing/payments/${modal.payment._id}/refund`, { method: 'POST', body: { amount, reason, method: refundMethod } });
      if (modal.kind === 'credit') return api(`/billing/invoices/${id}/credit-notes`, { method: 'POST', body: { amount, reason } });
    },
    onSuccess: () => { refresh(); close(); },
  });
  const addLine = useMutation({ mutationFn: (serviceCode: string) => api(`/billing/invoices/${id}/lines`, { method: 'POST', body: { serviceCode, quantity: 1 } }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: () => api(`/billing/invoices/${id}/issue`, { method: 'POST' }), onSuccess: refresh });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const inv = q.data;
  const editable = !['void', 'paid'].includes(inv.status);

  return (
    <>
      <PageHeader
        title={`Invoice ${inv.invoiceNumber}`}
        crumbs={['Billing', 'Invoices', inv.invoiceNumber]}
        subtitle={<Badge tone={statusTone(inv.status === 'paid' ? 'completed' : inv.status === 'partially_paid' ? 'pending' : inv.status)}>{inv.status.replace('_', ' ')}</Badge>}
        actions={
          <>
            {inv.status === 'open' && can('billing.create') && <Button variant="outline" onClick={() => issue.mutate()}>Issue invoice</Button>}
            {inv.payer.type === 'sha' && inv.status !== 'void' && can('sha.claim') && <CreateClaimButton invoiceId={inv._id} />}
            <Link href={`/print/invoice/${inv._id}`} target="_blank"><Button variant="outline"><Printer className="h-4 w-4" /> Print</Button></Link>
          </>
        }
      />
      <ErrorText error={issue.error || addLine.error} />
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          <Card title="Patient & payer">
            <KV items={[['Patient', inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName}` : '—'], ['Number', inv.patient?.patientNumber], ['Payer', `${inv.payer.type.toUpperCase()}${inv.payer.scheme ? ` · ${inv.payer.scheme}` : ''}`], ['Price list', inv.payer.priceList], ['Created', fmtDateTime(inv.createdAt)], ['Visit', inv.visitId ? <Link key="v" className="text-brand-600" href={`/visits/${inv.visitId}`}>Open visit</Link> : 'Walk-in']]} />
          </Card>
          <Card title="Charges" actions={editable && can('billing.create') && <div className="w-72"><ServicePicker priceList={inv.payer.priceList} onPick={(s) => addLine.mutate(s.code)} /></div>}>
            <Table head={['Service', 'Qty', 'Unit', 'Amount', '']}>
              {inv.lines.map((l) => (
                <tr key={l._id} className={l.voided ? 'opacity-50 line-through' : ''}>
                  <Td>{l.description}<span className="muted block text-xs">{l.serviceCode} · {l.category}{l.voided && ` · voided: ${l.voidReason}`}</span></Td>
                  <Td>{l.quantity}</Td>
                  <Td>{money(l.unitPrice)}</Td>
                  <Td>{money(l.amount)}</Td>
                  <Td className="whitespace-nowrap">
                    {!l.voided && editable && can('billing.prices') && <Button size="sm" variant="ghost" onClick={() => { setModal({ kind: 'reprice', lineId: l._id }); setAmount(l.unitPrice); }}>Reprice</Button>}
                    {!l.voided && editable && can('billing.waive') && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'void', lineId: l._id })}>Void</Button>}
                  </Td>
                </tr>
              ))}
            </Table>
            {inv.adjustments.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">{inv.adjustments.map((a, i) => <li key={i} className="flex justify-between"><span className="capitalize">{a.type}: {a.reason} <span className="muted">({a.approvedByName})</span></span><span>− {money(a.amount)}</span></li>)}</ul>
            )}
          </Card>
          <Card title="Payments & credits">
            <Table head={['Receipt', 'Method', 'Reference', 'Amount', 'Status', 'By', 'Date', '']} empty={(inv.payments ?? []).length === 0}>
              {inv.payments?.map((p) => (
                <tr key={p._id}>
                  <Td className="font-mono text-xs">{p.receiptNumber ?? '—'}</Td>
                  <Td className="uppercase">{p.method}</Td>
                  <Td className="font-mono text-xs">{p.reference ?? p.mpesa?.receiptNumber ?? '—'}</Td>
                  <Td>{money(p.amount)}{p.refundedAmount ? <span className="block text-xs text-red-600">refunded {money(p.refundedAmount)}</span> : null}</Td>
                  <Td><Badge tone={statusTone(p.status)}>{p.status}</Badge></Td>
                  <Td>{p.receivedByName}</Td>
                  <Td>{fmtDateTime(p.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    {p.receiptNumber && <Link href={`/print/receipt/${p._id}`} target="_blank" className="text-xs text-brand-600">Receipt</Link>}
                    {can('billing.refund') && ['completed', 'partially_refunded'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => { setModal({ kind: 'refund', payment: p }); setAmount(p.amount - (p.refundedAmount ?? 0)); }}>Refund</Button>}
                  </Td>
                </tr>
              ))}
            </Table>
            {(inv.creditNotes ?? []).length > 0 && <ul className="mt-3 text-sm">{inv.creditNotes!.map((c) => <li key={c._id} className="py-1">{c.creditNoteNumber} · {c.type}{c.method ? ` (${c.method})` : ''} · {money(c.amount)} · {c.reason} <span className="muted">({c.approvedByName})</span><MpesaPayout cn={c} defaultPhone={inv.patient?.phone} canPay={can('billing.refund')} /></li>)}</ul>}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Totals">
            <dl className="space-y-1.5 text-sm">
              {([['Gross', inv.totals.gross], ['Discount', -inv.totals.discount], ['Waiver', -inv.totals.waiver], ['Net', inv.totals.net], ['Paid', -inv.totals.paid], ['Credited', -inv.totals.credited]] as Array<[string, number]>).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="muted">{k}</dt><dd>{money(v)}</dd></div>)}
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-lg font-bold"><dt>Balance</dt><dd>{money(inv.totals.balance)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {can('billing.waive') && inv.totals.balance > 0 && <Button size="sm" variant="outline" onClick={() => setModal({ kind: 'adjust' })}>Discount / waiver</Button>}
              {can('billing.refund') && inv.totals.balance > 0 && <Button size="sm" variant="outline" onClick={() => setModal({ kind: 'credit' })}>Credit note</Button>}
            </div>
          </Card>
          {can('billing.create') && inv.totals.balance > 0 && inv.status !== 'void' && (
            <Card title="Receive payment"><PaymentForm key={inv.totals.balance} inv={inv} onDone={() => undefined} /></Card>
          )}
        </div>
      </div>
      <Modal open={!!modal} onClose={close} title={modal ? { void: 'Void charge', reprice: 'Reprice charge', adjust: 'Discount or waiver', refund: 'Refund payment', credit: 'Credit note' }[modal.kind] : ''}>
        <div className="space-y-3">
          {modal?.kind === 'adjust' && <Field label="Type"><Select value={adjType} onChange={(e) => setAdjType(e.target.value)}><option value="discount">Discount</option><option value="waiver">Waiver</option></Select></Field>}
          {modal && modal.kind !== 'void' && <Field label={modal.kind === 'reprice' ? 'Unit price (KES)' : 'Amount (KES)'}><Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>}
          {modal?.kind === 'refund' && <Field label="Refund method"><Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>{['cash', 'mpesa', 'bank', 'card'].map((m) => <option key={m}>{m}</option>)}</Select></Field>}
          <Field label="Reason (required, audited)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorText error={act.error} />
          <Button onClick={() => act.mutate()} loading={act.isPending} disabled={reason.length < 5}>Confirm</Button>
        </div>
      </Modal>
    </>
  );
}
