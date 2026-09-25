'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { DocumentRow } from '@/features/documents/DocumentsPanel';
import { CLAIM_TONE, maskMember, type InsClaim, type Remittance } from '@/features/insurance/types';

const ATTACHMENT_TYPES = ['CLAIM_FORM', 'PREAUTH_FORM', 'PRESCRIPTION', 'LAB_ORDER', 'IMAGING_ORDER', 'OTHER'];
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg'];

export default function InsuranceClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ins-claim', id], queryFn: async () => (await api<InsClaim>(`/insurance/claims/${id}`)).data });
  const c = q.data;
  const docs = useQuery({ queryKey: ['documents', c?.patientId?._id], queryFn: async () => (await api<DocumentRow[]>('/documents', { query: { patientId: c!.patientId._id } })).data, enabled: !!c?.patientId });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ins-claim', id] });
  const [copay, setCopay] = useState('0');
  const [att, setAtt] = useState({ documentId: '', attachmentType: 'CLAIM_FORM', target: 'claim' });
  const [cn, setCn] = useState({ amount: '', reason: '' });
  const invoice = useMutation({ mutationFn: () => api(`/insurance/claims/${id}/invoice`, { method: 'POST', body: { copay: Number(copay) || 0 } }), onSuccess: refresh });
  const attach = useMutation({ mutationFn: () => api(`/insurance/claims/${id}/attachments`, { method: 'POST', body: att }), onSuccess: () => { setAtt((a) => ({ ...a, documentId: '' })); refresh(); } });
  const credit = useMutation({ mutationFn: () => api(`/insurance/claims/${id}/credit-notes`, { method: 'POST', body: { amount: Number(cn.amount), reason: cn.reason } }), onSuccess: () => { setCn({ amount: '', reason: '' }); refresh(); } });
  const status = useMutation({ mutationFn: () => api(`/insurance/claims/${id}/refresh-status`, { method: 'POST' }), onSuccess: refresh });
  const remit = useMutation({ mutationFn: () => api(`/insurance/claims/${id}/remittance`, { method: 'POST' }), onSuccess: refresh });
  const reconcile = useMutation({ mutationFn: (remittanceId: string) => api(`/insurance/claims/${id}/reconcile`, { method: 'POST', body: { remittanceId } }), onSuccess: refresh });

  if (q.isLoading) return <Loading />;
  if (!c) return <ErrorText error={q.error} />;
  const manage = can('insurance.manage');
  const visitRef = c.visitId && typeof c.visitId === 'object' ? c.visitId : null;
  const rems = (c.remittances ?? []) as Remittance[];
  const eligibleDocs = docs.data?.filter((d) => ALLOWED.includes(d.mimeType)) ?? [];
  return (
    <>
      <PageHeader
        title={`Claim ${c.reference}`}
        crumbs={['Insurance', 'Claims', c.reference]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={CLAIM_TONE[c.status] ?? 'gray'}>{c.status.replace('_', ' ')}</Badge>{c.externalStatus && <span className="text-sm">Payer status: {c.externalStatus}</span>}</span>}
        actions={<div className="flex gap-2">{c.sladeClaimId && <Button variant="outline" size="sm" onClick={() => status.mutate()} loading={status.isPending}>Refresh status</Button>}{manage && c.sladeClaimId && <Button variant="outline" size="sm" onClick={() => remit.mutate()} loading={remit.isPending}>Fetch remittance</Button>}</div>}
      />
      <ErrorText error={status.error ?? remit.error} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Claim">
            <KV items={[
              ['Patient', c.patientId ? <Link className="text-brand-600" href={`/patients/${c.patientId._id}`}>{c.patientId.firstName} {c.patientId.lastName} · {c.patientId.patientNumber}</Link> : '—'],
              ['Payer', `${c.payer?.name ?? '—'}${c.payer?.sladeCode ? ` (${c.payer.sladeCode})` : ''}`],
              ['Member', c.memberNumber ? maskMember(c.memberNumber) : '—'],
              ['Scheme', c.scheme?.name],
              ['Visit', visitRef ? <Link className="text-brand-600" href={`/insurance/visits/${visitRef._id}`}>{visitRef.reference}{visitRef.visitNumber ? ` · ${visitRef.visitNumber}` : ''}</Link> : '—'],
              ['Payer claim ID', c.sladeClaimId ?? '—'],
              ['Payer invoice ID', c.sladeInvoiceId ?? '—'],
              ['Invoice', c.invoiceNumber ?? '—'],
              ['Submitted', c.submittedAt ? fmtDateTime(c.submittedAt) : '—'],
            ]} />
            <div className="mt-3">
              <p className="mb-1 text-sm font-medium">Diagnoses (ICD-10)</p>
              <ul className="text-sm">{c.diagnoses.map((d) => <li key={d.code}><span className="font-mono">{d.code}</span> {d.description}{d.primary && <Badge className="ml-2" tone="blue">primary</Badge>}</li>)}</ul>
            </div>
          </Card>

          <Card title="Invoice">
            {c.amounts ? (
              <KV items={[['Gross', money(c.amounts.gross)], ['Copay (patient)', money(c.amounts.copay)], ['Insurance amount', money(c.amounts.insurance)], ['Net', money(c.amounts.net)]]} />
            ) : manage && c.sladeClaimId ? (
              <div className="space-y-3">
                <p className="text-sm">Amounts and line items are taken from the facility invoice on the server. Enter only the copay collected from the patient.</p>
                <Field label="Copay (KES)" className="max-w-xs"><Input type="number" min={0} value={copay} onChange={(e) => setCopay(e.target.value)} /></Field>
                <ErrorText error={invoice.error} />
                <Button onClick={() => invoice.mutate()} loading={invoice.isPending}>Send invoice to payer</Button>
              </div>
            ) : <p className="muted text-sm">The claim must be created at the payer first.</p>}
          </Card>

          <Card title="Attachments">
            {c.attachments.length ? (
              <Table head={['File', 'Type', 'Attached to', 'Payer ID', 'Uploaded']}>{c.attachments.map((a, i) => <tr key={i}><Td>{a.fileName ?? '—'}</Td><Td>{a.attachmentType}</Td><Td className="capitalize">{a.target}</Td><Td className="text-xs">{a.attachmentId ?? '—'}</Td><Td className="text-xs">{fmtDateTime(a.uploadedAt)}</Td></tr>)}</Table>
            ) : <p className="muted text-sm">No attachments yet.</p>}
            {manage && c.sladeClaimId && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Patient document" hint="PDF, PNG or JPEG from the patient's documents">
                  <Select value={att.documentId} onChange={(e) => setAtt({ ...att, documentId: e.target.value })}><option value="">Select…</option>{eligibleDocs.map((d) => <option key={d._id} value={d._id}>{d.title} · {d.fileName}</option>)}</Select>
                </Field>
                <Field label="Type"><Select value={att.attachmentType} onChange={(e) => setAtt({ ...att, attachmentType: e.target.value })}>{ATTACHMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label="Attach to"><Select value={att.target} onChange={(e) => setAtt({ ...att, target: e.target.value })}><option value="claim">Claim</option><option value="invoice" disabled={!c.sladeInvoiceId}>Invoice</option></Select></Field>
                <div className="sm:col-span-3"><ErrorText error={attach.error} /><Button size="sm" onClick={() => attach.mutate()} loading={attach.isPending} disabled={!att.documentId}>Upload attachment</Button></div>
              </div>
            )}
          </Card>

          {c.sladeInvoiceId && (
            <Card title="Credit notes">
              {c.creditNotes.length ? <Table head={['Amount', 'Reason', 'Authorized by', 'Date']}>{c.creditNotes.map((n, i) => <tr key={i}><Td>{money(n.amount)}</Td><Td>{n.reason}</Td><Td>{n.authorizedByName}</Td><Td className="text-xs">{fmtDateTime(n.at)}</Td></tr>)}</Table> : <p className="muted text-sm">None.</p>}
              {manage && (
                <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
                  <Field label="Amount (KES)"><Input type="number" min={1} value={cn.amount} onChange={(e) => setCn({ ...cn, amount: e.target.value })} /></Field>
                  <Field label="Reason"><Textarea rows={2} value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })} /></Field>
                  <div className="sm:col-span-2"><ErrorText error={credit.error} /><Button size="sm" variant="outline" onClick={() => credit.mutate()} loading={credit.isPending} disabled={!(Number(cn.amount) > 0) || cn.reason.trim().length < 5}>Issue credit note</Button></div>
                </div>
              )}
            </Card>
          )}

          <Card title="Remittances & reconciliation">
            {c.reconciliation && (
              <div className="mb-3"><Alert tone={c.reconciliation.status === 'matched' ? 'green' : 'amber'} title={c.reconciliation.status === 'matched' ? 'Reconciled' : 'Reconciled with variance'}>
                Submitted {money(c.reconciliation.submitted)} · approved {money(c.reconciliation.approved)} · paid {money(c.reconciliation.paid)} · copay {money(c.reconciliation.copay)} · variance {money(c.reconciliation.variance)}
              </Alert></div>
            )}
            {rems.length ? (
              <Table head={['Remittance', 'Date', 'Submitted', 'Approved', 'Paid', 'Adjustment', 'Status', '']}>
                {rems.map((r) => (
                  <tr key={r._id}>
                    <Td className="font-mono text-xs">{r.externalId}</Td><Td className="text-xs">{r.date ? fmtDateTime(r.date) : '—'}</Td>
                    <Td>{money(r.amountSubmitted ?? 0)}</Td><Td>{money(r.amountApproved ?? 0)}</Td><Td>{money(r.amountPaid ?? 0)}</Td><Td>{money(r.adjustment ?? 0)}</Td>
                    <Td className="text-xs">{r.externalStatus ?? '—'}</Td>
                    <Td>{r.reconciledAt ? <Badge tone="green">reconciled</Badge> : manage && <Button size="sm" onClick={() => reconcile.mutate(r._id)} loading={reconcile.isPending && reconcile.variables === r._id} disabled={!(r.amountPaid && r.amountPaid > 0)}>Reconcile</Button>}</Td>
                  </tr>
                ))}
              </Table>
            ) : <p className="muted text-sm">No remittance received yet. Approval alone never marks a claim as paid.</p>}
            <ErrorText error={reconcile.error} />
          </Card>
        </div>
        <Card title="Status history">
          <ol className="space-y-2 text-sm">{[...c.statusHistory].reverse().map((h, i) => <li key={i} className="border-l-2 border-[var(--border)] pl-3"><Badge tone={CLAIM_TONE[h.status] ?? 'gray'}>{h.status.replace('_', ' ')}</Badge> <span className="muted text-xs">{fmtDateTime(h.at)} · {h.source}</span>{h.note && <p className="text-xs">{h.note}</p>}</li>)}</ol>
        </Card>
      </div>
    </>
  );
}
