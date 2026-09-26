'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { ShaCallbacksCard } from '@/features/sha/ShaCallbacksCard';
import { Card, ErrorText, Loading, PageHeader, StatusDot, statusTone } from '@/components/ui';
import { ago } from '@/lib/utils';
import type { OwnerIntegration } from './types';

export default function OwnerIntegrations() {
  const q = useQuery({ queryKey: ['owner-integrations'], queryFn: async () => (await ownerApi<OwnerIntegration[]>('/integrations')).data });
  return (
    <>
      <PageHeader title="Integration Settings" crumbs={['Owner', 'Platform Configuration', 'Integrations']} subtitle="Platform credentials are encrypted at rest (AES-256-GCM) and never sent to browsers. Priority: facility credential (if permitted) → platform credential → disabled." />
      {q.isLoading && <Loading />}
      <ErrorText error={q.error} />
      {q.data?.some((i) => i.provider === 'sha' && i.enabled) && <div className="mb-5 max-w-3xl"><ShaCallbacksCard mode="owner" /></div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((i) => (
          <Link key={i.provider} href={`/owner/integrations/${i.provider}`}>
            <Card title={i.label} className="h-full transition hover:ring-2 hover:ring-brand-500/40" actions={<StatusDot tone={i.enabled ? statusTone(i.health.status) : 'gray'} label={i.enabled ? 'Enabled' : 'Disabled'} />}>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="muted">Environment</dt><dd className="uppercase">{i.environment}</dd></div>
                <div className="flex justify-between"><dt className="muted">Credentials</dt><dd>{i.secretFields.filter((s) => s.configured).length}/{i.secretFields.length} set</dd></div>
                <div className="flex justify-between"><dt className="muted">Health</dt><dd>{i.health.status}</dd></div>
                <div className="flex justify-between"><dt className="muted">Last test</dt><dd>{ago(i.health.lastTestAt)}</dd></div>
                <div className="flex justify-between"><dt className="muted">Facility credentials</dt><dd>{i.allowTenantCredentials ? 'Allowed' : 'Not allowed'}</dd></div>
              </dl>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
