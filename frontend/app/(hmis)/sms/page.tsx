'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import type { PayerScheme } from '@/features/billing/types';

interface Preview { recipientCount: number; excluded: { noConsent: number; noPhone: number; duplicate: number }; segments: number; credits: number; charged: boolean; balance: number | null; enough: boolean; sample: string; tooMany: boolean }
interface Stats { sent: number; pending: number; failed: number; cancelled: number }
interface Campaign { _id: string; campaignNumber: string; name: string; message: string; status: string; scheduledAt?: string; recipientCount: number; credits: number; createdAt: string; createdByName?: string; stats: Stats }
interface CampaignDetail extends Campaign { recipients: Array<{ phone: string; status: string; error?: string }> }

const TEMPLATES: Array<[string, string]> = [
  ['Screening / outreach day', 'Hi {firstName}, we are holding a free health screening on Saturday from 8am. Walk in, no appointment needed.'],
  ['Immunisation reminder', 'Hi {firstName}, your child\'s next immunisation is due this week. Please bring the MCH booklet.'],
  ['Clinic hours change', 'Hi {firstName}, our clinic will open from 7am to 9pm starting Monday. Call us to book.'],
  ['Public holiday notice', 'Hi {firstName}, the outpatient clinic is closed on the public holiday. Emergency services remain open 24 hours.'],
];

function segmentsOf(text: string) {
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const len = text.length;
  return gsm ? (len <= 160 ? 1 : Math.ceil(len / 153)) : len <= 70 ? 1 : Math.ceil(len / 67);
}

function Compose({ onSent }: { onSent: () => void }) {
  const me = useMe();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'patients' | 'numbers'>('patients');
  const [a, setA] = useState({ branchId: '', gender: '', ageMin: '', ageMax: '', visitedFrom: '', visitedTo: '', payerType: '', schemeId: '' });
  const [numbers, setNumbers] = useState('');
  const [when, setWhen] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const schemes = useQuery({ queryKey: ['schemes', 'active'], queryFn: async () => (await api<PayerScheme[]>('/billing/schemes')).data, enabled: kind === 'patients' });
  const audience = () => (kind === 'numbers'
    ? { kind, numbers: numbers.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean) }
    : { kind, branchId: a.branchId || undefined, gender: a.gender || undefined, ageMin: a.ageMin ? Number(a.ageMin) : undefined, ageMax: a.ageMax ? Number(a.ageMax) : undefined, visitedFrom: a.visitedFrom || undefined, visitedTo: a.visitedTo || undefined, payerType: a.payerType || undefined, schemeId: a.schemeId || undefined });
  const check = useMutation({ mutationFn: async () => (await api<Preview>('/sms/campaigns/preview', { method: 'POST', body: { message, audience: audience() } })).data, onSuccess: setPreview });
  const send = useMutation({ mutationFn: () => api('/sms/campaigns', { method: 'POST', body: { name, message, audience: audience(), scheduledAt: when ? new Date(when).toISOString() : undefined } }), onSuccess: () => { setPreview(null); setName(''); setMessage(''); onSent(); } });
  const reset = () => setPreview(null);
  const facility = me.data?.tenant.name ?? 'Facility';
  const approx = `${facility}: ${message.replace(/\{firstName\}/g, 'Jane')}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign name (for your records)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. March screening day" /></Field>
        <Field label="Start from a template"><Select value="" onChange={(e) => { if (e.target.value) { setMessage(e.target.value); reset(); } }}><option value="">Choose…</option>{TEMPLATES.map(([l, t]) => <option key={l} value={t}>{l}</option>)}</Select></Field>
      </div>
      <Field label="Message" hint={`Type {firstName} to greet each patient by name. The facility name is added at the start. About ${approx.length} characters · ${segmentsOf(approx)} SMS each.`}>
        <Textarea value={message} maxLength={612} onChange={(e) => { setMessage(e.target.value); reset(); }} placeholder="Hi {firstName}, …" />
      </Field>
      <Field label="Send to">
        <Select value={kind} onChange={(e) => { setKind(e.target.value as 'patients' | 'numbers'); reset(); }}><option value="patients">Patients matching filters</option><option value="numbers">A list of phone numbers</option></Select>
      </Field>
      {kind === 'patients' ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Branch"><Select value={a.branchId} onChange={(e) => { setA({ ...a, branchId: e.target.value }); reset(); }}><option value="">All my branches</option>{me.data?.branches.map((b) => <option key={b._id} value={b._id}>{b.branchName}</option>)}</Select></Field>
          <Field label="Sex"><Select value={a.gender} onChange={(e) => { setA({ ...a, gender: e.target.value }); reset(); }}><option value="">Any</option><option value="female">Female</option><option value="male">Male</option></Select></Field>
          <Field label="Age from"><Input type="number" min={0} value={a.ageMin} onChange={(e) => { setA({ ...a, ageMin: e.target.value }); reset(); }} /></Field>
          <Field label="Age to"><Input type="number" min={0} value={a.ageMax} onChange={(e) => { setA({ ...a, ageMax: e.target.value }); reset(); }} /></Field>
          <Field label="Visited from"><Input type="date" value={a.visitedFrom} onChange={(e) => { setA({ ...a, visitedFrom: e.target.value }); reset(); }} /></Field>
          <Field label="Visited to"><Input type="date" value={a.visitedTo} onChange={(e) => { setA({ ...a, visitedTo: e.target.value }); reset(); }} /></Field>
          <Field label="Payer at the visit"><Select value={a.payerType} onChange={(e) => { setA({ ...a, payerType: e.target.value, schemeId: '' }); reset(); }}><option value="">Any</option><option value="cash">Cash</option><option value="sha">SHA</option><option value="insurance">Insurance</option><option value="corporate">Corporate</option></Select></Field>
          <Field label="Scheme"><Select value={a.schemeId} onChange={(e) => { setA({ ...a, schemeId: e.target.value }); reset(); }}><option value="">Any</option>{schemes.data?.filter((s) => !a.payerType || s.kind === a.payerType).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
        </div>
      ) : (
        <Field label="Phone numbers" hint="One per line or separated by commas. Numbers of patients who declined SMS are left out."><Textarea value={numbers} onChange={(e) => { setNumbers(e.target.value); reset(); }} placeholder={'0712345678\n0798765432'} /></Field>
      )}
      <Field label="Send at (optional)" hint="Leave empty to send now."><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="sm:w-72" /></Field>
      <ErrorText error={check.error ?? send.error} />
      {preview && (
        <div className="space-y-3 rounded-md border border-[var(--border)] p-3">
          <KV items={[
            ['Recipients', preview.recipientCount],
            ['Left out', `${preview.excluded.noConsent} declined SMS · ${preview.excluded.noPhone} without a valid phone · ${preview.excluded.duplicate} duplicate numbers`],
            ['SMS each', preview.segments],
            ['Credits needed', preview.charged ? `${preview.credits} (wallet has ${preview.balance ?? 0})` : `${preview.credits} (sent through your own SMS account)`],
          ]} />
          <p className="rounded-md bg-[var(--surface-2)] p-3 text-sm"><span className="muted block text-xs">Preview</span>{preview.sample}</p>
          {!preview.enough && <Alert tone="amber" title="Not enough SMS credits">Top up in <Link className="underline" href="/admin/sms">SMS wallet</Link> first, or narrow the group.</Alert>}
          {preview.tooMany && <Alert tone="amber">A campaign can go to at most 5,000 people. Narrow the filters.</Alert>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => check.mutate()} loading={check.isPending} disabled={message.trim().length < 3}>Check recipients &amp; cost</Button>
        <Button onClick={() => confirm(`Send "${name}" to ${preview?.recipientCount} people? Sent SMS cannot be recalled.`) && send.mutate()} loading={send.isPending} disabled={!preview || !preview.enough || preview.tooMany || !preview.recipientCount || name.trim().length < 3}><Send className="h-4 w-4" /> {when ? 'Schedule' : 'Send now'}</Button>
      </div>
    </div>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const q = useQuery({ queryKey: ['sms-campaign', id], queryFn: async () => (await api<CampaignDetail>(`/sms/campaigns/${id}`)).data, refetchInterval: 10_000 });
  const cancel = useMutation({ mutationFn: () => api(`/sms/campaigns/${id}/cancel`, { method: 'POST' }), onSuccess: () => { q.refetch(); onChanged(); } });
  if (!q.data) return <Loading />;
  const c = q.data;
  return (
    <div className="space-y-3">
      <KV items={[['Message', c.message], ['Status', c.status], ['Created', `${c.createdByName ?? ''}, ${fmtDateTime(c.createdAt)}`], ...(c.scheduledAt ? [['Scheduled for', fmtDateTime(c.scheduledAt)] as [string, string]] : []), ['Sent / waiting / failed', `${c.stats.sent} / ${c.stats.pending} / ${c.stats.failed}${c.stats.cancelled ? ` · ${c.stats.cancelled} cancelled` : ''}`]]} />
      {c.status !== 'cancelled' && c.stats.pending > 0 && <Button variant="outline" onClick={() => confirm('Stop the messages that have not gone out yet?') && cancel.mutate()} loading={cancel.isPending}>Stop unsent messages</Button>}
      <ErrorText error={cancel.error} />
      <Table head={['Phone', 'Status', 'Reason']}>
        {c.recipients.map((r, i) => <tr key={i}><Td className="font-mono text-xs">{r.phone}</Td><Td><Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'gray'}>{r.status}</Badge></Td><Td className="text-xs">{r.error}</Td></tr>)}
      </Table>
    </div>
  );
}

export default function BulkSmsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['sms-campaigns'], queryFn: async () => (await api<Campaign[]>('/sms/campaigns')).data, enabled: can('sms.bulk') });
  if (!can('sms.bulk')) return <Alert tone="amber">You do not have permission to send bulk SMS.</Alert>;
  const refresh = () => qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
  return (
    <>
      <PageHeader title="Bulk SMS" subtitle="Health reminders and notices to a group of patients. Patients who declined SMS are always left out." crumbs={['Communication', 'Bulk SMS']} />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card title="New message"><Compose onSent={refresh} /></Card>
        <Card title="Sent campaigns">
          {list.isLoading ? <Loading /> : (
            <Table head={['Campaign', 'When', 'People', 'Delivery', '']} empty={(list.data ?? []).length === 0}>
              {list.data?.map((c) => (
                <tr key={c._id}>
                  <Td>{c.name}<span className="muted block font-mono text-xs">{c.campaignNumber}</span></Td>
                  <Td className="text-xs">{fmtDateTime(c.scheduledAt ?? c.createdAt)}{c.status !== 'sending' && <Badge tone={c.status === 'cancelled' ? 'gray' : 'blue'} className="ml-1">{c.status}</Badge>}</Td>
                  <Td>{c.recipientCount}</Td>
                  <Td className="text-xs"><span className="text-emerald-600">{c.stats.sent} sent</span>{c.stats.pending > 0 && <> · {c.stats.pending} waiting</>}{c.stats.failed > 0 && <span className="text-red-600"> · {c.stats.failed} failed</span>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setOpen(c._id)}>Open</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Campaign" wide>{open && <Detail id={open} onChanged={refresh} />}</Modal>
    </>
  );
}
