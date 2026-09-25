'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, PageHeader, Select, StatusDot, statusTone } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import type { OwnerIntegration } from '../types';

interface TestResult { ok: boolean; latencyMs: number; token?: string; facility?: string; registry?: string; eligibility?: string; terminology?: string; messageId?: string; error?: { code: string; message: string } }

const HIE_TESTS: Array<[string, string]> = [['auth', 'Test Authentication'], ['registry', 'Test Registry'], ['eligibility', 'Test Eligibility'], ['terminology', 'Test Terminology']];

export default function ProviderConfig({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-integrations'], queryFn: async () => (await ownerApi<OwnerIntegration[]>('/integrations')).data });
  const cfg = q.data?.find((i) => i.provider === provider);
  const [environment, setEnvironment] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [allowTenant, setAllowTenant] = useState(false);
  const [sample, setSample] = useState({ type: 'National ID', number: '' });
  const [testTo, setTestTo] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  useEffect(() => {
    if (cfg) {
      setEnvironment(cfg.environment);
      setSettings(cfg.settings);
      setAllowTenant(cfg.allowTenantCredentials);
    }
  }, [cfg]);

  const save = useMutation({
    mutationFn: (extra: { enabled?: boolean } = {}) => ownerApi(`/integrations/${provider}`, { method: 'PUT', body: { environment, settings, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== '')), allowTenantCredentials: allowTenant, ...extra } }),
    onSuccess: () => {
      setSecrets({});
      qc.invalidateQueries({ queryKey: ['owner-integrations'] });
    },
  });
  const test = useMutation({
    mutationFn: async (kind: string) => (await ownerApi<TestResult>(`/integrations/${provider}/test`, { method: 'POST', body: { kind, sample: sample.number ? sample : undefined, to: testTo || undefined } })).data,
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['owner-integrations'] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (!cfg) return <ErrorText error={q.error ?? { message: 'Unknown provider' }} />;
  const isHie = provider === 'sha' || provider === 'dha';

  return (
    <>
      <PageHeader title={`${cfg.label} Configuration`} crumbs={['Owner', 'Integrations', cfg.label]} actions={<Link href="/owner/integrations"><Button variant="outline">Back</Button></Link>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card title="Configuration" actions={<StatusDot tone={cfg.enabled ? statusTone(cfg.health.status) : 'gray'} label={cfg.enabled ? 'Enabled' : 'Disabled'} />}>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({}); }}>
            <Field label="Environment"><Select value={environment} onChange={(e) => setEnvironment(e.target.value)}>{cfg.environments.map((env) => <option key={env} value={env}>{env.toUpperCase()}</option>)}</Select></Field>
            {cfg.settingFields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.default ? `Default: ${f.default}` : undefined}>
                <Input value={settings[f.key] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />
              </Field>
            ))}
            {cfg.secretFields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.configured ? `Stored encrypted ${f.hint ?? ''} · updated ${fmtDateTime(f.updatedAt)} — leave blank to keep, enter a value to rotate` : 'Not configured'}>
                <Input type="password" autoComplete="new-password" placeholder={f.configured ? '••••••••••••' : ''} value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} />
              </Field>
            ))}
            {cfg.platformOnly ? (
              <p className="muted col-span-full text-sm">This is your own collection account. Facilities never see or use these credentials.</p>
            ) : (
              <label className="col-span-full flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allowTenant} onChange={(e) => setAllowTenant(e.target.checked)} /> Allow facilities to use their own credentials for this provider
              </label>
            )}
            <div className="col-span-full space-y-3">
              <ErrorText error={save.error} />
              {save.isSuccess && <Alert tone="green">Saved. Credentials are encrypted and not retrievable.</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={save.isPending}>Save</Button>
                {cfg.enabled ? <Button type="button" variant="danger" onClick={() => save.mutate({ enabled: false })}>Disable globally</Button> : <Button type="button" variant="secondary" onClick={() => save.mutate({ enabled: true })}>Enable</Button>}
              </div>
            </div>
          </form>
        </Card>
        <div className="space-y-5">
          <Card title="Connection">
            <KV items={[['Status', <Badge key="s" tone={statusTone(cfg.health.status)}>{cfg.health.status.toUpperCase()}</Badge>], ['Last test', fmtDateTime(cfg.health.lastTestAt)], ['Last success', fmtDateTime(cfg.health.lastSuccessAt)], ['Last failure', fmtDateTime(cfg.health.lastFailureAt)], ['Latency', cfg.health.lastLatencyMs != null ? `${cfg.health.lastLatencyMs} ms` : '—']]} />
            {cfg.health.lastError && <p className="mt-2 text-xs text-red-600">{cfg.health.lastError}</p>}
          </Card>
          <Card title="Tests">
            <div className="space-y-3">
              {isHie && (
                <div className="grid grid-cols-2 gap-2">
                  <Select value={sample.type} onChange={(e) => setSample({ ...sample, type: e.target.value })}>{['National ID', 'ClientRegistry ID', 'Birth Certificate', 'Alien ID', 'Refugee ID'].map((t) => <option key={t}>{t}</option>)}</Select>
                  <Input placeholder="Sample ID number" value={sample.number} onChange={(e) => setSample({ ...sample, number: e.target.value })} />
                </div>
              )}
              {provider === 'smtp' && <Input type="email" placeholder="Send test email to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />}
              <div className="flex flex-wrap gap-2">
                {isHie
                  ? HIE_TESTS.map(([k, l]) => <Button key={k} size="sm" variant="outline" onClick={() => test.mutate(k)} loading={test.isPending && test.variables === k}>{l}</Button>)
                  : <Button size="sm" variant="outline" onClick={() => test.mutate(provider === 'smtp' && testTo ? 'email' : 'auth')} loading={test.isPending}>{provider === 'smtp' ? (testTo ? 'SEND TEST EMAIL' : 'Verify SMTP') : 'TEST CONNECTION'}</Button>}
              </div>
              <ErrorText error={test.error} />
              {result && (
                <Alert tone={result.ok ? 'green' : 'red'} title={result.ok ? `Success (${result.latencyMs} ms)` : result.error?.code}>
                  {result.ok ? Object.entries(result).filter(([k]) => !['ok', 'latencyMs'].includes(k)).map(([k, v]) => <p key={k}>{k}: {String(v)}</p>) : result.error?.message}
                </Alert>
              )}
              {isHie && <p className="muted text-xs">Callback endpoints are created per facility (Interoperability → Callbacks). Passing these tests does not constitute DHA/SHA certification.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
