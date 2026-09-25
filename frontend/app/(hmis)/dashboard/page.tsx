'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api } from '@/services/api';
import { useMe } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Loading, PageHeader, Stat, StatusDot, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import type { IntegrationFlag } from '@/types/api';

interface Dash {
  branch: { name: string } | null;
  patients?: { total: number; today: number; trend: Array<{ date: string; count: number }>; recent: Array<{ _id: string; patientNumber: string; firstName: string; lastName: string; gender: string; createdAt: string; sha?: { status: string } }> };
  sha?: { eligibilityToday: Record<string, number>; transactions: Array<{ kind: string; status: string; count: number }> };
  admin?: { activeUsers: number; branches: number; beds: number };
  integrations?: Record<string, IntegrationFlag>;
}

const LABELS: Record<string, string> = { sha: 'SHA', dha: 'DHA HIE', mpesa: 'M-Pesa', africastalking: "SMS (Africa's Talking)", talksasa: 'SMS (Talksasa)', smtp: 'Email', slade360: 'Private insurance' };
/** First name for the greeting, skipping honorifics such as "Dr.". */
const firstName = (name = '') => name.split(/\s+/).find((w) => !/^(dr|mr|mrs|ms|miss|prof|sr|rev)\.?$/i.test(w)) ?? '';

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api<Dash>('/dashboard')).data, refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorText error={error} />;
  const claims = (data.sha?.transactions ?? []).filter((t) => t.kind === 'claim');
  const sumStatus = (s: string) => claims.filter((c) => c.status === s).reduce((a, c) => a + c.count, 0);
  // Fill the last 14 days so the chart has no gaps.
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + 3 * 3600_000 - (13 - i) * 86400_000).toISOString().slice(0, 10); // Africa/Nairobi
    return { date: d.slice(5), count: data.patients?.trend.find((t) => t.date === d)?.count ?? 0 };
  });

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName(me?.user.name)}`}
        subtitle={`${me?.tenant.name} · ${data.branch?.name ?? 'All branches'}`}
        actions={me?.permissions.includes('patients.create') && <Link href="/frontdesk"><Button><UserPlus className="h-4 w-4" /> Register patient</Button></Link>}
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {data.patients && <Stat label="Patients registered today" value={data.patients.today} tone="blue" icon={<UserPlus className="h-4 w-4 text-sky-600" />} />}
        {data.patients && <Stat label="Total patients" value={data.patients.total.toLocaleString()} icon={<Users className="muted h-4 w-4" />} />}
        {data.sha && <Stat label="SHA eligible today" value={data.sha.eligibilityToday.eligible ?? 0} tone="green" hint={`${data.sha.eligibilityToday.not_eligible ?? 0} not eligible`} icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />} />}
        {data.sha && <Stat label="SHA claims in draft" value={sumStatus('draft')} tone="amber" hint={`${sumStatus('intervention_required')} need intervention`} />}
        {data.admin && <Stat label="Active staff" value={data.admin.activeUsers} icon={<Users className="muted h-4 w-4" />} />}
        {data.admin && <Stat label="Branches / beds" value={`${data.admin.branches} / ${data.admin.beds}`} icon={<Building2 className="muted h-4 w-4" />} />}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        {data.patients && (
          <Card title="Registrations — last 14 days">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={30} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="count" name="Patients" fill="#0fa588" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
        {data.integrations && (
          <Card title="Integrations">
            <ul className="space-y-3">
              {Object.entries(data.integrations).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{LABELS[k] ?? k}</span>
                  <StatusDot tone={v.enabled ? 'green' : 'gray'} label={v.enabled ? 'Enabled' : 'Disabled'} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {data.patients && (
        <div className="mt-5">
          <Card title="Recent registrations" actions={<Link href="/patients" className="text-sm text-brand-600">View all</Link>}>
            <Table head={['Patient', 'Number', 'CR ID', 'SHA', 'Registered']} empty={data.patients.recent.length === 0}>
              {data.patients.recent.map((p) => (
                <tr key={p._id}>
                  <Td><Link href={`/patients/${p._id}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link></Td>
                  <Td className="font-mono text-xs">{p.patientNumber}</Td>
                  <Td className="font-mono text-xs">{(p as { clientRegistryId?: string }).clientRegistryId ?? '—'}</Td>
                  <Td><Badge tone={statusTone(p.sha?.status)}>{(p.sha?.status ?? 'unknown').replace('_', ' ')}</Badge></Td>
                  <Td>{fmtDateTime(p.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
