'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Badge, ErrorText, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { CLAIM_TONE, maskMember, type InsClaim } from '@/features/insurance/types';

const STATUSES = Object.keys(CLAIM_TONE);

export default function InsuranceClaimsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const claims = useQuery({ queryKey: ['ins-claims', status, q], queryFn: async () => (await api<InsClaim[]>('/insurance/claims', { query: { status: status || undefined, q: q.trim() || undefined } })).data });
  return (
    <>
      <PageHeader title="Insurance claims" crumbs={['Insurance', 'Claims']} subtitle="Private insurance claims. A claim is marked paid only after a remittance is reconciled." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder="Claim reference or member number" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-[220px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
      </div>
      {claims.isLoading ? <Loading /> : claims.error ? <ErrorText error={claims.error} /> : (
        <Table head={['Reference', 'Patient', 'Payer', 'Member', 'Invoice', 'Insurance amount', 'Status', 'Payer status', 'Updated']} empty={!claims.data?.length}>
          {claims.data?.map((c) => (
            <tr key={c._id}>
              <Td><Link className="font-medium text-brand-600" href={`/insurance/claims/${c._id}`}>{c.reference}</Link></Td>
              <Td>{c.patientId ? `${c.patientId.firstName} ${c.patientId.lastName}` : '—'}<div className="muted text-xs">{c.patientId?.patientNumber}</div></Td>
              <Td>{c.payer?.name ?? '—'}</Td>
              <Td>{c.memberNumber ? maskMember(c.memberNumber) : '—'}</Td>
              <Td>{c.invoiceNumber ?? '—'}</Td>
              <Td>{c.amounts ? money(c.amounts.insurance) : '—'}</Td>
              <Td><Badge tone={CLAIM_TONE[c.status] ?? 'gray'}>{c.status.replace('_', ' ')}</Badge></Td>
              <Td className="text-xs">{c.externalStatus ?? '—'}</Td>
              <Td className="text-xs">{fmtDateTime(c.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
