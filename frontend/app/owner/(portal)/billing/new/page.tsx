'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Tabs, Textarea } from '@/components/ui';
import { CYCLES, TYPE_LABEL, money, type BillingDocument, type DocType } from '@/features/billing-docs/shared';

interface Plan { key: string; name: string; prices: { monthly: number; quarterly: number; annual: number }; setupFee: number; active: boolean }
interface Tenant { id: string; name: string; slug: string; county?: string }
interface Settings { business: { vatRegistered: boolean; vatRate: number; currency: string; invoiceDueDays: number; quotationValidDays: number }; assets: { signature: unknown } }
interface Line { description: string; quantity: number; unitPrice: number; kind: 'subscription' | 'setup' | 'service' | 'other'; planKey?: string; billingCycle?: string }
const CYCLE_WORD: Record<string, string> = { monthly: 'month', quarterly: 'quarter', annual: 'year' };
const today = () => new Date().toISOString().slice(0, 10);

function Editor() {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get('id');
  const [type, setType] = useState<DocType>((params.get('type') as DocType) || 'invoice');
  const [mode, setMode] = useState<'facility' | 'prospect'>('facility');
  const [tenantId, setTenantId] = useState(params.get('tenantId') ?? '');
  const [customer, setCustomer] = useState({ name: '', contactName: '', email: '', phone: '', address: '', kraPin: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [contract, setContract] = useState({ planKey: '', billingCycle: 'annual', amount: 0, startDate: today(), termMonths: 12, specialTerms: '' });
  const [planPick, setPlanPick] = useState({ planKey: '', billingCycle: 'monthly', periods: 1 });

  const plans = useQuery({ queryKey: ['owner-plans'], queryFn: async () => (await ownerApi<Plan[]>('/plans')).data });
  const tenants = useQuery({ queryKey: ['owner-tenants-all'], queryFn: async () => (await ownerApi<Tenant[]>('/tenants', { query: { limit: 100 } })).data });
  const settings = useQuery({ queryKey: ['owner-billing-settings'], queryFn: async () => (await ownerApi<Settings>('/billing/settings')).data });
  const existing = useQuery({ queryKey: ['owner-doc', editId], queryFn: async () => (await ownerApi<BillingDocument>(`/billing/documents/${editId}`)).data, enabled: !!editId });

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setType(d.type);
    setMode(d.tenantId ? 'facility' : 'prospect');
    setTenantId(d.tenantId ?? '');
    setCustomer({ name: d.customer?.name ?? '', contactName: d.customer?.contactName ?? '', email: d.customer?.email ?? '', phone: d.customer?.phone ?? '', address: d.customer?.address ?? '', kraPin: d.customer?.kraPin ?? '' });
    setLines(d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, kind: l.kind, planKey: l.planKey, billingCycle: l.billingCycle })));
    setNotes(d.notes ?? '');
    setTerms(d.terms ?? '');
    setDueDate(d.dueDate?.slice(0, 10) ?? '');
    if (d.contract) setContract({ planKey: d.contract.planKey, billingCycle: d.contract.billingCycle, amount: d.contract.amount, startDate: d.contract.startDate.slice(0, 10), termMonths: d.contract.termMonths, specialTerms: d.contract.specialTerms ?? '' });
  }, [existing.data]);

  const b = settings.data?.business;
  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
    const vat = b?.vatRegistered ? (subtotal * b.vatRate) / 100 : 0;
    return { subtotal, vat, total: subtotal + vat };
  }, [lines, b]);
  const activePlans = plans.data?.filter((p) => p.active) ?? [];
  const planPrice = (key: string, cycle: string) => plans.data?.find((p) => p.key === key)?.prices?.[cycle as 'monthly'] ?? 0;
  const addPlanLine = () => {
    const p = plans.data?.find((x) => x.key === planPick.planKey);
    if (!p) return;
    const n = planPick.periods;
    const next: Line[] = [...lines, { description: `${p.name} plan subscription — ${n} ${CYCLE_WORD[planPick.billingCycle]}${n > 1 ? 's' : ''}`, quantity: n, unitPrice: p.prices[planPick.billingCycle as 'monthly'], kind: 'subscription', planKey: p.key, billingCycle: planPick.billingCycle }];
    if (p.setupFee > 0 && !lines.some((l) => l.kind === 'setup')) next.push({ description: 'One-off setup and onboarding', quantity: 1, unitPrice: p.setupFee, kind: 'setup' });
    setLines(next);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: async () => {
      const cust = Object.fromEntries(Object.entries(customer).filter(([, v]) => v.trim() !== ''));
      const body: Record<string, unknown> = {
        ...(mode === 'facility' ? { tenantId } : {}),
        // For a facility, any field typed here overrides its registered details (the name defaults to the facility's).
        ...(mode === 'prospect' ? { customer: cust } : Object.keys(cust).length > 0 ? { customer: { name: tenants.data?.find((t) => t.id === tenantId)?.name ?? '', ...cust } } : {}),
        lines: type === 'contract' ? [] : lines.map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
        notes: notes || undefined,
        terms: terms || undefined,
        dueDate: dueDate || undefined,
        contract: type === 'contract' ? { ...contract, amount: Number(contract.amount), termMonths: Number(contract.termMonths), specialTerms: contract.specialTerms || undefined } : undefined,
      };
      const r = editId ? await ownerApi<BillingDocument>(`/billing/documents/${editId}`, { method: 'PATCH', body }) : await ownerApi<BillingDocument>('/billing/documents', { method: 'POST', body: { type, ...body } });
      return r.data;
    },
    onSuccess: (d) => router.push(`/owner/billing/${d._id}`),
  });

  if (plans.isLoading || tenants.isLoading || settings.isLoading || (editId && existing.isLoading)) return <Loading />;
  const canSave = (mode === 'facility' ? !!tenantId : customer.name.trim().length >= 2) && (type === 'contract' ? !!contract.planKey && contract.amount > 0 : lines.length > 0 && lines.every((l) => l.description.trim().length >= 2 && Number(l.quantity) > 0));
  return (
    <>
      <PageHeader title={editId ? `Edit ${existing.data?.number}` : `New ${TYPE_LABEL[type].toLowerCase()}`} crumbs={['Owner', 'Billing', editId ? 'Edit' : 'New']} subtitle="Saved as a draft. Issuing it applies your signature and stamp and locks the content." />
      {!editId && <Tabs<DocType> value={type} onChange={setType} tabs={[{ key: 'invoice', label: 'Invoice' }, { key: 'quotation', label: 'Quotation' }, { key: 'contract', label: 'Service agreement' }]} />}
      {!settings.data?.assets.signature && <div className="mb-4"><Alert tone="amber" title="No signature uploaded">You can save drafts, but upload your signature and stamp in Billing → Settings before issuing.</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card title="Customer">
            <div className="mb-3 flex gap-2">
              <Button size="sm" variant={mode === 'facility' ? 'primary' : 'outline'} onClick={() => setMode('facility')}>Existing facility</Button>
              {type !== 'contract' && <Button size="sm" variant={mode === 'prospect' ? 'primary' : 'outline'} onClick={() => { setMode('prospect'); setTenantId(''); }}>Prospect (not yet on AfeySync)</Button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === 'facility' && <Field label="Facility" className="sm:col-span-2"><Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">Select…</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug}{t.county ? ` · ${t.county}` : ''})</option>)}</Select></Field>}
              <Field label={mode === 'facility' ? 'Bill to name (optional override)' : 'Customer name'}><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
              <Field label="Attention (contact person)"><Input value={customer.contactName} onChange={(e) => setCustomer({ ...customer, contactName: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
              <Field label="Address"><Input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} /></Field>
              <Field label="Customer KRA PIN"><Input value={customer.kraPin} onChange={(e) => setCustomer({ ...customer, kraPin: e.target.value.toUpperCase() })} /></Field>
            </div>
            {mode === 'facility' && <p className="muted mt-2 text-xs">Blank fields use the facility&apos;s registered details.</p>}
          </Card>

          {type === 'contract' ? (
            <Card title="Agreement terms">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Plan"><Select value={contract.planKey} onChange={(e) => setContract({ ...contract, planKey: e.target.value, amount: planPrice(e.target.value, contract.billingCycle) || contract.amount })}><option value="">Select…</option>{activePlans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
                <Field label="Billing cycle"><Select value={contract.billingCycle} onChange={(e) => setContract({ ...contract, billingCycle: e.target.value, amount: planPrice(contract.planKey, e.target.value) || contract.amount })}>{CYCLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
                <Field label={`Fee per ${CYCLE_WORD[contract.billingCycle]} (KES)`}><Input type="number" min={0} value={contract.amount} onChange={(e) => setContract({ ...contract, amount: Number(e.target.value) })} /></Field>
                <Field label="Start date"><Input type="date" value={contract.startDate} onChange={(e) => setContract({ ...contract, startDate: e.target.value })} /></Field>
                <Field label="Term (months)"><Input type="number" min={1} max={120} value={contract.termMonths} onChange={(e) => setContract({ ...contract, termMonths: Number(e.target.value) })} /></Field>
                <Field label="Special terms (optional)" className="sm:col-span-3"><Textarea rows={3} value={contract.specialTerms} onChange={(e) => setContract({ ...contract, specialTerms: e.target.value })} placeholder="e.g. discounts, training days, custom SLAs" /></Field>
              </div>
              <p className="muted mt-2 text-xs">The clauses come from your agreement template (Billing → Settings). Preview them on the next screen before issuing.</p>
            </Card>
          ) : (
            <Card title="Items">
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--surface-2)] p-3">
                <Field label="Add a plan subscription"><Select value={planPick.planKey} onChange={(e) => setPlanPick({ ...planPick, planKey: e.target.value })}><option value="">Plan…</option>{activePlans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
                <Field label="Cycle"><Select value={planPick.billingCycle} onChange={(e) => setPlanPick({ ...planPick, billingCycle: e.target.value })}>{CYCLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
                <Field label="Periods"><Input type="number" min={1} max={12} className="w-20" value={planPick.periods} onChange={(e) => setPlanPick({ ...planPick, periods: Number(e.target.value) || 1 })} /></Field>
                <Button variant="secondary" onClick={addPlanLine} disabled={!planPick.planKey}>Add</Button>
                {planPick.planKey && (planPrice(planPick.planKey, planPick.billingCycle) > 0 ? <span className="muted text-xs">{money(planPrice(planPick.planKey, planPick.billingCycle))} per {CYCLE_WORD[planPick.billingCycle]}</span> : <span className="text-xs text-amber-600">No {planPick.billingCycle} price set for this plan: enter the unit price below</span>)}
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_90px_140px_120px_32px]">
                    <Field label={i === 0 ? 'Description' : ''}><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                    <Field label={i === 0 ? 'Qty' : ''}><Input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></Field>
                    <Field label={i === 0 ? 'Unit price' : ''}><Input type="number" min={0} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></Field>
                    <p className="pb-2 text-right text-sm font-medium">{money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</p>
                    <button type="button" aria-label="Remove line" className="muted mb-2 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                    {l.kind === 'subscription' && <p className="muted -mt-1 text-xs sm:col-span-5">Subscription line: paying this invoice in full extends the facility&apos;s {l.planKey} plan.</p>}
                  </div>
                ))}
              </div>
              <Button className="mt-3" size="sm" variant="ghost" onClick={() => setLines([...lines, { description: '', quantity: 1, unitPrice: 0, kind: 'service' }])}><Plus className="h-4 w-4" /> Add custom line</Button>
            </Card>
          )}

          {type !== 'contract' && (
            <Card title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                {type === 'invoice' && <Field label="Due date" hint={`Defaults to ${b?.invoiceDueDays ?? 14} days after issue`}><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
                <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                {type === 'quotation' && <Field label="Terms (leave blank for your default)" className="sm:col-span-2"><Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Summary">
            {type === 'contract' ? (
              <p className="text-sm">{contract.planKey ? `${plans.data?.find((p) => p.key === contract.planKey)?.name} · ${money(contract.amount)} per ${CYCLE_WORD[contract.billingCycle]} · ${contract.termMonths} months` : 'Choose a plan.'}</p>
            ) : (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
                {b?.vatRegistered && <div className="flex justify-between"><dt className="muted">VAT ({b.vatRate}%)</dt><dd>{money(totals.vat)}</dd></div>}
                <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-semibold"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
              </dl>
            )}
            <p className="muted mt-3 text-xs">Totals are recalculated on the server when saved.</p>
            <ErrorText error={save.error} />
            <Button className="mt-3 w-full" onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>{editId ? 'Save draft' : 'Save as draft'}</Button>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function NewDocumentPage() {
  return <Suspense><Editor /></Suspense>;
}
