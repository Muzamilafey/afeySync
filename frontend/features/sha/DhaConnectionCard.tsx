'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, KV } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Conn { enabled: boolean; status: 'NOT_CONFIGURED' | 'PENDING' | 'CONNECTED' | 'ERROR'; environment?: string; frCode?: string | null; frCodeType?: string; credentialsSource?: string; lastSuccessfulConnectionAt?: string | null; lastError?: string | null; callbacksEnabled?: boolean; message?: string }
const TONE = { NOT_CONFIGURED: 'gray', PENDING: 'amber', CONNECTED: 'green', ERROR: 'red' } as const;

/** This facility's DHA HIE / SHA connection. Credentials are never returned to the browser. */
export function DhaConnectionCard() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dha-connection'], queryFn: async () => (await api<Conn>('/sha/connection')).data });
  const test = useMutation({ mutationFn: () => api('/sha/connection/test', { method: 'POST' }), onSettled: () => qc.invalidateQueries({ queryKey: ['dha-connection'] }) });
  const c = q.data;
  return (
    <Card title={<span className="flex items-center gap-2">DHA HIE / SHA connection {c && <Badge tone={TONE[c.status]}>{c.status.replace('_', ' ')}</Badge>}</span>} actions={can('admin.integrations') && c?.enabled && <Button size="sm" variant="outline" onClick={() => test.mutate()} loading={test.isPending}>Test connection</Button>}>
      <ErrorText error={q.error ?? test.error} />
      {c && (
        <>
          <KV items={[['Environment', c.environment?.toUpperCase() ?? '—'], ['Facility FR code', c.frCode ?? 'not set'], ['FR code type', c.frCodeType ?? '—'], ['Credentials', c.credentialsSource === 'tenant' ? 'Facility credentials' : c.credentialsSource ? 'AfeySync platform service account' : '—'], ['Last successful connection', fmtDateTime(c.lastSuccessfulConnectionAt)], ['Status callbacks', c.callbacksEnabled ? 'Enabled' : 'Disabled'], ['Last error', c.lastError ?? '—']]} />
          {!c.frCode && c.enabled && <div className="mt-3"><Alert tone="amber">The facility Registry (FR) code is not set. AfeySync platform administration sets it on the facility record; it is sent as X-Facility-Id on SHA requests.</Alert></div>}
          {c.message && <div className="mt-3"><Alert tone="blue">{c.message}</Alert></div>}
          <p className="muted mt-3 text-xs">UAT and production are separate configurations. Connecting does not mean SHA certification.</p>
        </>
      )}
    </Card>
  );
}
