'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Download, FileSignature, Mail, Pencil, Receipt, Smartphone, Stamp } from 'lucide-react';
import { downloadFile, ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PdfPreview, STATUS_TONE, TYPE_LABEL, money, type BillingDocument } from '@/features/billing-docs/shared';

type Dialog = null | 'send' | 'pay' | 'stk' | 'void';

export default function OwnerDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ['owner-doc', id], queryFn: async () => (await ownerApi<BillingDocument>(`/billing/documents/${id}`)).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['owner-doc', id] }); qc.invalidateQueries({ queryKey: ['owner-docs'] }); qc.invalidateQueries({ queryKey: ['owner-docs-summary'] }); };
  const issue = useMutation({ mutationFn: () => ownerApi(`/billing/documents/${id}/issue`, { method: 'POST' }), onSuccess: refresh });
  const convert = useMutation({ mutationFn: async () => (await ownerApi<BillingDocument>(`/billing/documents/${id}/convert`, { method: 'POST' })).data, onSuccess: (inv) => { refresh(); router.push(`/owner/billing/${inv._id}`); } });
  const [send, setSend] = useState({ to: '', message: '' });
  const sendM = useMutation({ mutationFn: () => ownerApi<{ sentTo: string }>(`/billing/documents/${id}/send`, { method: 'POST', body: { to: send.to || undefined, message: send.message || undefined } }), onSuccess: () => { setDialog(null); refresh(); } });
  const [pay, setPay] = useState({ method: 'bank', amount: '', reference: '', receivedAt: new Date().toISOString().slice(0, 10), notes: '' });
  const payM = useMutation({ mutationFn: () => ownerApi(`/billing/documents/${id}/payments`, { method: 'POST', body: { ...pay, amount: Number(pay.amount), notes: pay.notes || undefined } }), onSuccess: () => { setDialog(null); refresh(); } });
  const [phone, setPhone] = useState('');
  const stk = useMutation({ mutationFn: async () => (await ownerApi<{ customerMessage: string }>(`/billing/documents/${id}/stk`, { method: 'POST', body: { phone } })).data, onSuccess: refresh });
  const [reason, setReason] = useState('');
  const voidM = useMutation({ mutationFn: () => ownerApi(`/billing/documents/${id}/void`, { method: 'POST', body: { reason } }), onSuccess: () => { setDialog(null); refresh(); } });

  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return <ErrorText error={q.error} />;
  const payable = d.type === 'invoice' && ['issued', 'partially_paid'].includes(d.status);
  const version = `${d.status}-${d.amountPaid}-${d.acceptance?.at ?? ''}`;
  return (
    <>
      <PageHeader
        title={`${TYPE_LABEL[d.type]} ${d.number}`}
        crumbs={['Owner', 'Billing', d.number]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge><span className="text-sm">{d.customer?.name}</span>{d.signing?.signedAt && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Stamp className="h-3.5 w-3.5" />Signed {fmtDate(d.signing.signedAt)}</span>}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {d.status === 'draft' && <Link href={`/owner/billing/new?id=${d._id}`}><Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button></Link>}
            {d.status === 'draft' && <Button onClick={() => issue.mutate()} loading={issue.isPending}><FileSignature className="h-4 w-4" /> Issue & sign</Button>}
            {d.status !== 'draft' && <Button variant="outline" onClick={() => { setSend({ to: d.customer?.email ?? '', message: '' }); sendM.reset(); setDialog('send'); }}><Mail className="h-4 w-4" /> Email</Button>}
            <Button variant="outline" onClick={() => downloadFile(`/owner/billing/documents/${d._id}/pdf`, `${d.number}.pdf`, { realm: 'owner', query: { download: '1' } })}><Download className="h-4 w-4" /> PDF</Button>
            {d.type === 'quotation' && ['issued', 'accepted'].includes(d.status) && !d.convertedInvoiceId && <Button onClick={() => convert.mutate()} loading={convert.isPending}><Receipt className="h-4 w-4" /> Convert to invoice</Button>}
            {!['void', 'paid'].includes(d.status) && !(d.amountPaid > 0) && <Button variant="ghost" onClick={() => { setReason(''); voidM.reset(); setDialog('void'); }}><Ban className="h-4 w-4" /> Void</Button>}
          </div>
        }
      />
      <ErrorText error={issue.error ?? convert.error} />
      {issue.error && (issue.error as { code?: string }).code === 'SIGNATURE_REQUIRED' && <p className="mb-3 text-sm"><Link className="text-brand-600 underline" href="/owner/billing/settings">Upload your signature and stamp →</Link></p>}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {d.status === 'draft' && <Alert tone="blue" title="Draft">This is a preview with a DRAFT watermark. Issuing freezes the content, applies your signature and stamp{d.type === 'invoice' ? ', and sets the due date' : ''}.</Alert>}
          {d.status === 'void' && <Alert tone="red" title="Void">{d.voidReason}</Alert>}
          <PdfPreview path={`/owner/billing/documents/${d._id}/pdf`} realm="owner" version={version} />
        </div>
        <div className="space-y-5">
          {d.type === 'invoice' && (
            <Card title="Balance">
              <KV items={[['Total', money(d.total, d.currency)], ['Paid', money(d.amountPaid, d.currency)], ['Balance', <strong key="b">{money(d.balance, d.currency)}</strong>], ['Due', fmtDate(d.dueDate)]]} />
              {d.subscriptionAppliedAt && <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Subscription extended {fmtDate(d.subscriptionAppliedAt)}</p>}
              {payable && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setPay({ ...pay, amount: String(d.balance) }); payM.reset(); setDialog('pay'); }}>Record payment</Button>
                  <Button size="sm" variant="outline" onClick={() => { setPhone(d.customer?.phone ?? ''); stk.reset(); setDialog('stk'); }}><Smartphone className="h-4 w-4" /> M-Pesa prompt</Button>
                </div>
              )}
            </Card>
          )}
          {d.type === 'contract' && d.contract && (
            <Card title="Agreement">
              <KV items={[['Plan', d.contract.planKey], ['Fee', `${money(d.contract.amount, d.currency)} / ${d.contract.billingCycle}`], ['Start', fmtDate(d.contract.startDate)], ['Term', `${d.contract.termMonths} months`]]} />
            </Card>
          )}
          {(d.type === 'contract' || d.type === 'quotation') && d.status !== 'draft' && (
            <Card title="Customer acceptance">
              {d.acceptance?.at ? (
                <KV items={[['Accepted by', `${d.acceptance.byName}${d.acceptance.byTitle ? `, ${d.acceptance.byTitle}` : ''}`], ['Email', d.acceptance.byEmail], ['When', fmtDateTime(d.acceptance.at)], ['From IP', d.acceptance.ip]]} />
              ) : d.status === 'declined' ? <p className="text-sm text-red-600">Declined by the facility.</p> : <p className="muted text-sm">{d.tenantId ? 'Waiting for the facility to accept it in AfeySync (Administration → Subscription).' : 'Prospect: acceptance is recorded outside AfeySync.'}</p>}
              {d.convertedInvoiceId && <Link className="mt-2 inline-block text-sm text-brand-600" href={`/owner/billing/${d.convertedInvoiceId}`}>Open the invoice →</Link>}
            </Card>
          )}
          {d.signing?.hash && (
            <Card title="Signature">
              <KV items={[['Signed by', `${d.signing.signatoryName ?? '—'}${d.signing.signatoryTitle ? `, ${d.signing.signatoryTitle}` : ''}`], ['Signed', d.signing.signedAt ? fmtDateTime(d.signing.signedAt) : 'Not signed (automatic signing off)'], ['Fingerprint', <span key="h" className="font-mono text-xs break-all">{d.signing.hash.slice(0, 32)}</span>]]} />
              {d.sentAt && <p className="muted mt-2 text-xs">Emailed to {d.sentTo} on {fmtDateTime(d.sentAt)}</p>}
            </Card>
          )}
          {!!d.payments?.length && (
            <Card title="Payments">
              <Table head={['Date', 'Method', 'Amount', 'Status']}>
                {d.payments.map((p) => <tr key={p._id}><Td className="text-xs">{fmtDateTime(p.receivedAt ?? p.createdAt)}</Td><Td className="text-xs capitalize">{p.method.replace('_', ' ')}<div className="font-mono">{p.reference ?? p.mpesa?.receiptNumber}</div></Td><Td>{money(p.amount)}</Td><Td><Badge tone={p.status === 'completed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>{p.status}</Badge></Td></tr>)}
              </Table>
            </Card>
          )}
          <Card title="History">
            <ol className="space-y-2 text-sm">{[...d.history].reverse().map((h, i) => <li key={i} className="border-l-2 border-[var(--border)] pl-3"><span className="font-medium capitalize">{h.action.replace(/_/g, ' ')}</span> <span className="muted text-xs">{fmtDateTime(h.at)}{h.byName ? ` · ${h.byName}` : ''}</span>{h.note && <p className="text-xs">{h.note}</p>}</li>)}</ol>
          </Card>
        </div>
      </div>

      <Modal open={dialog === 'send'} onClose={() => setDialog(null)} title={`Email ${d.number}`}>
        <div className="space-y-3">
          <Field label="To"><Input type="email" value={send.to} onChange={(e) => setSend({ ...send, to: e.target.value })} /></Field>
          <Field label="Message (optional)"><Textarea rows={4} value={send.message} onChange={(e) => setSend({ ...send, message: e.target.value })} placeholder="A standard message is used when blank." /></Field>
          <p className="muted text-xs">The signed PDF is attached.</p>
          <ErrorText error={sendM.error} />
          <Button onClick={() => sendM.mutate()} loading={sendM.isPending} disabled={!send.to}>Send</Button>
        </div>
      </Modal>
      <Modal open={dialog === 'pay'} onClose={() => setDialog(null)} title="Record a payment">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="bank">Bank transfer</option><option value="mpesa_c2b">M-Pesa (paybill, manual)</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></Select></Field>
          <Field label="Amount (KES)"><Input type="number" min={1} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          <Field label={pay.method === 'mpesa_c2b' ? 'M-Pesa receipt number' : 'Reference'}><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          <Field label="Received on"><Input type="date" value={pay.receivedAt} onChange={(e) => setPay({ ...pay, receivedAt: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Input value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} /></Field>
          <div className="sm:col-span-2"><ErrorText error={payM.error} /><Button onClick={() => payM.mutate()} loading={payM.isPending} disabled={!(Number(pay.amount) > 0) || pay.reference.trim().length < 3}>Record payment</Button></div>
        </div>
      </Modal>
      <Modal open={dialog === 'stk'} onClose={() => setDialog(null)} title="Send an M-Pesa payment prompt">
        <div className="space-y-3">
          <p className="text-sm">The customer receives a prompt for {money(d.balance, d.currency)} on their phone. The invoice updates automatically when Safaricom confirms the payment.</p>
          <Field label="Safaricom number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></Field>
          {stk.data ? <Alert tone="green">{stk.data.customerMessage}</Alert> : <ErrorText error={stk.error} />}
          <Button onClick={() => stk.mutate()} loading={stk.isPending} disabled={phone.replace(/\D/g, '').length < 9}>Send prompt</Button>
        </div>
      </Modal>
      <Modal open={dialog === 'void'} onClose={() => setDialog(null)} title={`Void ${d.number}`}>
        <div className="space-y-3">
          <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorText error={voidM.error} />
          <Button variant="danger" onClick={() => voidM.mutate()} loading={voidM.isPending} disabled={reason.trim().length < 5}>Void document</Button>
        </div>
      </Modal>
    </>
  );
}
