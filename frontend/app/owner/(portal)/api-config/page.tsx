'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Op { key: string; group: string; description: string; method: string; path: string | null; documented: boolean; documentationRef?: string; verification?: 'documented' | 'spec_unverified' | 'owner_verified' }
interface Contract { provider: string; contractVersion: string; documentationURL: string; lastVerified?: string; verifiedBy?: string; supportedOperations: Op[] }

export default function ApiConfigPage() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<'dha' | 'sha' | 'slade360'>('sha');
  const q = useQuery({ queryKey: ['contract', provider], queryFn: async () => (await ownerApi<Contract>(`/contracts/${provider}`)).data });
  const [edits, setEdits] = useState<Record<string, { path: string; method: string }>>({});
  const [version, setVersion] = useState('');
  useEffect(() => {
    setEdits({});
    setVersion(q.data?.contractVersion ?? '');
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => ownerApi(`/contracts/${provider}`, { method: 'PATCH', body: { contractVersion: version, operations: Object.entries(edits).map(([key, v]) => ({ key, method: v.method, path: v.path.trim() === '' ? null : v.path.trim() })) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract', provider] }),
  });
  const groups = [...new Set(q.data?.supportedOperations.map((o) => o.group))];
  return (
    <>
      <PageHeader title="API Contract Configuration" crumbs={['Owner', 'API Config']} actions={<Select value={provider} onChange={(e) => setProvider(e.target.value as 'dha' | 'sha' | 'slade360')}><option value="sha">SHA (HIE eClaims)</option><option value="dha">DHA HIE</option><option value="slade360">Slade360 / HealthCloud</option></Select>} />
      <div className="mb-4">
        {provider === 'slade360' ? (
          <Alert tone="amber" title="Source of truth: Slade360 / HealthCloud API reference">
            Only enter endpoints exactly as published in the HealthCloud API reference ({q.data?.documentationURL ?? 'https://web.healthcloud.sh/api-reference'}). Operations without a path are declared but disabled. Base and token URLs are configured per facility under Admin → Integrations; they are never assumed for production.
          </Alert>
        ) : (
          <Alert tone="amber" title="Source of truth: official DHA HIE documentation">
            Only enter endpoints exactly as published in the current HIE API catalog ({q.data?.documentationURL ?? 'https://hie-docs.dha.go.ke/'}). Operations without a path are declared but disabled — AfeySync never guesses government endpoints. Changes take effect immediately without code changes.
          </Alert>
        )}
      </div>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error || save.error} />
      {q.data && (
        <Card
          title={`Contract ${q.data.contractVersion}`}
          actions={<span className="muted text-xs">Last verified {fmtDateTime(q.data.lastVerified)} {q.data.verifiedBy && `by ${q.data.verifiedBy}`}</span>}
        >
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="New contract version"><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2026-09-24" /></Field>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(edits).length || !version}>Save {Object.keys(edits).length} change(s)</Button>
          </div>
          {groups.map((g) => (
            <div key={g} className="mb-5">
              <p className="label">{g}</p>
              <Table head={['Operation', 'Method', 'Path', 'State']}>
                {q.data.supportedOperations.filter((o) => o.group === g).map((o) => {
                  const e = edits[o.key];
                  return (
                    <tr key={o.key}>
                      <Td className="text-sm">{o.description}<span className="muted block font-mono text-xs">{o.key}</span></Td>
                      <Td>
                        <Select className="w-24" value={e?.method ?? o.method} onChange={(ev) => setEdits({ ...edits, [o.key]: { path: e?.path ?? o.path ?? '', method: ev.target.value } })}>
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                        </Select>
                      </Td>
                      <Td><Input className="min-w-60 font-mono text-xs" value={e?.path ?? o.path ?? ''} placeholder="not configured" onChange={(ev) => setEdits({ ...edits, [o.key]: { method: e?.method ?? o.method, path: ev.target.value } })} /></Td>
                      <Td>{!o.path ? <Badge>disabled</Badge> : o.verification === 'spec_unverified' ? <span title="Path taken from AfeySync's eClaims integration specification. Verify it against the live hie-docs.dha.go.ke catalog and save to mark it verified."><Badge tone="amber">verify against docs</Badge></span> : o.verification === 'owner_verified' ? <Badge tone="green">verified by owner</Badge> : <Badge tone="green">documented</Badge>}{o.documentationRef?.startsWith('https://') && <a className="ml-1 text-xs text-brand-600" href={o.documentationRef} target="_blank" rel="noreferrer">docs</a>}</Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
