'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Plus, Star } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import { money } from '@/features/billing-docs/shared';

interface Plan { _id?: string; key: string; name: string; description?: string; currency?: string; prices: { monthly: number; quarterly: number; annual: number }; setupFee: number; maxBranches: number; maxUsers: number; trialDays: number; modules: string[]; features: string[]; public: boolean; active: boolean; highlight: boolean; sortOrder: number; facilities?: number }
interface Catalog { core: string[]; optional: Array<{ key: string; label: string; description: string }> }
const CORE_LABEL: Record<string, string> = { patients: 'Patients', frontdesk: 'Front desk & appointments', opd: 'OPD & consultation', billing: 'Billing & cashier', documents: 'Documents', administration: 'Users, roles & branches' };
const EMPTY: Plan = { key: '', name: '', description: '', prices: { monthly: 0, quarterly: 0, annual: 0 }, setupFee: 0, maxBranches: 1, maxUsers: 10, trialDays: 0, modules: [], features: [], public: true, active: true, highlight: false, sortOrder: 10 };

function PlanEditor({ initial, catalog, onClose }: { initial: Plan; catalog: Catalog; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !initial._id;
  const [p, setP] = useState<Plan>(initial);
  const [features, setFeatures] = useState(initial.features.join('\n'));
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: p.name, description: p.description || undefined, prices: p.prices, setupFee: p.setupFee, maxBranches: p.maxBranches, maxUsers: p.maxUsers, trialDays: p.trialDays, modules: p.modules, features: features.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 8), public: p.public, active: p.active, highlight: p.highlight, sortOrder: p.sortOrder };
      return isNew ? ownerApi('/plans', { method: 'POST', body: { key: p.key, ...body } }) : ownerApi(`/plans/${p.key}`, { method: 'PATCH', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-plans'] }); onClose(); },
  });
  const toggle = (k: string) => setP({ ...p, modules: p.modules.includes(k) ? p.modules.filter((m) => m !== k) : [...p.modules, k] });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Plan key" hint="Used in the system; cannot change later"><Input value={p.key} disabled={!isNew} onChange={(e) => setP({ ...p, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="e.g. clinic-plus" /></Field>
        <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Display order"><Input type="number" value={p.sortOrder} onChange={(e) => setP({ ...p, sortOrder: num(e.target.value) })} /></Field>
        <Field label="Short description" className="sm:col-span-3"><Input value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
      </div>
      <div>
        <p className="label mb-2">Pricing (KES, excluding VAT) — 0 means “price on request”</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Per month"><Input type="number" min={0} value={p.prices.monthly} onChange={(e) => setP({ ...p, prices: { ...p.prices, monthly: num(e.target.value) } })} /></Field>
          <Field label="Per quarter"><Input type="number" min={0} value={p.prices.quarterly} onChange={(e) => setP({ ...p, prices: { ...p.prices, quarterly: num(e.target.value) } })} /></Field>
          <Field label="Per year"><Input type="number" min={0} value={p.prices.annual} onChange={(e) => setP({ ...p, prices: { ...p.prices, annual: num(e.target.value) } })} /></Field>
          <Field label="One-off setup fee"><Input type="number" min={0} value={p.setupFee} onChange={(e) => setP({ ...p, setupFee: num(e.target.value) })} /></Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Branches included"><Input type="number" min={1} value={p.maxBranches} onChange={(e) => setP({ ...p, maxBranches: num(e.target.value) })} /></Field>
        <Field label="Users included"><Input type="number" min={1} value={p.maxUsers} onChange={(e) => setP({ ...p, maxUsers: num(e.target.value) })} /></Field>
        <Field label="Free trial days" hint="For new registrations"><Input type="number" min={0} value={p.trialDays} onChange={(e) => setP({ ...p, trialDays: num(e.target.value) })} /></Field>
      </div>
      <div>
        <p className="label mb-2">Modules in this plan</p>
        <div className="mb-2 flex flex-wrap gap-2">{catalog.core.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs"><Lock className="h-3 w-3" />{CORE_LABEL[c] ?? c}</span>)}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.optional.map((m) => {
            const on = p.modules.includes(m.key);
            return (
              <button type="button" key={m.key} onClick={() => toggle(m.key)} aria-pressed={on} className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition', on ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-900/20' : 'border-[var(--border)]')}>
                <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300')}>{on && <Check className="h-3 w-3" />}</span>
                <span><span className="block text-sm font-medium">{m.label}</span><span className="muted block text-xs">{m.description}</span></span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setP({ ...p, modules: catalog.optional.map((m) => m.key) })}>Select all</Button><Button size="sm" variant="ghost" onClick={() => setP({ ...p, modules: [] })}>Core only</Button></div>
      </div>
      <Field label="Highlights shown on the registration page (one per line, up to 8)"><Textarea rows={3} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Active</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.public} onChange={(e) => setP({ ...p, public: e.target.checked })} /> Offer on the registration page</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.highlight} onChange={(e) => setP({ ...p, highlight: e.target.checked })} /> Mark as “Most popular”</label>
      </div>
      {!isNew && (initial.facilities ?? 0) > 0 && <Alert tone="amber">{initial.facilities} facilit{initial.facilities === 1 ? 'y is' : 'ies are'} on this plan. Module changes apply to them immediately; price changes apply from their next invoice.</Alert>}
      <ErrorText error={save.error} />
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!p.key || p.name.length < 2}>{isNew ? 'Create plan' : 'Save changes'}</Button>
    </div>
  );
}

export default function PlansPage() {
  const plans = useQuery({ queryKey: ['owner-plans'], queryFn: async () => (await ownerApi<Plan[]>('/plans')).data });
  const catalog = useQuery({ queryKey: ['owner-modules'], queryFn: async () => (await ownerApi<Catalog>('/plans/modules')).data });
  const [editing, setEditing] = useState<Plan | null>(null);
  if (plans.isLoading || catalog.isLoading) return <Loading />;
  if (!plans.data || !catalog.data) return <ErrorText error={plans.error ?? catalog.error} />;
  const label = (k: string) => catalog.data!.optional.find((m) => m.key === k)?.label ?? k;
  return (
    <>
      <PageHeader title="Plans & modules" crumbs={['Owner', 'Plans']} subtitle="Set prices, limits and the modules each plan switches on. Facilities only reach the modules in their plan." actions={<Button onClick={() => setEditing(EMPTY)}><Plus className="h-4 w-4" /> New plan</Button>} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.data.map((p) => (
          <Card key={p.key} className={cn(p.highlight && 'ring-2 ring-brand-500', !p.active && 'opacity-60')}>
            <div className="flex items-start justify-between">
              <div><p className="text-lg font-semibold">{p.name}</p><p className="muted text-xs">{p.description}</p></div>
              <div className="flex flex-col items-end gap-1">{p.highlight && <Badge tone="green"><Star className="mr-1 inline h-3 w-3" />Popular</Badge>}{!p.active && <Badge tone="gray">inactive</Badge>}{p.active && !p.public && <Badge tone="amber">private</Badge>}</div>
            </div>
            <p className="mt-4 text-2xl font-semibold">{p.prices.monthly > 0 ? money(p.prices.monthly) : 'On request'}{p.prices.monthly > 0 && <span className="muted text-sm font-normal"> / month</span>}</p>
            <p className="muted text-xs">{p.prices.annual > 0 ? `${money(p.prices.annual)} / year` : ''}{p.setupFee > 0 ? ` · setup ${money(p.setupFee)}` : ''}{p.trialDays > 0 ? ` · ${p.trialDays}-day trial` : ''}</p>
            <p className="mt-3 text-sm">{p.maxBranches} branch{p.maxBranches > 1 ? 'es' : ''} · {p.maxUsers} users</p>
            <div className="mt-3 flex flex-wrap gap-1">{p.modules.length === catalog.data!.optional.length ? <Badge tone="blue">All modules</Badge> : p.modules.length === 0 ? <Badge tone="gray">Core only</Badge> : p.modules.map((m) => <Badge key={m} tone="gray">{label(m)}</Badge>)}</div>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-sm"><span className="muted">{p.facilities ?? 0} facilit{p.facilities === 1 ? 'y' : 'ies'}</span><Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button></div>
          </Card>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?._id ? `Edit ${editing.name}` : 'New plan'} wide>
        {editing && <PlanEditor initial={editing} catalog={catalog.data} onClose={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
