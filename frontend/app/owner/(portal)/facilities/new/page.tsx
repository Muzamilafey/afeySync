'use client';

import { useState } from 'react';
import { useOwnerPlans } from '@/features/billing-docs/useOwnerPlans';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, KV, PageHeader, Select } from '@/components/ui';
import { cn } from '@/lib/utils';

const STEPS = ['Facility Information', 'Administrator', 'Database', 'Domain', 'Branches', 'Integrations', 'Subscription', 'Finish'];
const PLATFORM_DOMAIN = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'afeysync.com';

interface BranchIn { branchName: string; branchCode: string; county: string; facilityLevel: string; facilityCode: string; bedCapacity: number }
interface Result { id: string; slug: string; dbName: string; domains: string[]; branches: Array<{ branchName: string }>; admin: { email: string; temporaryPassword?: string }; checklist: string[] }

export default function NewFacilityWizard() {
  const [step, setStep] = useState(0);
  const [facility, setFacility] = useState({ name: '', slug: '', legalName: '', facilityCode: '', registrationNumber: '', facilityLevel: '', facilityType: '', ownership: '', county: '', subCounty: '', phone: '', email: '', physicalAddress: '', dhaFacilityRegistryCode: '' });
  const [admin, setAdmin] = useState({ name: '', email: '', phone: '' });
  const [customDomains, setCustomDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [branches, setBranches] = useState<BranchIn[]>([{ branchName: 'Main Branch', branchCode: 'MAIN', county: '', facilityLevel: '', facilityCode: '', bedCapacity: 0 }]);
  const [integrations, setIntegrations] = useState({ sha: true, dha: true, mpesa: false, africastalking: false, smtp: false, slade360: false });
  const plans = useOwnerPlans();
  const [subscription, setSubscription] = useState({ plan: 'trial', billingCycle: 'monthly', amount: 0, maxBranches: 3, maxUsers: 25 });

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const create = useMutation({
    mutationFn: async () =>
      (
        await ownerApi<Result>('/tenants', {
          method: 'POST',
          body: {
            facility: Object.fromEntries(Object.entries(facility).filter(([, v]) => v !== '')),
            administrator: { name: admin.name, email: admin.email, phone: admin.phone || undefined },
            domain: { customDomains },
            branches: branches.map((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '' && v !== null))),
            integrations,
            subscription: { ...subscription, amount: Number(subscription.amount), maxBranches: Number(subscription.maxBranches), maxUsers: Number(subscription.maxUsers) },
          },
        })
      ).data,
    onSuccess: () => setStep(7),
  });

  const canNext = [
    facility.name.length >= 2 && /^[a-z0-9][a-z0-9-]{1,40}$/.test(facility.slug),
    admin.name.length >= 2 && /.+@.+\..+/.test(admin.email),
    true,
    true,
    branches.length > 0 && branches.every((b) => b.branchName && /^[A-Za-z0-9-]{2,20}$/.test(b.branchCode)),
    true,
    true,
  ][step];

  const F = (k: keyof typeof facility, label: string, ph?: string) => (
    <Field label={label}><Input value={facility[k]} placeholder={ph} onChange={(e) => setFacility({ ...facility, [k]: e.target.value, ...(k === 'name' && !facility.slug ? {} : {}) })} /></Field>
  );

  return (
    <>
      <PageHeader title="Create facility" crumbs={['Owner', 'Facilities', 'New']} />
      <ol className="mb-6 grid grid-cols-4 gap-2 md:grid-cols-8">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('rounded-md border px-2 py-2 text-center text-xs font-medium', i === step ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200' : i < step ? 'border-emerald-300 text-emerald-700' : 'muted border-[var(--border)]')}>
            <span className="block text-[10px] uppercase">Step {i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <Card title={STEPS[step]}>
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Facility name *"><Input value={facility.name} onChange={(e) => setFacility({ ...facility, name: e.target.value, slug: facility.slug && facility.slug !== slugify(facility.name) ? facility.slug : slugify(e.target.value) })} /></Field>
            <Field label="Slug (subdomain) *" hint={`${facility.slug || 'slug'}.${PLATFORM_DOMAIN}`}><Input value={facility.slug} onChange={(e) => setFacility({ ...facility, slug: slugify(e.target.value) })} /></Field>
            {F('legalName', 'Legal name')}
            {F('facilityCode', 'Facility (KMHFL) code')}
            {F('dhaFacilityRegistryCode', 'DHA Facility Registry code', 'FID-XX-XXXXXX-X')}
            {F('registrationNumber', 'Registration number')}
            {F('facilityLevel', 'Level', 'Level 3A')}
            {F('facilityType', 'Facility type', 'Hospital / Maternity / Clinic')}
            {F('ownership', 'Ownership', 'Private / FBO / Public')}
            {F('county', 'County')}
            {F('subCounty', 'Sub-county')}
            {F('phone', 'Phone')}
            {F('email', 'Email')}
            {F('physicalAddress', 'Physical address')}
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Administrator name *"><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} /></Field>
            <Field label="Email *"><Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} /></Field>
            <div className="col-span-full"><Alert tone="blue">A temporary password will be generated and shown once. The administrator must change it at first login.</Alert></div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <KV items={[['Database name', <code key="d">afeysync_tenant_{facility.slug.replace(/-/g, '_') || '<slug>'}</code>], ['Isolation', 'Dedicated MongoDB database — clinical data is never mixed between facilities'], ['Seeded', 'Indexes, default roles, permissions and settings']]} />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <KV items={[['Platform subdomain', `${facility.slug}.${PLATFORM_DOMAIN}`]]} />
            <div className="flex gap-2">
              <Input className="max-w-sm" placeholder="www.hospital.co.ke" value={domainInput} onChange={(e) => setDomainInput(e.target.value.toLowerCase().trim())} />
              <Button variant="outline" onClick={() => { if (domainInput && !customDomains.includes(domainInput)) setCustomDomains([...customDomains, domainInput]); setDomainInput(''); }}>Add custom domain</Button>
            </div>
            <ul className="text-sm">{customDomains.map((d) => <li key={d} className="flex items-center gap-2">{d} <button className="text-red-600" onClick={() => setCustomDomains(customDomains.filter((x) => x !== d))}>remove</button></li>)}</ul>
            <p className="muted text-xs">Custom domains must be verified with a DNS TXT record before they resolve.</p>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-3">
            {branches.map((b, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-3 lg:grid-cols-7">
                <Field label={i === 0 ? 'Main branch name' : 'Branch name'} className="lg:col-span-2"><Input value={b.branchName} onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, branchName: e.target.value } : x)))} /></Field>
                <Field label="Code"><Input value={b.branchCode} onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, branchCode: e.target.value.toUpperCase() } : x)))} /></Field>
                <Field label="County"><Input value={b.county} onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, county: e.target.value } : x)))} /></Field>
                <Field label="Level"><Input value={b.facilityLevel} onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, facilityLevel: e.target.value } : x)))} /></Field>
                <Field label="Beds"><Input type="number" min={0} value={b.bedCapacity} onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, bedCapacity: Number(e.target.value) } : x)))} /></Field>
                <div className="flex items-end">{i > 0 && <Button variant="ghost" onClick={() => setBranches(branches.filter((_, j) => j !== i))} aria-label="Remove branch"><Trash2 className="h-4 w-4" /></Button>}</div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBranches([...branches, { branchName: '', branchCode: '', county: '', facilityLevel: '', facilityCode: '', bedCapacity: 0 }])}><Plus className="h-3 w-3" /> Add branch</Button>
          </div>
        )}
        {step === 5 && (
          <div className="space-y-3">
            {(Object.keys(integrations) as Array<keyof typeof integrations>).map((k) => (
              <label key={k} className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={integrations[k]} onChange={(e) => setIntegrations({ ...integrations, [k]: e.target.checked })} />
                <span className="font-medium">{{ sha: 'SHA', dha: 'DHA HIE', mpesa: 'M-Pesa', africastalking: "Africa's Talking SMS", smtp: 'SMTP email', slade360: 'Slade360 private insurance' }[k]}</span>
              </label>
            ))}
            <p className="muted text-xs">Uses platform credentials configured in Owner → Integrations. Facilities never see platform secrets.</p>
          </div>
        )}
        {step === 6 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plan"><Select value={subscription.plan} onChange={(e) => { const p = plans.data?.find((x) => x.key === e.target.value); setSubscription({ ...subscription, plan: e.target.value, ...(p ? { maxBranches: p.maxBranches, maxUsers: p.maxUsers, amount: p.prices[subscription.billingCycle as 'monthly'] ?? 0 } : {}) }); }}>{(plans.data ?? []).filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
            <Field label="Billing cycle"><Select value={subscription.billingCycle} onChange={(e) => setSubscription({ ...subscription, billingCycle: e.target.value })}>{['monthly', 'quarterly', 'annual'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Amount (KES)"><Input type="number" min={0} value={subscription.amount} onChange={(e) => setSubscription({ ...subscription, amount: Number(e.target.value) })} /></Field>
            <Field label="Max branches"><Input type="number" min={1} value={subscription.maxBranches} onChange={(e) => setSubscription({ ...subscription, maxBranches: Number(e.target.value) })} /></Field>
            <Field label="Max users"><Input type="number" min={1} value={subscription.maxUsers} onChange={(e) => setSubscription({ ...subscription, maxUsers: Number(e.target.value) })} /></Field>
          </div>
        )}
        {step === 7 && create.data && (
          <div className="space-y-4">
            <ul className="space-y-1">{create.data.checklist.map((c) => <li key={c} className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600" /> {c}</li>)}</ul>
            <KV items={[['Database', create.data.dbName], ['Domains', create.data.domains.join(', ')], ['Branches', create.data.branches.map((b) => b.branchName).join(', ')], ['Administrator', create.data.admin.email]]} />
            {create.data.admin.temporaryPassword && (
              <Alert tone="amber" title="Temporary administrator password — shown once">
                <code className="text-base">{create.data.admin.temporaryPassword}</code>
              </Alert>
            )}
            <Link href={`/owner/facilities/${create.data.id}`}><Button>Open facility</Button></Link>
          </div>
        )}
        {step < 7 && (
          <div className="mt-6 space-y-3">
            <ErrorText error={create.error} />
            <div className="flex justify-between">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
              {step < 6 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button> : <Button onClick={() => create.mutate()} loading={create.isPending}>Create facility</Button>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
