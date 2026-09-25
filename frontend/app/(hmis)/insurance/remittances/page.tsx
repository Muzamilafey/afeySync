'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, ErrorText, Loading, PageHeader, Table, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { Remittance } from '@/features/insurance/types';

export default function RemittancesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ins-remittances'], queryFn: async () => (await api<Remittance[]>('/insurance/remittances')).data });
  const sync = useMutation({ mutationFn: async () => (await api<{ synced: number }>('/insurance/remittances/sync', { method: 'POST' })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['ins-remittances'] }) });
  return (
    <>
      <PageHeader title="Remittances" crumbs={['Insurance', 'Remittances']} subtitle="Payment advice received from payers through Slade360. Reconcile from the claim to post the payment." actions={can('insurance.manage') && <Button onClick={() => sync.mutate()} loading={sync.isPending}>Sync from Slade360</Button>} />
      {sync.data && <div className="mb-3"><Alert tone="green">{sync.data.synced} remittance record(s) synced.</Alert></div>}
      <ErrorText error={sync.error} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : (
        <Table head={['Remittance', 'Date', 'Payer', 'Claim', 'Invoice', 'Submitted', 'Approved', 'Paid', 'Adjustment', 'Payer status', 'Reconciliation']} empty={!q.data?.length}>
          {q.data?.map((r) => {
            const claim = r.claimId && typeof r.claimId === 'object' ? r.claimId : null;
            return (
              <tr key={r._id}>
                <Td className="font-mono text-xs">{r.externalId}</Td>
                <Td className="text-xs">{r.date ? fmtDateTime(r.date) : '—'}</Td>
                <Td>{r.payerName ?? '—'}</Td>
                <Td>{claim ? <Link className="text-brand-600" href={`/insurance/claims/${claim._id}`}>{claim.reference}</Link> : <span className="muted text-xs">Unmatched{r.sladeClaimId ? ` (${r.sladeClaimId})` : ''}</span>}</Td>
                <Td>{r.invoiceNumber ?? claim?.invoiceNumber ?? '—'}</Td>
                <Td>{money(r.amountSubmitted ?? 0)}</Td>
                <Td>{money(r.amountApproved ?? 0)}</Td>
                <Td>{money(r.amountPaid ?? 0)}</Td>
                <Td>{money(r.adjustment ?? 0)}</Td>
                <Td className="text-xs">{r.externalStatus ?? '—'}</Td>
                <Td>{r.reconciledAt ? <Badge tone="green">reconciled</Badge> : claim ? <Link className="text-sm text-brand-600" href={`/insurance/claims/${claim._id}`}>Reconcile →</Link> : <Badge tone="amber">no claim match</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
