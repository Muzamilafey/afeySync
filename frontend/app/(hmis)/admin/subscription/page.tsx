'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSignature, Lock, Smartphone, Sparkles } from 'lucide-react';
import { api, downloadFile } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { cn, fmtDate } from '@/lib/utils';
import { PdfPreview, STATUS_TONE, TYPE_LABEL, money, type BillingDocument } from '@/features/billing-docs/shared';

interface PublicPlan { key: string; name: string; description?: string; prices: { monthly: number; quarterly: number; annual: number }; setupFee: number; maxBranches: number; maxUsers: number; modules: string[]; features: string[]; highlight?: boolean }
interface Overview {
  subscription: { plan: string; planName: string; status: string; billingCycle: string; amount: number; currency: string; startsAt?: string; endsAt?: string; maxBranches: number; maxUsers: number } | null;
  usage: { branches: number; users: number };
  modules: { core: string[]; included: string[]; unrestricted: boolean; all: Array<{ key: string; label: string; description: string }> };
  outstanding: number;
  mpesaAvailable: boolean;
  plans: PublicPlan[];
}
type Cycle = 'monthly' | 'quarterly' | 'annual';
const STATUS_COPY: Record<string, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' }> = { trialing: { label: 'Free trial', tone: 'blue' }, active: { label: 'Active', tone: 'green' }, past_due: { label: 'Payment overdue', tone: 'amber' }, cancelled: { label: 'Cancelled', tone: 'red' } };

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="muted">{label}</span><span className="font-medium">{used} / {max}</span></div>
      <div className="mt-1.5 h-2 rounded-full bg-[var(--surface-2)]"><div className={cn('h-2 rounded-full', pct >= 90 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** M-Pesa payment with live status: waits for Safaricom's confirmation. */
function PayDialog({ doc, onDone }: { doc: BillingDocument; onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const start = useMutation({ mutationFn: async () => (await api<{ paymentId: string; customerMessage: string }>(`/subscription/documents/${doc._id}/pay`, { method: 'POST', body: { phone } })).data, onSuccess: (r) => setPaymentId(r.paymentId) });
  const status = useQuery({
    queryKey: ['sub-payment', paymentId],
    queryFn: async () => (await api<{ status: 'pending' | 'completed' | 'failed'; amount: number; reference?: string; resultDesc?: string }>(`/subscription/payments/${paymentId}`)).data,
    enabled: !!paymentId,
    refetchInterval: (q) => (q.state.data?.status === 'pending' || !q.state.data ? 4000 : false),
  });
  useEffect(() => { if (status.data?.status === 'completed') onDone(); }, [status.data?.status, onDone]);
  const s = status.data?.status;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--surface-2)] p-4 text-center"><p className="muted text-sm">Amount due</p><p className="text-2xl font-semibold">{money(doc.balance, doc.currency)}</p><p className="muted text-xs">{doc.number}</p></div>
      {!paymentId ? (
        <>
          <Field label="M-Pesa phone number" hint="You will receive a prompt to enter your M-Pesa PIN"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" autoFocus /></Field>
          <ErrorText error={start.error} />
          <Button className="w-full" onClick={() => start.mutate()} loading={start.isPending} disabled={phone.replace(/\D/g, '').length < 9}><Smartphone className="h-4 w-4" /> Send payment prompt</Button>
        </>
      ) : s === 'completed' ? (
        <Alert tone="green" title="Payment received">M-Pesa receipt {status.data?.reference}. Thank you — your subscription has been updated.</Alert>
      ) : s === 'failed' ? (
        <>
          <Alert tone="red" title="Payment not completed">{status.data?.resultDesc ?? 'The request was cancelled or timed out.'}</Alert>
          <Button variant="outline" onClick={() => { setPaymentId(null); start.reset(); }}>Try again</Button>
        </>
      ) : (
        <Alert tone="blue" title="Check your phone">Enter your M-Pesa PIN on {phone} to complete the payment. This page updates automatically once Safaricom confirms it.</Alert>
      )}
    </div>
  );
}

function AcceptDialog({ doc, onDone }: { doc: BillingDocument; onDone: (invoiceId: string | null) => void }) {
  const [f, setF] = useState({ name: '', title: '', confirm: false });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const accept = useMutation({ mutationFn: async () => (await api<{ invoiceId: string | null }>(`/subscription/documents/${doc._id}/accept`, { method: 'POST', body: f })).data, onSuccess: (r) => onDone(r.invoiceId) });
  const decline = useMutation({ mutationFn: () => api(`/subscription/documents/${doc._id}/decline`, { method: 'POST', body: { reason } }), onSuccess: () => onDone(null) });
  if (declining) return (
    <div className="space-y-3">
      <Field label="Reason for declining"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorText error={decline.error} />
      <div className="flex gap-2"><Button variant="danger" onClick={() => decline.mutate()} loading={decline.isPending} disabled={reason.trim().length < 3}>Decline</Button><Button variant="ghost" onClick={() => setDeclining(false)}>Back</Button></div>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm">Accepting records your name, title, email, time and IP address as your electronic acceptance{doc.type === 'quotation' ? ' and issues an invoice you can pay immediately' : ''}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Your title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Hospital Administrator" /></Field>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} /> I am authorised to accept this {doc.type === 'contract' ? 'agreement' : 'quotation'} on behalf of the facility.</label>
      <ErrorText error={accept.error} />
      <div className="flex gap-2"><Button onClick={() => accept.mutate()} loading={accept.isPending} disabled={!f.confirm || f.name.trim().length < 3 || f.title.trim().length < 2}><FileSignature className="h-4 w-4" /> Accept</Button><Button variant="ghost" onClick={() => setDeclining(true)}>Decline…</Button></div>
    </div>
  );
}

export default function SubscriptionPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [open, setOpen] = useState<{ doc: BillingDocument; mode: 'view' | 'pay' | 'accept' } | null>(null);
  const ov = useQuery({ queryKey: ['subscription'], queryFn: async () => (await api<Overview>('/subscription')).data });
  const docs = useQuery({ queryKey: ['subscription-docs'], queryFn: async () => (await api<BillingDocument[]>('/subscription/documents')).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['subscription'] }); qc.invalidateQueries({ queryKey: ['subscription-docs'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
  const quote = useMutation({ mutationFn: async (planKey: string) => (await api<BillingDocument>('/subscription/quote', { method: 'POST', body: { planKey, billingCycle: cycle, periods: 1 } })).data, onSuccess: (d) => { refresh(); setOpen({ doc: d, mode: 'view' }); } });
  const manage = can('subscription.manage');
  if (ov.isLoading) return <Loading />;
  if (!ov.data) return <ErrorText error={ov.error} />;
  const o = ov.data;
  const sub = o.subscription;
  const st = STATUS_COPY[sub?.status ?? 'active'] ?? STATUS_COPY.active;
  const daysLeft = sub?.endsAt ? Math.ceil((new Date(sub.endsAt).getTime() - Date.now()) / 86_400_000) : null;
  const included = new Set(o.modules.included);
  const openDocs = (docs.data ?? []).filter((d) => (d.type === 'invoice' && ['issued', 'partially_paid'].includes(d.status) && d.balance > 0) || (d.type !== 'invoice' && d.status === 'issued'));
  return (
    <>
      <PageHeader title="Subscription & billing" crumbs={['Administration', 'Subscription']} subtitle="Your AfeySync plan, modules, invoices and agreements" />
      {o.outstanding > 0 && <div className="mb-4"><Alert tone="amber" title={`${money(o.outstanding)} outstanding`}>Pay open invoices below{o.mpesaAvailable ? ' with M-Pesa' : ''} to keep your subscription active.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#083f36] to-[#0b1220] p-6 text-white shadow-lg">
          <div className="flex items-start justify-between">
            <div><p className="text-xs tracking-widest text-emerald-200/80 uppercase">Current plan</p><p className="mt-1 text-3xl font-semibold">{sub?.planName ?? '—'}</p></div>
            <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', st.tone === 'green' ? 'bg-emerald-400/20 text-emerald-200' : st.tone === 'blue' ? 'bg-sky-400/20 text-sky-100' : st.tone === 'amber' ? 'bg-amber-400/20 text-amber-100' : 'bg-red-400/20 text-red-100')}>{st.label}</span>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-white/60">{sub?.status === 'trialing' ? 'Trial ends' : 'Paid until'}</p><p className="font-medium">{sub?.endsAt ? fmtDate(sub.endsAt) : 'Open-ended'}</p>{daysLeft !== null && <p className={cn('text-xs', daysLeft <= 7 ? 'text-amber-200' : 'text-white/60')}>{daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}</p>}</div>
            <div><p className="text-white/60">Billing</p><p className="font-medium">{sub && sub.amount > 0 ? `${money(sub.amount, sub.currency)} / ${sub.billingCycle.replace('annual', 'year').replace('ly', '')}` : '—'}</p></div>
          </div>
        </div>
        <Card title="Usage">
          <div className="space-y-4">
            <Meter label="Branches" used={o.usage.branches} max={sub?.maxBranches ?? 1} />
            <Meter label="Active users" used={o.usage.users} max={sub?.maxUsers ?? 1} />
          </div>
          <p className="muted mt-4 text-xs">Need more? Upgrade below or ask AfeySync for a custom quotation.</p>
        </Card>
      </div>

      <Card title="Modules" className="mt-5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {o.modules.all.map((m) => {
            const on = o.modules.unrestricted || included.has(m.key);
            return (
              <div key={m.key} className={cn('flex items-start gap-3 rounded-lg border p-3', on ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-70')}>
                {on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                <div><p className="text-sm font-medium">{m.label}</p><p className="muted text-xs">{on ? m.description : 'Not in your plan'}</p></div>
              </div>
            );
          })}
        </div>
        <p className="muted mt-3 text-xs">Always included: registration, front desk, OPD, billing, documents and administration.</p>
      </Card>

      {openDocs.length > 0 && (
        <Card title="Needs your attention" className="mt-5">
          <div className="space-y-2">
            {openDocs.map((d) => (
              <div key={d._id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3">
                <Badge tone={STATUS_TONE[d.status]}>{TYPE_LABEL[d.type]}</Badge>
                <span className="font-medium">{d.number}</span>
                <span className="muted text-sm">{d.type === 'invoice' ? `${money(d.balance, d.currency)} due ${fmtDate(d.dueDate)}` : d.type === 'quotation' ? `${money(d.total, d.currency)} · valid until ${fmtDate(d.validUntil)}` : 'Service agreement awaiting acceptance'}</span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ doc: d, mode: 'view' })}>View</Button>
                  {manage && d.type === 'invoice' && o.mpesaAvailable && <Button size="sm" onClick={() => setOpen({ doc: d, mode: 'pay' })}><Smartphone className="h-4 w-4" /> Pay with M-Pesa</Button>}
                  {manage && d.type !== 'invoice' && <Button size="sm" onClick={() => setOpen({ doc: d, mode: 'accept' })}>Review & accept</Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {o.plans.length > 0 && (
        <Card title="Plans" className="mt-5" actions={<div className="flex rounded-lg bg-[var(--surface-2)] p-1 text-sm">{(['monthly', 'quarterly', 'annual'] as Cycle[]).map((c) => <button key={c} onClick={() => setCycle(c)} className={cn('rounded-md px-3 py-1 capitalize', cycle === c ? 'bg-[var(--surface)] font-medium shadow-sm' : 'muted')}>{c}</button>)}</div>}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {o.plans.map((p) => {
              const current = p.key === sub?.plan;
              const price = p.prices[cycle];
              return (
                <div key={p.key} className={cn('relative flex flex-col rounded-2xl border p-5', current ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-[var(--border)]', p.highlight && !current && 'shadow-md')}>
                  {p.highlight && <span className="absolute -top-2.5 right-4 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-semibold text-white"><Sparkles className="mr-1 inline h-3 w-3" />Popular</span>}
                  <p className="text-lg font-semibold">{p.name}</p>
                  <p className="muted text-xs">{p.description}</p>
                  <p className="mt-3 text-2xl font-semibold">{price > 0 ? money(price) : 'On request'}{price > 0 && <span className="muted text-sm font-normal"> / {cycle.replace('ly', '').replace('annual', 'year')}</span>}</p>
                  <ul className="mt-3 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{f}</li>)}</ul>
                  <div className="mt-4">
                    {current ? <Badge tone="green">Your plan</Badge> : manage && price > 0 ? <Button size="sm" className="w-full" variant={p.highlight ? 'primary' : 'outline'} onClick={() => quote.mutate(p.key)} loading={quote.isPending && quote.variables === p.key}>Get quotation</Button> : <p className="muted text-xs">Contact AfeySync for pricing.</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <ErrorText error={quote.error} />
          <p className="muted mt-3 text-xs">A quotation is issued and signed instantly. Accept it to receive an invoice; paying the invoice activates the plan.</p>
        </Card>
      )}

      <Card title="Documents" className="mt-5">
        {docs.isLoading ? <Loading /> : (
          <Table head={['Document', 'Date', 'Amount', 'Status', '']} empty={!docs.data?.length}>
            {docs.data?.map((d) => (
              <tr key={d._id}>
                <Td><span className="font-medium">{TYPE_LABEL[d.type]} {d.number}</span></Td>
                <Td className="text-xs">{fmtDate(d.issueDate)}</Td>
                <Td>{d.type === 'contract' ? `${money(d.contract?.amount, d.currency)} / ${d.contract?.billingCycle}` : money(d.total, d.currency)}{d.type === 'invoice' && d.balance > 0 && d.status !== 'void' && <div className="muted text-xs">Balance {money(d.balance, d.currency)}</div>}</Td>
                <Td><Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge></Td>
                <Td><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setOpen({ doc: d, mode: 'view' })}>View</Button><Button size="sm" variant="ghost" aria-label={`Download ${d.number}`} onClick={() => downloadFile(`/subscription/documents/${d._id}/pdf`, `${d.number}.pdf`, { query: { download: '1' } })}><Download className="h-4 w-4" /></Button></div></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${TYPE_LABEL[open.doc.type]} ${open.doc.number}` : ''} wide>
        {open?.mode === 'pay' && <PayDialog doc={open.doc} onDone={refresh} />}
        {open?.mode === 'accept' && <AcceptDialog doc={open.doc} onDone={(invoiceId) => { refresh(); setOpen(null); if (invoiceId) setTimeout(() => api<BillingDocument>(`/subscription/documents/${invoiceId}`).then((r) => setOpen({ doc: r.data, mode: 'view' })), 50); }} />}
        {open?.mode === 'view' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {manage && open.doc.type === 'invoice' && ['issued', 'partially_paid'].includes(open.doc.status) && open.doc.balance > 0 && o.mpesaAvailable && <Button size="sm" onClick={() => setOpen({ doc: open.doc, mode: 'pay' })}><Smartphone className="h-4 w-4" /> Pay with M-Pesa</Button>}
              {manage && open.doc.type !== 'invoice' && open.doc.status === 'issued' && <Button size="sm" onClick={() => setOpen({ doc: open.doc, mode: 'accept' })}>Review & accept</Button>}
              <Button size="sm" variant="outline" onClick={() => downloadFile(`/subscription/documents/${open.doc._id}/pdf`, `${open.doc.number}.pdf`, { query: { download: '1' } })}><Download className="h-4 w-4" /> Download PDF</Button>
            </div>
            <PdfPreview path={`/subscription/documents/${open.doc._id}/pdf`} realm="tenant" version={open.doc.status} height={640} />
          </div>
        )}
      </Modal>
    </>
  );
}
