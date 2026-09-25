'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, Select, Table, Td } from '@/components/ui';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';
import { maskMember, type Coverage, type Payer } from './types';

const TONE = { eligible: 'green', not_eligible: 'red', error: 'red', unknown: 'gray' } as const;
const LABEL = { eligible: 'ACTIVE', not_eligible: 'INACTIVE', error: 'ERROR', unknown: 'NOT CHECKED' } as const;

function AddCoverage({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const payers = useQuery({ queryKey: ['ins-payers-enabled'], queryFn: async () => (await api<Payer[]>('/insurance/payers', { query: { enabled: 'true' } })).data });
  const [f, setF] = useState({ payerId: '', memberNumber: '', schemeName: '', policyNumber: '', principalMember: 'true', principalMemberName: '', relationship: '' });
  const m = useMutation({ mutationFn: () => api('/insurance/coverages', { method: 'POST', body: { patientId, payerId: f.payerId, memberNumber: f.memberNumber, schemeName: f.schemeName || undefined, policyNumber: f.policyNumber || undefined, principalMember: f.principalMember === 'true', principalMemberName: f.principalMemberName || undefined, relationship: f.relationship || undefined } }), onSuccess: onDone });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Insurance provider" className="sm:col-span-2">
        <Select value={f.payerId} onChange={(e) => setF({ ...f, payerId: e.target.value })}>
          <option value="">Select…</option>
          {payers.data?.map((p) => <option key={p._id} value={p._id}>{p.displayName ?? p.name}{p.sladeCode ? ` (Slade ${p.sladeCode})` : ''}</option>)}
        </Select>
      </Field>
      {payers.data?.length === 0 && <div className="sm:col-span-2"><Alert tone="amber">No insurers are enabled for this facility yet (Insurance → Payers).</Alert></div>}
      <Field label="Member number"><Input value={f.memberNumber} onChange={(e) => setF({ ...f, memberNumber: e.target.value })} /></Field>
      <Field label="Scheme"><Input value={f.schemeName} onChange={(e) => setF({ ...f, schemeName: e.target.value })} /></Field>
      <Field label="Policy number"><Input value={f.policyNumber} onChange={(e) => setF({ ...f, policyNumber: e.target.value })} /></Field>
      <Field label="Principal member?"><Select value={f.principalMember} onChange={(e) => setF({ ...f, principalMember: e.target.value })}><option value="true">Yes</option><option value="false">No (dependant)</option></Select></Field>
      {f.principalMember === 'false' && <>
        <Field label="Principal member name"><Input value={f.principalMemberName} onChange={(e) => setF({ ...f, principalMemberName: e.target.value })} /></Field>
        <Field label="Relationship"><Input value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="e.g. spouse, child" /></Field>
      </>}
      <div className="space-y-2 sm:col-span-2"><ErrorText error={m.error} /><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!f.payerId || f.memberNumber.length < 2}>Save insurance</Button></div>
    </div>
  );
}

function Authenticate({ c, onClose }: { c: Coverage; onClose: () => void }) {
  const router = useRouter();
  const me = useMe();
  const [method, setMethod] = useState<'otp' | 'fingerprint' | 'guardian'>('otp');
  const [contactId, setContactId] = useState(c.contacts?.[0]?.id ?? '');
  const [otp, setOtp] = useState('');
  const [benefit, setBenefit] = useState(c.benefits?.[0]?.code ?? '');
  const send = useMutation({ mutationFn: () => api(`/insurance/coverages/${c._id}/request-otp`, { method: 'POST', body: { contactId } }) });
  const start = useMutation({
    mutationFn: async () => (await api<{ _id: string }>('/insurance/visits', { method: 'POST', body: { coverageId: c._id, method, otp: method === 'otp' ? otp : undefined, contactId: method === 'otp' ? contactId : undefined, benefitCode: benefit || undefined, benefitType: c.benefits?.find((b) => b.code === benefit)?.type } })).data,
    onSuccess: (v) => { onClose(); router.push(`/insurance/visits/${v._id}`); },
  });
  const branch = me.data?.activeBranch;
  return (
    <div className="space-y-4">
      {!branch && <Alert tone="amber">Select a branch in the top bar before starting a visit.</Alert>}
      <Field label="Authentication method">
        <div className="flex flex-wrap gap-3 text-sm">
          {(['otp', 'fingerprint', 'guardian'] as const).map((m) => <label key={m} className="flex items-center gap-1"><input type="radio" checked={method === m} onChange={() => setMethod(m)} /> {m === 'otp' ? 'OTP' : m === 'fingerprint' ? 'Fingerprint' : 'Guardian'}</label>)}
        </div>
      </Field>
      {method !== 'otp' && <Alert tone="blue">Fingerprint and guardian authentication need Slade360-supported devices at this facility. If they are not configured, starting the visit will be refused — AfeySync never simulates biometric success.</Alert>}
      {method === 'otp' && (
        <>
          <Field label="Phone">
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>{(c.contacts ?? []).map((x) => <option key={x.id} value={x.id}>{x.masked}</option>)}</Select>
          </Field>
          {(c.contacts ?? []).length === 0 && <Alert tone="amber">The eligibility check returned no contacts for OTP.</Alert>}
          <Button size="sm" variant="secondary" onClick={() => send.mutate()} loading={send.isPending} disabled={!contactId}>Send OTP</Button>
          {send.isSuccess && <Alert tone="green">OTP sent.</Alert>}
          <ErrorText error={send.error} />
          <Field label="Enter OTP"><Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={8} autoComplete="one-time-code" className="font-mono tracking-widest" /></Field>
        </>
      )}
      <Field label="Benefit">
        <Select value={benefit} onChange={(e) => setBenefit(e.target.value)}><option value="">—</option>{(c.benefits ?? []).map((b) => <option key={b.code ?? b.name} value={b.code ?? ''}>{b.name ?? b.code}{b.balance !== undefined ? ` · available ${money(b.balance)}` : ''}</option>)}</Select>
      </Field>
      <ErrorText error={start.error} />
      <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!branch || (method === 'otp' && otp.length < 4)}>Verify & start visit</Button>
    </div>
  );
}

/** Patient insurance covers (multiple payers, history kept). Eligibility and member authentication run on the server. */
export function CoveragePanel({ patientId }: { patientId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [auth, setAuth] = useState<Coverage | null>(null);
  const list = useQuery({ queryKey: ['coverages', patientId], queryFn: async () => (await api<Coverage[]>('/insurance/coverages', { query: { patientId } })).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['coverages', patientId] });
  const elig = useMutation({ mutationFn: (id: string) => api(`/insurance/coverages/${id}/eligibility`, { method: 'POST' }), onSuccess: (_d, id) => { setOpen(id); refresh(); } });
  return (
    <Card title="Insurance coverage" actions={can('insurance.eligibility') && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add insurance</Button>}>
      {list.isLoading && <Loading />}
      <ErrorText error={list.error ?? elig.error} />
      {(list.data ?? []).length === 0 && !list.isLoading && <p className="muted text-sm">No private insurance recorded. SHA cover is managed from the SHA tabs.</p>}
      <div className="space-y-3">
        {list.data?.map((c) => {
          const fresh = c.lastEligibilityCheck && Date.now() - new Date(c.lastEligibilityCheck).getTime() < 24 * 3600_000;
          return (
            <div key={c._id} className={`rounded-lg border border-[var(--border)] p-3 ${c.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{c.payerName} {!c.isActive && <Badge>inactive</Badge>}</p>
                  <p className="muted text-xs">Member {maskMember(c.memberNumber)}{c.schemeName ? ` · ${c.schemeName}` : ''}{c.relationship ? ` · ${c.relationship}` : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[c.eligibilityStatus]}>{LABEL[c.eligibilityStatus]}</Badge>
                  <span className="muted text-xs">{c.lastEligibilityCheck ? fmtDateTime(c.lastEligibilityCheck) : ''}</span>
                  {c.isActive && can('insurance.eligibility') && <Button size="sm" variant="ghost" onClick={() => elig.mutate(c._id)} loading={elig.isPending && elig.variables === c._id}><ShieldCheck className="h-4 w-4" /> {fresh ? 'Refresh eligibility' : 'Check eligibility'}</Button>}
                  {c.isActive && c.eligibilityStatus === 'eligible' && fresh && can('insurance.eligibility') && <Button size="sm" onClick={() => setAuth(c)}>Authenticate & start visit</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open === c._id ? null : c._id)}>{open === c._id ? 'Hide' : 'Details'}</Button>
                </div>
              </div>
              {open === c._id && (
                <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                  <KV items={[['Insurer', c.payerName], ['Member number', c.memberNumber], ['Status', LABEL[c.eligibilityStatus]], ['Policy', c.policyNumber ?? '—'], ['Scheme', c.schemeName ?? '—'], ['Valid from', fmtDate(c.validFrom)], ['Valid to', fmtDate(c.validTo)], ['Panel', c.panelStatus ?? '—'], ['Principal', c.principalMember ? 'Self' : c.principalMemberName ?? '—']]} />
                  {(c.benefits ?? []).length > 0 && (
                    <Table head={['Benefit', 'Available balance', 'Copay', 'Status']}>
                      {c.benefits!.map((b, i) => <tr key={i}><Td>{b.name ?? b.code}</Td><Td>{b.balance !== undefined ? money(b.balance) : '—'}</Td><Td>{b.copay !== undefined ? money(b.copay) : '—'}</Td><Td>{b.status ?? '—'}</Td></tr>)}
                    </Table>
                  )}
                  <details className="text-xs"><summary className="cursor-pointer">History</summary><ul className="mt-1 space-y-0.5">{[...(c.history ?? [])].reverse().map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.action.replace(/_/g, ' ')} · {h.byName}</li>)}</ul></details>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add insurance" wide>{adding && <AddCoverage patientId={patientId} onDone={() => { setAdding(false); refresh(); }} />}</Modal>
      <Modal open={!!auth} onClose={() => setAuth(null)} title={auth ? `Authenticate member — ${auth.payerName}` : ''}>{auth && <Authenticate c={auth} onClose={() => setAuth(null)} />}</Modal>
    </Card>
  );
}
