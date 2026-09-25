'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, statusTone, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import { EmergencyPanel } from '@/features/sha/EmergencyPanel';

interface Line { serviceCode: string; description: string; quantity: number; unitPrice: number; amount?: number }
interface Dx { code: string; display: string; system?: string }
interface Tx {
  _id: string; kind: string; reference: string; externalReference?: string; status: string;
  patientId: { _id: string; patientNumber: string; firstName: string; lastName: string; clientRegistryId?: string; gender?: string; dateOfBirth?: string };
  visitId?: string; invoiceId?: string; benefitCode?: string; interventionCode?: string; accessPoint?: string; clinicalJustification?: string;
  diagnoses: Dx[]; lines: Line[]; amounts?: { claimed?: number; approved?: number; paid?: number };
  statusHistory: Array<{ status: string; at: string; source: string; note?: string }>;
  submissions?: number; submittedAt?: string; decisionNote?: string; lastResponse?: unknown;
  remittances?: Array<{ amount: number; reference: string; at: string }>;
  emergency?: { protocols?: Array<{ code: string; name?: string; notes?: string; addedAt: string }>; doctors?: Array<{ name: string; registrationNumber: string; addedAt: string }> };
}

const KIND_LABEL: Record<string, string> = { claim: 'Claim', emergency_claim: 'Emergency claim', preauthorization: 'Preauthorization', authorization: 'Authorization', visit_consent: 'Visit consent' };
const KIND_PERM: Record<string, string> = { claim: 'sha.claim', emergency_claim: 'sha.claim', preauthorization: 'sha.preauthorization', authorization: 'sha.authorization', visit_consent: 'sha.authorization' };

function Editor({ tx, onDone }: { tx: Tx; onDone: () => void }) {
  const [f, setF] = useState({ interventionCode: tx.interventionCode ?? '', benefitCode: tx.benefitCode ?? '', accessPoint: tx.accessPoint ?? 'OP', clinicalJustification: tx.clinicalJustification ?? '' });
  const [dx, setDx] = useState<Dx[]>(tx.diagnoses.length ? tx.diagnoses : [{ code: '', display: '' }]);
  const [lines, setLines] = useState<Line[]>(tx.lines);
  const save = useMutation({
    mutationFn: () => api(`/sha/transactions/${tx._id}`, { method: 'PATCH', body: { ...f, interventionCode: f.interventionCode || undefined, benefitCode: f.benefitCode || undefined, clinicalJustification: f.clinicalJustification || undefined, diagnoses: dx.filter((d) => d.display.trim()), lines: lines.filter((l) => l.serviceCode && l.description).map(({ amount: _a, ...l }) => l) } }),
    onSuccess: onDone,
  });
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="SHA intervention code"><Input value={f.interventionCode} onChange={(e) => setF({ ...f, interventionCode: e.target.value })} placeholder="From Benefit Interventions" /></Field>
        <Field label="Benefit code"><Input value={f.benefitCode} onChange={(e) => setF({ ...f, benefitCode: e.target.value })} /></Field>
        <Field label="Access point"><Select value={f.accessPoint} onChange={(e) => setF({ ...f, accessPoint: e.target.value })}><option>OP</option><option>IP</option></Select></Field>
      </div>
      <div>
        <p className="label">Diagnoses</p>
        {dx.map((d, i) => (
          <div key={i} className="mb-2 grid grid-cols-[120px_1fr_auto] gap-2">
            <Input placeholder="ICD-11 code" value={d.code} onChange={(e) => setDx(upd(dx, i, { code: e.target.value }))} />
            <Input placeholder="Diagnosis" value={d.display} onChange={(e) => setDx(upd(dx, i, { display: e.target.value }))} />
            <Button variant="ghost" onClick={() => setDx(dx.filter((_, j) => j !== i))} aria-label="Remove diagnosis"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setDx([...dx, { code: '', display: '' }])}><Plus className="h-3 w-3" /> Diagnosis</Button>
      </div>
      <div>
        <p className="label">Services</p>
        {lines.map((l, i) => (
          <div key={i} className="mb-2 grid grid-cols-[110px_1fr_70px_110px_auto] gap-2">
            <Input value={l.serviceCode} onChange={(e) => setLines(upd(lines, i, { serviceCode: e.target.value }))} />
            <Input value={l.description} onChange={(e) => setLines(upd(lines, i, { description: e.target.value }))} />
            <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines(upd(lines, i, { quantity: Number(e.target.value) }))} />
            <Input type="number" min={0} value={l.unitPrice} onChange={(e) => setLines(upd(lines, i, { unitPrice: Number(e.target.value) }))} />
            <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex justify-between">
          <Button size="sm" variant="outline" onClick={() => setLines([...lines, { serviceCode: '', description: '', quantity: 1, unitPrice: 0 }])}><Plus className="h-3 w-3" /> Service</Button>
          <span className="text-sm font-semibold">Total {money(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))}</span>
        </div>
      </div>
      <Field label="Clinical justification"><Textarea value={f.clinicalJustification} onChange={(e) => setF({ ...f, clinicalJustification: e.target.value })} /></Field>
      <ErrorText error={save.error} />
      <Button onClick={() => save.mutate()} loading={save.isPending}>Save changes</Button>
    </div>
  );
}

export default function ShaTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'edit' | 'decision' | 'intervention' | 'reopen' | 'cancel' | 'reconcile' | 'fhir'>(null);
  const [dec, setDec] = useState({ status: 'approved', approvedAmount: '', externalReference: '', note: '' });
  const [text, setText] = useState('');
  const [rec, setRec] = useState({ amount: '', reference: '', note: '' });
  const q = useQuery({ queryKey: ['sha-tx-detail', id], queryFn: async () => (await api<Tx>(`/sha/transactions/${id}`)).data });
  const fhir = useQuery({ queryKey: ['sha-tx-fhir', id], queryFn: async () => (await api<{ resource: unknown; validation: string[] }>(`/sha/transactions/${id}/fhir`)).data, enabled: modal === 'fhir' });
  const done = () => { setModal(null); setText(''); qc.invalidateQueries({ queryKey: ['sha-tx-detail', id] }); qc.invalidateQueries({ queryKey: ['sha-tx'] }); };
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/sha/transactions/${id}/${path}`, { method: 'POST', body: body ?? {} }), onSuccess: done });
  const submit = useMutation({ mutationFn: () => api(`/sha/transactions/${id}/submit`, { method: 'POST' }), onSettled: () => qc.invalidateQueries({ queryKey: ['sha-tx-detail', id] }) });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const tx = q.data;
  const perm = can(KIND_PERM[tx.kind]);
  const draft = ['draft', 'failed'].includes(tx.status);
  const isClaim = ['claim', 'emergency_claim'].includes(tx.kind);
  const outstanding = (tx.amounts?.approved ?? 0) - (tx.amounts?.paid ?? 0);
  const submitErr = submit.error instanceof ApiError ? submit.error : null;
  const openModal = (m: typeof modal) => { act.reset(); setModal(m); };

  return (
    <>
      <PageHeader
        title={`${KIND_LABEL[tx.kind] ?? tx.kind} ${tx.reference}`}
        crumbs={['SHA', 'Claims', tx.reference]}
        subtitle={<Badge tone={statusTone(tx.status)}>{tx.status.replace(/_/g, ' ')}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setModal('fhir')}>FHIR preview</Button>
            {draft && perm && <>
              <Button variant="outline" onClick={() => openModal('edit')}>Edit</Button>
              <Button variant="ghost" onClick={() => openModal('cancel')}>Cancel</Button>
              <Button onClick={() => submit.mutate()} loading={submit.isPending}><Send className="h-4 w-4" /> Submit to SHA</Button>
            </>}
            {['submitted', 'pending', 'intervention_required'].includes(tx.status) && perm && <Button variant="outline" onClick={() => openModal('decision')}>Record decision</Button>}
            {tx.status === 'intervention_required' && can('sha.intervention') && <Button onClick={() => openModal('intervention')}>Respond</Button>}
            {['rejected', 'intervention_required', 'failed'].includes(tx.status) && perm && <Button variant="ghost" onClick={() => openModal('reopen')}>Reopen for correction</Button>}
            {isClaim && ['approved', 'paid'].includes(tx.status) && outstanding > 0 && can('sha.reconciliation') && <Button onClick={() => { setRec({ amount: String(outstanding), reference: '', note: '' }); openModal('reconcile'); }}>Record remittance</Button>}
          </div>
        }
      />
      {submitErr && (submitErr.code === 'SHA_TX_INCOMPLETE' ? (
        <Alert tone="amber" title="Not ready to submit"><ul className="list-disc pl-4 text-sm">{(submitErr.details as string[]).map((x) => <li key={x}>{x}</li>)}</ul></Alert>
      ) : submitErr.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED' ? (
        <Alert tone="amber" title="SHA submission not yet configured">The SHA operation for this transaction type has not been configured by AfeySync platform administration from the official HIE API catalog. The draft is saved and can be submitted once it is enabled.</Alert>
      ) : <ErrorText error={submitErr} />)}
      {tx.status === 'failed' && <Alert tone="red" title="Last submission failed">Correct the record if needed and submit again. Details are in the response below.</Alert>}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Services">
            <Table head={['Code', 'Service', 'Qty', 'Unit', 'Amount']} empty={tx.lines.length === 0}>
              {tx.lines.map((l, i) => <tr key={i}><Td className="font-mono text-xs">{l.serviceCode}</Td><Td>{l.description}</Td><Td>{l.quantity}</Td><Td>{money(l.unitPrice)}</Td><Td>{money(l.amount)}</Td></tr>)}
            </Table>
          </Card>
          <Card title="Diagnoses">
            {tx.diagnoses.length === 0 ? <p className="muted text-sm">None recorded. Finalized consultation diagnoses are added automatically when a claim is built from an invoice.</p> : (
              <ul className="space-y-1 text-sm">{tx.diagnoses.map((d, i) => <li key={i}><span className="font-mono text-xs">{d.code || '—'}</span> {d.display}</li>)}</ul>
            )}
            {tx.clinicalJustification && <p className="mt-3 whitespace-pre-wrap text-sm"><span className="label">Justification</span>{tx.clinicalJustification}</p>}
          </Card>
          {tx.kind === 'emergency_claim' && <EmergencyPanel txId={tx._id} emergency={tx.emergency} editable={perm && !!tx.externalReference && !['cancelled', 'paid'].includes(tx.status)} />}
          <DocumentsPanel title="Supporting documents" patientId={tx.patientId._id} relatedTo={{ resource: 'sha_transaction', id: tx._id }} category="sha" />
          {tx.lastResponse != null && <Card title="Last SHA response"><pre className="max-h-72 overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(tx.lastResponse, null, 2)}</pre></Card>}
        </div>
        <div className="space-y-5">
          <Card title="Summary">
            <KV items={[
              ['Patient', <Link key="p" className="text-brand-600" href={`/patients/${tx.patientId._id}`}>{tx.patientId.firstName} {tx.patientId.lastName}</Link>],
              ['Patient no.', tx.patientId.patientNumber],
              ['CR ID', tx.patientId.clientRegistryId ?? <Badge key="cr" tone="amber">missing</Badge>],
              ['Intervention', tx.interventionCode],
              ['Benefit', tx.benefitCode],
              ['Access point', tx.accessPoint],
              ['SHA reference', tx.externalReference],
              ['Invoice', tx.invoiceId ? <Link key="i" className="text-brand-600" href={`/billing/invoices/${tx.invoiceId}`}>Open invoice</Link> : '—'],
              ['Submitted', tx.submittedAt ? `${fmtDateTime(tx.submittedAt)} (${tx.submissions}×)` : '—'],
            ]} />
          </Card>
          <Card title="Amounts">
            <KV items={[['Claimed', money(tx.amounts?.claimed)], ['Approved', money(tx.amounts?.approved)], ['Received', money(tx.amounts?.paid)], ['Outstanding', money(Math.max(0, outstanding))]]} />
            {(tx.remittances ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-xs">{tx.remittances!.map((r) => <li key={r.reference} className="flex justify-between"><span>{fmtDateTime(r.at)} · {r.reference}</span><span className="font-medium">{money(r.amount)}</span></li>)}</ul>
            )}
          </Card>
          <Card title="Status history">
            <ol className="space-y-2 text-sm">
              {[...tx.statusHistory].reverse().map((s, i) => (
                <li key={i} className="border-l-2 border-[var(--border)] pl-3">
                  <Badge tone={statusTone(s.status)}>{s.status.replace(/_/g, ' ')}</Badge> <span className="muted text-xs">{fmtDateTime(s.at)} · {s.source}</span>
                  {s.note && <p className="text-xs">{s.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
          <p className="muted text-xs">Technical submission, SHA UAT and certification are separate milestones. Status changes come from SHA responses, verified callbacks, or decisions recorded here with a note (audited).</p>
        </div>
      </div>

      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit draft" wide>{modal === 'edit' && <Editor tx={tx} onDone={done} />}</Modal>
      <Modal open={modal === 'fhir'} onClose={() => setModal(null)} title="FHIR R4 Claim preview" wide>
        {fhir.isLoading ? <Loading /> : fhir.data && (
          <div className="space-y-3">
            {fhir.data.validation.length ? <Alert tone="red" title="Structural issues"><ul className="list-disc pl-4 text-xs">{fhir.data.validation.map((x) => <li key={x}>{x}</li>)}</ul></Alert> : <Alert tone="green">Passes structural FHIR R4 validation. Profile conformance must be verified against the SHA eClaims implementation guide.</Alert>}
            <pre className="max-h-[28rem] overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(fhir.data.resource, null, 2)}</pre>
          </div>
        )}
      </Modal>
      <Modal open={modal === 'decision'} onClose={() => setModal(null)} title="Record SHA decision">
        <div className="space-y-3">
          <p className="muted text-sm">Use when the decision was received outside a callback (for example on the SHA provider portal). The entry is audited.</p>
          <Field label="Decision"><Select value={dec.status} onChange={(e) => setDec({ ...dec, status: e.target.value })}><option value="approved">Approved</option><option value="pending">Pending</option><option value="intervention_required">Intervention required</option><option value="rejected">Rejected</option></Select></Field>
          {dec.status === 'approved' && <Field label="Approved amount" hint={`Claimed ${money(tx.amounts?.claimed)}`}><Input type="number" min={0} value={dec.approvedAmount} onChange={(e) => setDec({ ...dec, approvedAmount: e.target.value })} /></Field>}
          <Field label="SHA reference (optional)"><Input value={dec.externalReference} onChange={(e) => setDec({ ...dec, externalReference: e.target.value })} /></Field>
          <Field label="Note"><Textarea value={dec.note} onChange={(e) => setDec({ ...dec, note: e.target.value })} /></Field>
          <ErrorText error={act.error} />
          <Button loading={act.isPending} disabled={dec.note.trim().length < 5} onClick={() => act.mutate({ path: 'decision', body: { status: dec.status, note: dec.note, approvedAmount: dec.status === 'approved' && dec.approvedAmount !== '' ? Number(dec.approvedAmount) : undefined, externalReference: dec.externalReference || undefined } })}>Save decision</Button>
        </div>
      </Modal>
      <Modal open={modal === 'intervention'} onClose={() => setModal(null)} title="Respond to SHA intervention">
        <div className="space-y-3">
          {tx.decisionNote && <Alert tone="amber" title="Query">{tx.decisionNote}</Alert>}
          <Field label="Response"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <p className="muted text-xs">Attach supporting documents in the Supporting documents panel before responding.</p>
          <ErrorText error={act.error} />
          <Button loading={act.isPending} disabled={text.trim().length < 5} onClick={() => act.mutate({ path: 'intervention-response', body: { response: text } })}>Send response</Button>
        </div>
      </Modal>
      <Modal open={modal === 'reopen' || modal === 'cancel'} onClose={() => setModal(null)} title={modal === 'cancel' ? 'Cancel draft' : 'Reopen for correction'}>
        <div className="space-y-3">
          <Field label="Reason"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <ErrorText error={act.error} />
          <Button variant={modal === 'cancel' ? 'danger' : 'primary'} loading={act.isPending} disabled={text.trim().length < 5} onClick={() => act.mutate({ path: modal === 'cancel' ? 'cancel' : 'resubmit', body: { reason: text } })}>{modal === 'cancel' ? 'Cancel draft' : 'Reopen'}</Button>
        </div>
      </Modal>
      <Modal open={modal === 'reconcile'} onClose={() => setModal(null)} title="Record SHA remittance">
        <div className="space-y-3">
          <p className="muted text-sm">Posts an SHA payment to the claim invoice. The remittance reference makes this idempotent.</p>
          <Field label="Amount received" hint={`Outstanding ${money(outstanding)}`}><Input type="number" min={1} value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></Field>
          <Field label="Remittance / payment reference"><Input value={rec.reference} onChange={(e) => setRec({ ...rec, reference: e.target.value })} /></Field>
          <Field label="Note"><Input value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} /></Field>
          <ErrorText error={act.error} />
          <Button loading={act.isPending} disabled={!(Number(rec.amount) > 0) || rec.reference.trim().length < 3} onClick={() => act.mutate({ path: 'reconcile', body: { amount: Number(rec.amount), reference: rec.reference, note: rec.note || undefined } })}>Record remittance</Button>
        </div>
      </Modal>
    </>
  );
}
