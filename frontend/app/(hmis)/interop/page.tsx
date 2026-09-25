'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Input, KV, Loading, PageHeader, Stat, StatusDot, statusTone, Table, Tabs, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { FhirOutbox } from '@/features/fhir/FhirOutbox';
import { TerminologyBrowser } from '@/features/dha/TerminologyBrowser';

interface Health { provider: string; enabled: boolean; message?: string; lastSuccess?: string; lastFailure?: string; latencyMs?: number; requestsToday: number; failuresToday: number }
interface CbEvent { _id: string; provider: string; eventType?: string; externalReference?: string; status?: string; verificationMethod?: string; processing: { state: string; error?: string }; createdAt: string }
interface DhaStatus { enabled: boolean; message?: string; token: string; lastApiCall?: { createdAt: string; status: string; operation: string }; contract?: { version: string; lastVerified?: string; documentationURL: string; configuredOperations: number; totalOperations: number } }

const LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA HIE', mpesa: 'M-Pesa', africastalking: 'SMS', smtp: 'SMTP' };

export default function InteropPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'callbacks' | 'dha' | 'fhir' | 'terminology'>('overview');
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [hmac, setHmac] = useState('');
  const health = useQuery({ queryKey: ['int-health'], queryFn: async () => (await api<Health[]>('/admin/system-health/integrations')).data, enabled: can('admin.integrations') });
  const events = useQuery({ queryKey: ['cb-events'], queryFn: async () => (await api<CbEvent[]>('/sha/callback-events')).data, enabled: can('sha.view') });
  const endpoints = useQuery({ queryKey: ['cb-endpoints'], queryFn: async () => (await api<Array<{ _id: string; provider: string; active: boolean; lastEventAt?: string; createdAt: string; hmacHeader?: string }>>('/sha/callback-endpoints')).data, enabled: can('admin.integrations') });
  const dha = useQuery({ queryKey: ['dha-status'], queryFn: async () => (await api<DhaStatus>('/dha/status')).data, enabled: can('dha.view') });
  const create = useMutation({
    mutationFn: async () => (await api<{ url: string }>('/sha/callback-endpoints', { method: 'POST', body: hmac ? { hmacHeader: 'x-signature', hmacSecret: hmac } : {} })).data,
    onSuccess: (d) => {
      setNewUrl(d.url);
      setHmac('');
      qc.invalidateQueries({ queryKey: ['cb-endpoints'] });
    },
  });
  const ev = events.data ?? [];

  return (
    <>
      <PageHeader title="Interoperability Center" crumbs={['SHA / DHA', 'Interoperability']} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'callbacks', label: 'Callbacks' }, { key: 'dha', label: 'DHA' }, ...(can('dha.fhir') ? [{ key: 'fhir' as const, label: 'FHIR outbox' }] : []), ...(can('dha.terminology') ? [{ key: 'terminology' as const, label: 'Terminology' }] : [])]} />
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Callback events" value={ev.length} />
            <Stat label="Processed" value={ev.filter((e) => e.processing.state === 'processed').length} tone="green" />
            <Stat label="Unmatched" value={ev.filter((e) => e.processing.state === 'unmatched').length} tone="amber" />
            <Stat label="Failed" value={ev.filter((e) => e.processing.state === 'failed').length} tone="red" />
          </div>
          {health.data && (
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              {health.data.map((h) => (
                <Card key={h.provider} title={LABEL[h.provider] ?? h.provider}>
                  <StatusDot tone={h.enabled ? (h.failuresToday > 0 && h.failuresToday >= h.requestsToday ? 'red' : 'green') : 'gray'} label={h.enabled ? 'Enabled' : 'Disabled'} />
                  <dl className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between"><dt className="muted">Last success</dt><dd>{fmtDateTime(h.lastSuccess)}</dd></div>
                    <div className="flex justify-between"><dt className="muted">Last failure</dt><dd>{fmtDateTime(h.lastFailure)}</dd></div>
                    <div className="flex justify-between"><dt className="muted">Latency</dt><dd>{h.latencyMs != null ? `${h.latencyMs} ms` : '—'}</dd></div>
                    <div className="flex justify-between"><dt className="muted">Requests today</dt><dd>{h.requestsToday}</dd></div>
                    <div className="flex justify-between"><dt className="muted">Failures today</dt><dd>{h.failuresToday}</dd></div>
                  </dl>
                  {!h.enabled && h.message && <p className="muted mt-2 text-xs">{h.message}</p>}
                </Card>
              ))}
            </div>
          )}
          <Card title="Recent callback activity">
            <Table head={['Received', 'Provider', 'Reference', 'External status', 'Verified', 'Processing']} empty={ev.length === 0}>
              {ev.slice(0, 15).map((e) => (
                <tr key={e._id}>
                  <Td>{fmtDateTime(e.createdAt)}</Td>
                  <Td className="uppercase">{e.provider}</Td>
                  <Td className="font-mono text-xs">{e.externalReference ?? '—'}</Td>
                  <Td>{e.status ?? '—'}</Td>
                  <Td>{e.verificationMethod}</Td>
                  <Td><Badge tone={statusTone(e.processing.state)}>{e.processing.state}</Badge></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
      {tab === 'callbacks' && (
        <div className="space-y-5">
          <Alert tone="blue" title="Status callbacks">The HIE pushes claim, preauthorization and authorization status updates to AfeySync instead of relying on polling. Each endpoint has a secret URL; optionally require an HMAC-SHA256 signature. Events are verified, deduplicated, matched to the record, audited and notified.</Alert>
          {can('admin.integrations') && (
            <Card title="Callback endpoints">
              <div className="mb-4 flex flex-wrap gap-2">
                <Input className="max-w-80" value={hmac} onChange={(e) => setHmac(e.target.value)} placeholder="Optional HMAC shared secret (min 16 chars)" type="password" />
                <Button onClick={() => create.mutate()} loading={create.isPending}>Create endpoint</Button>
              </div>
              <ErrorText error={create.error} />
              {newUrl && (
                <Alert tone="green" title="Copy this callback URL now — it is shown only once">
                  <code className="break-all">{newUrl}</code>
                </Alert>
              )}
              <Table head={['Provider', 'Created', 'Signature', 'Last event', 'Active']} empty={(endpoints.data ?? []).length === 0}>
                {endpoints.data?.map((e) => (
                  <tr key={e._id}><Td className="uppercase">{e.provider}</Td><Td>{fmtDateTime(e.createdAt)}</Td><Td>{e.hmacHeader ? `HMAC (${e.hmacHeader})` : 'URL token'}</Td><Td>{fmtDateTime(e.lastEventAt)}</Td><Td><Badge tone={e.active ? 'green' : 'gray'}>{e.active ? 'active' : 'inactive'}</Badge></Td></tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
      {tab === 'fhir' && <FhirOutbox />}
      {tab === 'terminology' && <TerminologyBrowser />}
      {tab === 'dha' && (
        <Card title="DHA HIE">
          {dha.isLoading && <Loading />}
          <ErrorText error={dha.error} />
          {dha.data && (
            <div className="space-y-4">
              <KV
                items={[
                  ['Connection', <StatusDot key="c" tone={dha.data.enabled ? 'green' : 'gray'} label={dha.data.enabled ? 'ENABLED' : 'DISABLED'} />],
                  ['Token', dha.data.token],
                  ['Last API call', dha.data.lastApiCall ? `${fmtDateTime(dha.data.lastApiCall.createdAt)} · ${dha.data.lastApiCall.operation} · ${dha.data.lastApiCall.status}` : 'none'],
                  ['Contract version', dha.data.contract?.version],
                  ['Operations configured', dha.data.contract ? `${dha.data.contract.configuredOperations} / ${dha.data.contract.totalOperations}` : '—'],
                  ['Contract last verified', fmtDateTime(dha.data.contract?.lastVerified)],
                ]}
              />
              {dha.data.message && <Alert tone="amber">{dha.data.message}</Alert>}
              <p className="muted text-xs">Technical integration, UAT testing and DHA/SHA certification are separate milestones. A connected integration does not imply certification.</p>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
