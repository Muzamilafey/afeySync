'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { AuthImage } from '@/features/billing-docs/shared';

interface Asset { _id: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedByName?: string }
interface Business {
  companyName: string; legalName?: string; tagline?: string; address?: string; city?: string; country: string; phone?: string; email?: string; website?: string; kraPin?: string;
  vatRegistered: boolean; vatRate: number; currency: string; bank: { name?: string; branch?: string; accountName?: string; accountNumber?: string; swift?: string };
  signatoryName?: string; signatoryTitle?: string; invoiceDueDays: number; quotationValidDays: number; invoiceNotes?: string; quotationTerms?: string; contractTemplate?: string; autoSign: boolean;
}
interface Settings { business: Business; assets: { logo: Asset | null; stamp: Asset | null; signature: Asset | null }; defaultContractTemplate: string }
interface Integration { provider: string; enabled?: boolean; environment?: string; settings?: Record<string, string>; health?: { status?: string } }

const ASSET_COPY = {
  signature: { title: 'Signature', hint: 'A scan or photo of your signature. A transparent PNG looks best.' },
  stamp: { title: 'Company stamp', hint: 'Your rubber stamp or seal. Transparent PNG recommended.' },
  logo: { title: 'Logo', hint: 'Shown at the top of every document.' },
} as const;

function AssetCard({ kind, asset }: { kind: keyof typeof ASSET_COPY; asset: Asset | null }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<unknown>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 1024 * 1024) throw new Error('Images must be 1 MB or smaller');
      const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
      return ownerApi(`/billing/assets/${kind}`, { method: 'POST', body: { dataBase64 } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-billing-settings'] }),
    onError: setErr,
  });
  const remove = useMutation({ mutationFn: () => ownerApi(`/billing/assets/${kind}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-billing-settings'] }) });
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between"><p className="font-medium">{ASSET_COPY[kind].title}</p>{asset ? <Badge tone="green">uploaded</Badge> : <Badge tone={kind === 'logo' ? 'gray' : 'amber'}>missing</Badge>}</div>
      <p className="muted mt-1 text-xs">{ASSET_COPY[kind].hint}</p>
      <div className="mt-3 grid h-32 place-items-center rounded-lg bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
        {asset ? <AuthImage path={`/owner/billing/assets/file/${asset._id}`} realm="owner" alt={ASSET_COPY[kind].title} className="max-h-28 max-w-full object-contain" /> : <ImagePlus className="h-8 w-8 text-slate-300" />}
      </div>
      {asset && <p className="muted mt-2 text-xs">{Math.round(asset.sizeBytes / 1024)} KB · {fmtDateTime(asset.createdAt)}{asset.uploadedByName ? ` · ${asset.uploadedByName}` : ''}</p>}
      <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setErr(null); upload.mutate(f); } e.target.value = ''; }} aria-label={`Upload ${ASSET_COPY[kind].title}`} />
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={upload.isPending}><Upload className="h-4 w-4" /> {asset ? 'Replace' : 'Upload'}</Button>
        {asset && <Button size="sm" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      <ErrorText error={err} />
    </div>
  );
}

export default function BillingSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-billing-settings'], queryFn: async () => (await ownerApi<Settings>('/billing/settings')).data });
  const mpesa = useQuery({ queryKey: ['owner-integration', 'mpesa_billing'], queryFn: async () => (await ownerApi<Integration[]>('/integrations')).data.find((i) => i.provider === 'mpesa_billing') ?? null });
  const [b, setB] = useState<Business | null>(null);
  useEffect(() => { if (q.data) setB(q.data.business); }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const clean = { ...b!, email: b!.email || undefined, contractTemplate: b!.contractTemplate?.trim() || undefined };
      return ownerApi('/billing/settings', { method: 'PUT', body: clean });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-billing-settings'] }),
  });
  const c2b = useMutation({ mutationFn: () => ownerApi('/billing/mpesa/register-c2b', { method: 'POST' }) });
  if (q.isLoading || !b) return q.error ? <ErrorText error={q.error} /> : <Loading />;
  const set = <K extends keyof Business>(k: K, v: Business[K]) => setB({ ...b, [k]: v });
  const bank = (k: keyof Business['bank'], v: string) => setB({ ...b, bank: { ...b.bank, [k]: v } });
  const a = q.data!.assets;
  return (
    <>
      <PageHeader title="Billing settings" crumbs={['Owner', 'Billing', 'Settings']} subtitle="Your business details, signature and stamp, payment channels and agreement template" actions={<Link href="/owner/billing"><Button variant="outline">Back to billing</Button></Link>} />
      <div className="space-y-5">
        <Card title="Signature & stamp">
          {(!a.signature || !a.stamp) && <div className="mb-4"><Alert tone="amber">Upload your signature and stamp. Every quotation, invoice and agreement is signed with them automatically when it is issued.</Alert></div>}
          <div className="grid gap-4 md:grid-cols-3">
            <AssetCard kind="signature" asset={a.signature} />
            <AssetCard kind="stamp" asset={a.stamp} />
            <AssetCard kind="logo" asset={a.logo} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Signatory name"><Input value={b.signatoryName ?? ''} onChange={(e) => set('signatoryName', e.target.value)} /></Field>
            <Field label="Signatory title"><Input value={b.signatoryTitle ?? ''} onChange={(e) => set('signatoryTitle', e.target.value)} placeholder="e.g. Managing Director" /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={b.autoSign} onChange={(e) => set('autoSign', e.target.checked)} /> Sign documents automatically when issued</label>
          </div>
          <p className="muted mt-2 text-xs">Replacing an image affects only documents issued afterwards; issued documents keep the signature and stamp they were signed with.</p>
        </Card>

        <Card title="Business details">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Trading name"><Input value={b.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
            <Field label="Registered (legal) name"><Input value={b.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} /></Field>
            <Field label="KRA PIN"><Input value={b.kraPin ?? ''} onChange={(e) => set('kraPin', e.target.value.toUpperCase())} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={b.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="City"><Input value={b.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="Phone"><Input value={b.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Billing email" hint="Receives acceptance notifications"><Input type="email" value={b.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Website"><Input value={b.website ?? ''} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="Tax & terms">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={b.vatRegistered} onChange={(e) => set('vatRegistered', e.target.checked)} /> VAT registered</label>
            <Field label="VAT rate (%)"><Input type="number" min={0} max={50} value={b.vatRate} disabled={!b.vatRegistered} onChange={(e) => set('vatRate', Number(e.target.value))} /></Field>
            <Field label="Invoice due (days)"><Input type="number" min={0} value={b.invoiceDueDays} onChange={(e) => set('invoiceDueDays', Number(e.target.value))} /></Field>
            <Field label="Quotation valid (days)"><Input type="number" min={1} value={b.quotationValidDays} onChange={(e) => set('quotationValidDays', Number(e.target.value))} /></Field>
            <Field label="Default invoice note" className="sm:col-span-2"><Textarea rows={2} value={b.invoiceNotes ?? ''} onChange={(e) => set('invoiceNotes', e.target.value)} /></Field>
            <Field label="Default quotation terms" className="sm:col-span-2"><Textarea rows={2} value={b.quotationTerms ?? ''} onChange={(e) => set('quotationTerms', e.target.value)} /></Field>
          </div>
          {b.vatRegistered && <p className="muted mt-2 text-xs">Invoices are titled “Tax Invoice”. Submission to KRA eTIMS is not automated; record eTIMS invoices separately if required.</p>}
        </Card>

        <Card title="Payment channels">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between"><p className="font-medium">M-Pesa (Daraja)</p>{mpesa.data?.enabled ? <Badge tone="green">active · {mpesa.data.environment}</Badge> : <Badge tone="amber">not configured</Badge>}</div>
              <p className="muted mt-1 text-sm">Facilities pay invoices with an STK prompt from AfeySync, or through your paybill using the invoice number as the account. Payments are confirmed automatically by Safaricom.</p>
              {mpesa.data?.settings?.paybill && <p className="mt-2 text-sm">Paybill <strong>{mpesa.data.settings.paybill}</strong></p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/owner/integrations/mpesa_billing"><Button size="sm" variant="secondary">Configure credentials</Button></Link>
                {mpesa.data?.enabled && <Button size="sm" variant="ghost" onClick={() => c2b.mutate()} loading={c2b.isPending}>Register paybill URLs</Button>}
              </div>
              {c2b.isSuccess && <p className="mt-2 text-xs text-emerald-600">Paybill confirmation URLs registered with Safaricom.</p>}
              <ErrorText error={c2b.error} />
            </div>
            <div className="rounded-xl border border-[var(--border)] p-4">
              <p className="font-medium">Bank transfer</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Bank"><Input value={b.bank.name ?? ''} onChange={(e) => bank('name', e.target.value)} /></Field>
                <Field label="Branch"><Input value={b.bank.branch ?? ''} onChange={(e) => bank('branch', e.target.value)} /></Field>
                <Field label="Account name"><Input value={b.bank.accountName ?? ''} onChange={(e) => bank('accountName', e.target.value)} /></Field>
                <Field label="Account number"><Input value={b.bank.accountNumber ?? ''} onChange={(e) => bank('accountNumber', e.target.value)} /></Field>
                <Field label="SWIFT"><Input value={b.bank.swift ?? ''} onChange={(e) => bank('swift', e.target.value)} /></Field>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Service agreement template" actions={<Button size="sm" variant="ghost" onClick={() => set('contractTemplate', q.data!.defaultContractTemplate)}>Load default</Button>}>
          <p className="muted mb-2 text-sm">Lines starting with <code>## </code> become headings. Placeholders: <code>{'{{customer.name}}'}</code> <code>{'{{provider.name}}'}</code> <code>{'{{plan.name}}'}</code> <code>{'{{plan.modules}}'}</code> <code>{'{{fee}}'}</code> <code>{'{{cycle}}'}</code> <code>{'{{startDate}}'}</code> <code>{'{{termMonths}}'}</code> <code>{'{{dueDays}}'}</code>. Leave it empty to use the default.</p>
          <Textarea rows={14} className="font-mono text-xs" value={b.contractTemplate ?? ''} onChange={(e) => set('contractTemplate', e.target.value)} placeholder="Using the default AfeySync agreement. Click “Load default” to customise it." />
          <p className="muted mt-2 text-xs">Have the template reviewed by your advocate before use. Issued agreements keep the text they were issued with.</p>
        </Card>

        <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <Button onClick={() => save.mutate()} loading={save.isPending}>Save settings</Button>
          {save.isSuccess && <span className="text-sm text-emerald-600">Saved</span>}
          <div className="flex-1"><ErrorText error={save.error} /></div>
        </div>
      </div>
    </>
  );
}
