'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { DhaConnectionCard } from '@/features/sha/DhaConnectionCard';
import { ShaCallbacksCard } from '@/features/sha/ShaCallbacksCard';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, PageHeader, StatusDot } from '@/components/ui';
import type { IntegrationFlag } from '@/types/api';

interface PublicConfig {
  provider: string;
  label: string;
  enabled: boolean;
  environment: string;
  environments: string[];
  settings: Record<string, string>;
  settingFields: Array<{ key: string; label: string }>;
  secretFields: Array<{ key: string; label: string; configured: boolean; hint?: string }>;
  useTenantConfig: boolean;
}

const LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA', mpesa: 'M-Pesa', africastalking: "SMS (Africa's Talking)", talksasa: 'SMS (Talksasa)', smtp: 'Email' };

function FacilityConfig({ cfg }: { cfg: PublicConfig }) {
  const qc = useQueryClient();
  const [settings, setSettings] = useState(cfg.settings);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [useTenant, setUseTenant] = useState(cfg.useTenantConfig);
  const [environment, setEnvironment] = useState(cfg.environment);
  const save = useMutation({
    mutationFn: () => api(`/admin/integrations/${cfg.provider}`, { method: 'PUT', body: { settings, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)), useTenantConfig: useTenant, environment, enabled: useTenant } }),
    onSuccess: () => { setSecrets({}); qc.invalidateQueries({ queryKey: ['admin-integrations'] }); },
  });
  const test = useMutation({ mutationFn: async () => (await api<{ ok: boolean; latencyMs: number; error?: { message: string } }>(`/admin/integrations/${cfg.provider}/test`, { method: 'POST' })).data });
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={!useTenant} onChange={() => setUseTenant(false)} /> Use Platform Configuration</label>
        <label className="flex items-center gap-2"><input type="radio" checked={useTenant} onChange={() => setUseTenant(true)} /> Use Facility Configuration</label>
      </div>
      {useTenant && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Environment"><select className="field" value={environment} onChange={(e) => setEnvironment(e.target.value)}>{cfg.environments.map((e) => <option key={e}>{e}</option>)}</select></Field>
          {cfg.settingFields.map((f) => <Field key={f.key} label={f.label}><Input value={settings[f.key] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} /></Field>)}
          {cfg.secretFields.map((f) => <Field key={f.key} label={f.label} hint={f.configured ? `Configured ${f.hint ?? ''} — leave blank to keep` : 'Not set'}><Input type="password" autoComplete="off" value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} /></Field>)}
        </div>
      )}
      <ErrorText error={save.error || test.error} />
      {test.data && <Alert tone={test.data.ok ? 'green' : 'red'}>{test.data.ok ? `Connected (${test.data.latencyMs} ms)` : test.data.error?.message}</Alert>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        {useTenant && <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending}>Test connection</Button>}
      </div>
    </div>
  );
}

export default function FacilityIntegrationsPage() {
  const q = useQuery({ queryKey: ['admin-integrations'], queryFn: async () => (await api<{ status: Record<string, IntegrationFlag>; facilityConfigs: Record<string, PublicConfig> }>('/admin/integrations')).data });
  return (
    <>
      <PageHeader title="Integrations" crumbs={['Admin', 'Integrations']} subtitle="Provider credentials are managed by AfeySync platform administration unless facility credentials are explicitly permitted." />
      <div className="mb-5 grid max-w-6xl gap-4 xl:grid-cols-2"><DhaConnectionCard /><ShaCallbacksCard mode="facility" /></div>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data && Object.entries(q.data.status).map(([k, s]) => (
          <Card key={k} title={LABEL[k] ?? k} actions={<StatusDot tone={s.enabled ? 'green' : 'gray'} label={s.enabled ? 'Enabled' : 'Disabled'} />}>
            {s.message && <p className="muted text-sm">{s.message}</p>}
            {s.enabled && !s.tenantCredentialsAllowed && <p className="muted text-sm">Using AfeySync platform configuration.</p>}
            {s.tenantCredentialsAllowed && q.data.facilityConfigs[k] && <FacilityConfig cfg={q.data.facilityConfigs[k]} />}
          </Card>
        ))}
      </div>
    </>
  );
}
