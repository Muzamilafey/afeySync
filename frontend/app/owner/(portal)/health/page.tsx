'use client';

import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Card, ErrorText, Loading, PageHeader, StatusDot, statusTone } from '@/components/ui';

interface H {
  api: string;
  mongodb: { status: string; pingMs: number; tenantConnectionsCached: number };
  queue: { status: string; queued: number; dead: number };
  integrations: Array<{ provider: string; status: string; latencyMs?: number }>;
  resources: { cpuPct: number; ramPct: number; storagePct: number | null; uptimeSeconds: number; node: string };
}
const LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA', mpesa: 'M-Pesa', africastalking: "SMS (Africa's Talking)", talksasa: 'SMS (Talksasa)', smtp: 'SMTP' };

function Meter({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{label}</span><span>{pct == null ? 'n/a' : `${pct}%`}</span></div>
      <div className="h-2 rounded-full bg-[var(--surface-2)]"><div className={`h-full rounded-full ${pct != null && pct > 85 ? 'bg-red-500' : pct != null && pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct ?? 0}%` }} /></div>
    </div>
  );
}

export default function HealthPage() {
  const q = useQuery({ queryKey: ['owner-health'], queryFn: async () => (await ownerApi<H>('/system/health')).data, refetchInterval: 20_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const h = q.data;
  const rows: Array<[string, string, string?]> = [
    ['API', h.api],
    ['MongoDB', h.mongodb.status, `${h.mongodb.pingMs} ms · ${h.mongodb.tenantConnectionsCached} tenant DBs open`],
    ['Queue', h.queue.status, `${h.queue.queued} queued · ${h.queue.dead} dead`],
    ...h.integrations.map((i) => [LABEL[i.provider] ?? i.provider, i.status, i.latencyMs != null ? `${i.latencyMs} ms` : undefined] as [string, string, string?]),
  ];
  return (
    <>
      <PageHeader title="Platform Health" crumbs={['Owner', 'System Health']} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Services">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map(([n, s, d]) => (
              <li key={n} className="flex items-center justify-between py-2.5">
                <span className="font-medium">{n}</span>
                <span className="flex items-center gap-3"><span className="muted text-xs">{d}</span><StatusDot tone={statusTone(s)} label={s.toUpperCase()} /></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Resources">
          <div className="space-y-4">
            <Meter label="CPU" pct={h.resources.cpuPct} />
            <Meter label="RAM" pct={h.resources.ramPct} />
            <Meter label="Storage" pct={h.resources.storagePct} />
            <p className="muted text-xs">Uptime {Math.floor(h.resources.uptimeSeconds / 3600)}h · Node {h.resources.node}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
