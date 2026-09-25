'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, KV, Loading, Modal, Select, Stat, Table, Td, type Tone } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Entry { _id: string; resourceType: string; localResource: string; localId: string; version: number; status: string; attempts?: number; lastError?: string; externalId?: string; sentAt?: string; createdAt: string; validation?: { valid: boolean; errors: string[] }; payload?: unknown }

const TONE: Record<string, Tone> = { queued: 'blue', sent: 'green', failed: 'red', blocked: 'amber' };

/** FHIR R4 outbox: clinical records queued for the DHA Shared Health Record. */
export function FhirOutbox() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['fhir-outbox', status], queryFn: async () => api<Entry[]>('/fhir/outbox', { query: { status, limit: 100 } }) });
  const detail = useQuery({ queryKey: ['fhir-outbox-entry', sel], queryFn: async () => (await api<Entry>(`/fhir/outbox/${sel}`)).data, enabled: !!sel });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/fhir/outbox/${id}/retry`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fhir-outbox'] }); qc.invalidateQueries({ queryKey: ['fhir-outbox-entry'] }); },
  });
  const counts = (list.data?.meta?.counts ?? {}) as Record<string, number>;
  const e = detail.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Queued" value={counts.queued ?? 0} tone="blue" />
        <Stat label="Sent" value={counts.sent ?? 0} tone="green" />
        <Stat label="Blocked" value={counts.blocked ?? 0} tone="amber" hint="Operation not configured / rejected" />
        <Stat label="Failed" value={counts.failed ?? 0} tone="red" />
      </div>
      {(counts.blocked ?? 0) > 0 && <Alert tone="amber">Blocked entries could not be sent because the DHA Shared Health Record operation is not configured or SHA/DHA rejected the payload. They are retained and can be retried once resolved.</Alert>}
      <Card title="FHIR outbox" actions={<Select value={status} onChange={(ev) => setStatus(ev.target.value)} className="w-36"><option value="">All</option>{Object.keys(TONE).map((s) => <option key={s} value={s}>{s}</option>)}</Select>}>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error ?? retry.error} />
        <Table head={['Created', 'Source', 'Version', 'Valid', 'Status', 'Attempts', 'Last error', '']} empty={(list.data?.data ?? []).length === 0}>
          {list.data?.data.map((x) => (
            <tr key={x._id}>
              <Td className="text-xs">{fmtDateTime(x.createdAt)}</Td>
              <Td className="capitalize">{x.localResource}<span className="muted block font-mono text-xs">{x.localId.slice(-8)}</span></Td>
              <Td>v{x.version}</Td>
              <Td>{x.validation?.valid ? <Badge tone="green">valid</Badge> : <Badge tone="red">invalid</Badge>}</Td>
              <Td><Badge tone={TONE[x.status] ?? 'gray'}>{x.status}</Badge></Td>
              <Td>{x.attempts ?? 0}</Td>
              <Td className="max-w-72 truncate text-xs" >{x.lastError ?? '—'}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setSel(x._id)}>View</Button>
                {['failed', 'blocked'].includes(x.status) && <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === x._id} onClick={() => retry.mutate(x._id)}>Retry</Button>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} title="Outbox entry" wide>
        {detail.isLoading ? <Loading /> : e && (
          <div className="space-y-3">
            <KV items={[['Resource', `${e.resourceType} (${e.localResource} v${e.version})`], ['Status', e.status], ['External ID', e.externalId ?? '—'], ['Sent', fmtDateTime(e.sentAt)], ['Last error', e.lastError ?? '—']]} />
            {e.validation && !e.validation.valid && <Alert tone="red" title="Validation errors"><ul className="list-disc pl-4 text-xs">{e.validation.errors.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
            <pre className="max-h-[28rem] overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
