'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { ownerApi } from '@/services/api';
import { Button, Card, ErrorText, Loading, PageHeader, Stat, StatusDot, statusTone, Table, Td } from '@/components/ui';
import { ago } from '@/lib/utils';

interface Dash {
  tenants: { total: number; active: number; suspended: number; online: number };
  branches: number;
  users: number;
  issues: number;
  integrations: Array<{ provider: string; enabled: boolean; status: string; lastSuccessAt?: string; lastFailureAt?: string }>;
  apiUsage: { calls24h: number; failures24h: number };
  subscriptions: Array<{ plan: string; count: number; revenue: number }>;
  deadJobs: number;
  uptimeSeconds: number;
}

const LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA HIE', mpesa: 'M-Pesa', africastalking: "Africa's Talking", talksasa: 'Talksasa', smtp: 'SMTP' };
const COLORS = ['#0fa588', '#0284c7', '#7c3aed', '#f59e0b', '#ef4444'];

export default function OwnerDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['owner-dash'], queryFn: async () => (await ownerApi<Dash>('/dashboard')).data, refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorText error={error} />;
  return (
    <>
      <PageHeader title="Platform Overview" subtitle="Platform-level metrics only. No patient clinical data is shown here." actions={<Link href="/owner/facilities/new"><Button>+ New facility</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tenants" value={data.tenants.total} />
        <Stat label="Active" value={data.tenants.active} tone="green" hint={`${data.tenants.suspended} suspended`} />
        <Stat label="Online (15 min)" value={data.tenants.online} tone="blue" />
        <Stat label="Issues" value={data.issues} tone={data.issues ? 'red' : 'green'} hint={`${data.apiUsage.failures24h} integration failures / 24h · ${data.deadJobs} dead jobs`} />
        <Stat label="Branches" value={data.branches} />
        <Stat label="Users" value={data.users} />
        <Stat label="API calls (24h)" value={data.apiUsage.calls24h.toLocaleString()} />
        <Stat label="API uptime" value={`${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Integration health">
          <Table head={['Provider', 'Status', 'Last success', 'Last failure']}>
            {data.integrations.map((i) => (
              <tr key={i.provider}>
                <Td className="font-medium">{LABEL[i.provider]}</Td>
                <Td><StatusDot tone={i.enabled ? statusTone(i.status) : 'gray'} label={i.enabled ? i.status.toUpperCase() : 'DISABLED'} /></Td>
                <Td>{ago(i.lastSuccessAt)}</Td>
                <Td>{ago(i.lastFailureAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Subscriptions">
          {data.subscriptions.length === 0 ? <p className="muted text-sm">No subscriptions yet.</p> : (
            <div className="grid items-center gap-4 sm:grid-cols-2">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.subscriptions} dataKey="count" nameKey="plan" innerRadius={45} outerRadius={75}>
                      {data.subscriptions.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 text-sm">
                {data.subscriptions.map((s, i) => (
                  <li key={s.plan} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{s.plan}</span>
                    <span>{s.count} · KES {s.revenue.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
