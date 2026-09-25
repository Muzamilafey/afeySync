'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, PageHeader, Select } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { Coverage, InsVisit } from '@/features/insurance/types';

interface Inv { _id: string; invoiceNumber: string; status: string; totals: { net: number; balance: number } }

export default function InsuranceVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ins-visit', id], queryFn: async () => (await api<InsVisit>(`/insurance/visits/${id}`)).data });
  const v = q.data;
  const patientId = v && typeof v.patientId === 'object' ? v.patientId._id : (v?.patientId as string | undefined);
  const invoices = useQuery({ queryKey: ['patient-invoices', patientId], queryFn: async () => (await api<Inv[]>('/billing/invoices', { query: { patientId, limit: 20 } })).data, enabled: !!patientId });
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['ins-visit', id] });
  const validate = useMutation({ mutationFn: () => api(`/insurance/visits/${id}/validate-authorization`, { method: 'POST' }), onSuccess: refresh });
  const reserve = useMutation({ mutationFn: () => api(`/insurance/visits/${id}/reserve`, { method: 'POST', body: { invoiceId, amount: Number(amount) } }), onSuccess: refresh });
  const claim = useMutation({
    mutationFn: async () => (await api<{ _id: string }>(`/insurance/visits/${id}/claim`, { method: 'POST', body: { invoiceId } })).data,
    onSuccess: (c) => router.push(`/insurance/claims/${c._id}`),
  });
  if (q.isLoading) return <Loading />;
  if (!v) return <ErrorText error={q.error} />;
  const cov = typeof v.coverageId === 'object' ? (v.coverageId as Coverage) : null;
  const ben = cov?.benefits?.find((b) => b.code === v.benefit?.code) ?? cov?.benefits?.[0];
  const inv = invoices.data?.find((i) => i._id === invoiceId);
  const unmapped = claim.error instanceof ApiError && claim.error.code === 'DIAGNOSIS_NOT_MAPPED' ? (claim.error.details as string[]) : null;
  return (
    <>
      <PageHeader title={`Insurance visit ${v.reference}`} crumbs={['Insurance', 'Visits', v.reference]} subtitle={<span className="flex gap-2"><Badge tone="blue">{v.status.replace(/_/g, ' ')}</Badge><span className="text-sm">{v.payer}</span></span>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Authorization">
            <KV items={[['Member', v.memberNumber], ['Scheme', v.scheme?.name], ['Benefit', v.benefit?.code], ['Authentication', v.authenticationMethod], ['Authorization', v.authorizationId], ['Authorization status', v.authorizationStatus], ['EDI auth GUID', v.ediAuthGuid], ['Visit number', v.visitNumber], ['Visit start', v.visitStart ? fmtDateTime(v.visitStart) : '—'], ['Token', v.authorizationTokenReference ?? '—']]} />
            {can('insurance.eligibility') && <div className="mt-3"><Button size="sm" variant="outline" onClick={() => validate.mutate()} loading={validate.isPending}>Validate authorization</Button></div>}
            <ErrorText error={validate.error} />
          </Card>
          {can('insurance.manage') && (
            <Card title="Benefit reservation">
              {v.reservation?.status === 'reserved' ? (
                <Alert tone="green">Reserved {money(v.reservation.amount)} against invoice {v.reservation.invoiceNumber} (reservation {v.reservation.reservationId ?? '—'}).</Alert>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <KV items={[['Available', ben?.balance !== undefined ? money(ben.balance) : '—'], ['Estimated treatment', inv ? money(inv.totals.net) : '—']]} />
                  <div />
                  <Field label="Invoice"><Select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const i = invoices.data?.find((x) => x._id === e.target.value); if (i) setAmount(String(i.totals.net)); }}><option value="">Select…</option>{invoices.data?.filter((i) => i.status !== 'void').map((i) => <option key={i._id} value={i._id}>{i.invoiceNumber} · {money(i.totals.net)}</option>)}</Select></Field>
                  <Field label="Amount to reserve (KES)"><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                  <div className="sm:col-span-2"><Button onClick={() => reserve.mutate()} loading={reserve.isPending} disabled={!invoiceId || !(Number(amount) > 0)}>Reserve benefit</Button><ErrorText error={reserve.error} /></div>
                </div>
              )}
            </Card>
          )}
          {can('insurance.manage') && (
            <Card title="Claim">
              {v.claimId ? <Link className="text-brand-600" href={`/insurance/claims/${v.claimId}`}>Open claim</Link> : (
                <div className="space-y-3">
                  <p className="text-sm">Creates the claim at the payer with the visit details and the ICD-10 diagnoses from finalized consultations.</p>
                  <Field label="Invoice"><Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}><option value="">Select…</option>{invoices.data?.filter((i) => i.status !== 'void').map((i) => <option key={i._id} value={i._id}>{i.invoiceNumber} · {money(i.totals.net)}</option>)}</Select></Field>
                  {unmapped ? <Alert tone="amber" title="ICD-10 mapping required">These diagnoses have no documented ICD-10 mapping: {unmapped.join(', ')}. Add them under Insurance → Payers → Code mappings, or record ICD-10 codes.</Alert> : <ErrorText error={claim.error} />}
                  <Button onClick={() => claim.mutate()} loading={claim.isPending} disabled={!invoiceId}>Create claim</Button>
                </div>
              )}
            </Card>
          )}
        </div>
        <Card title="History"><ol className="space-y-2 text-sm">{[...v.history].reverse().map((h, i) => <li key={i} className="border-l-2 border-[var(--border)] pl-3"><span className="font-medium capitalize">{h.action.replace(/_/g, ' ')}</span> <span className="muted text-xs">{fmtDateTime(h.at)} · {h.byName}</span>{h.note && <p className="text-xs">{h.note}</p>}</li>)}</ol></Card>
      </div>
    </>
  );
}
