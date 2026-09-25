'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Badge, Button, Card, ErrorText, Loading, PageHeader, Stat, Table, Td } from '@/components/ui';
import { money } from '@/lib/utils';
import { CLAIM_TONE } from '@/features/insurance/types';

interface Dash { activeInsuredPatients: number; eligibilityChecks30d: number; authorizedVisits: number; pendingPreauthorizations: number; claimsSubmitted: number; claimsProcessing: number; claimsApproved: number; claimsRejected: number; amountSubmitted: number; amountApproved: number; amountPaid: number; outstandingReceivables: number; byStatus: Record<string, number>; byPayer: Record<string, { claims: number; submitted: number; paid: number }>; monthlyRevenue: Record<string, number> }

function Bars({ data, fmt = (n: number) => String(n) }: { data: Array<[string, number]>; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  if (!data.length) return <p className="muted text-sm">No data yet.</p>;
  return <ul className="space-y-2 text-sm">{data.map(([k, v]) => <li key={k}><div className="flex justify-between"><span>{k}</span><span className="font-medium">{fmt(v)}</span></div><div className="mt-1 h-1.5 rounded bg-[var(--surface-2)]"><div className="h-1.5 rounded bg-brand-500" style={{ width: `${(v / max) * 100}%` }} /></div></li>)}</ul>;
}

export default function InsuranceDashboard() {
  const q = useQuery({ queryKey: ['ins-dashboard'], queryFn: async () => (await api<Dash>('/insurance/dashboard')).data });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHeader title="Insurance" subtitle="Private insurance through Slade360 and other integrations (SHA has its own workflow)" crumbs={['Insurance']} actions={<div className="flex gap-2"><Link href="/insurance/claims"><Button variant="outline">Claims</Button></Link><Link href="/insurance/remittances"><Button variant="outline">Remittances</Button></Link></div>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Active insured patients" value={d.activeInsuredPatients} />
        <Stat label="Eligibility checks (30d)" value={d.eligibilityChecks30d} />
        <Stat label="Authorized visits" value={d.authorizedVisits} tone="blue" />
        <Stat label="Pending SHA preauths" value={d.pendingPreauthorizations} tone="amber" />
        <Stat label="Claims submitted" value={d.claimsSubmitted} tone="blue" />
        <Stat label="Processing" value={d.claimsProcessing} tone="amber" />
        <Stat label="Approved" value={d.claimsApproved} tone="green" />
        <Stat label="Rejected" value={d.claimsRejected} tone="red" />
        <Stat label="Amount submitted" value={money(d.amountSubmitted)} />
        <Stat label="Amount approved" value={money(d.amountApproved)} tone="green" />
        <Stat label="Amount paid" value={money(d.amountPaid)} tone="green" />
        <Stat label="Outstanding receivables" value={money(d.outstandingReceivables)} tone="amber" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Claims by insurer"><Bars data={Object.entries(d.byPayer).map(([k, v]) => [k, v.claims])} /></Card>
        <Card title="Claims by status"><ul className="space-y-1 text-sm">{Object.entries(d.byStatus).map(([k, v]) => <li key={k} className="flex justify-between"><Badge tone={CLAIM_TONE[k] ?? 'gray'}>{k.replace('_', ' ')}</Badge><span>{v}</span></li>)}</ul></Card>
        <Card title="Receivables by payer">
          <Table head={['Payer', 'Submitted', 'Paid', 'Outstanding']}>{Object.entries(d.byPayer).map(([k, v]) => <tr key={k}><Td>{k}</Td><Td>{money(v.submitted)}</Td><Td>{money(v.paid)}</Td><Td>{money(v.submitted - v.paid)}</Td></tr>)}</Table>
        </Card>
      </div>
      <Card title="Monthly insurance revenue (paid)" className="mt-5"><Bars data={Object.entries(d.monthlyRevenue).sort()} fmt={money} /></Card>
    </>
  );
}
