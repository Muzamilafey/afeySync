'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { DhaConnectionCard } from '@/features/sha/DhaConnectionCard';
import { ShaCallbacksCard } from '@/features/sha/ShaCallbacksCard';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, PageHeader, StatusDot } from '@/components/ui';
import type { IntegrationFlag } from '@/types/api';
import { prefillBaseUrl, SettingFields, switchEnvironment, type SettingField } from '@/features/integrations/SettingFields';

interface PublicConfig {
  provider: string;
  label: string;
  enabled: boolean;
  environment: string;
  environments: string[];
  defaultBaseUrls?: Record<string, string>;
  settings: Record<string, string>;
  settingFields: SettingField[];
  secretFields: Array<{ key: string; label: string; required?: boolean; configured: boolean; hint?: string }>;
  useTenantConfig: boolean;
  exists?: boolean;
}

const LABEL: Record<string, string> = { sha: 'SHA', dha: 'DHA', mpesa: 'M-Pesa (Daraja)', payhero: 'Pay Hero (M-Pesa)', africastalking: "SMS (Africa's Talking)", talksasa: 'SMS (Talksasa)', smtp: 'Email' };

function FacilityConfig({ cfg, selfService = false }: { cfg: PublicConfig; selfService?: boolean }) {
  const qc = useQueryClient();
  const [settings, setSettings] = useState(() => prefillBaseUrl(cfg.settings, cfg.settingFields, cfg.defaultBaseUrls, cfg.environment));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [useTenant, setUseTenant] = useState(selfService || cfg.useTenantConfig);
  const [environment, setEnvironment] = useState(cfg.environment);
  const save = useMutation({
    mutationFn: () => api(`/admin/integrations/${cfg.provider}`, { method: 'PUT', body: { settings, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)), useTenantConfig: useTenant, environment, enabled: useTenant } }),
    onSuccess: () => { setSecrets({}); qc.invalidateQueries({ queryKey: ['admin-integrations'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const turnOff = useMutation({
    mutationFn: () => api(`/admin/integrations/${cfg.provider}`, { method: 'PUT', body: { enabled: false } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-integrations'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const test = useMutation({ mutationFn: async () => (await api<{ ok: boolean; latencyMs: number; paysInto?: string; error?: { message: string } }>(`/admin/integrations/${cfg.provider}/test`, { method: 'POST' })).data });
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      {selfService ? (
        <p className="muted text-sm">Your facility&rsquo;s own account. Payments go straight to it; AfeySync never holds the money.</p>
      ) : (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={!useTenant} onChange={() => setUseTenant(false)} /> Use Platform Configuration</label>
          <label className="flex items-center gap-2"><input type="radio" checked={useTenant} onChange={() => setUseTenant(true)} /> Use Facility Configuration</label>
        </div>
      )}
      {useTenant && (
        <div className="grid gap-3 sm:grid-cols-2">
          {cfg.environments.length > 1 && <Field label="Environment"><select className="field" value={environment} onChange={(e) => { setEnvironment(e.target.value); setSettings(switchEnvironment(settings, cfg.settingFields, cfg.defaultBaseUrls, e.target.value)); }}>{cfg.environments.map((e) => <option key={e}>{e}</option>)}</select></Field>}
          <SettingFields fields={cfg.settingFields} values={settings} onChange={setSettings} />
          {cfg.secretFields.map((f) => <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.configured ? `Configured ${f.hint ?? ''} — leave blank to keep` : 'Not set'}><Input type="password" autoComplete="new-password" value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} /></Field>)}
        </div>
      )}
      <ErrorText error={save.error || test.error || turnOff.error} />
      {save.isSuccess && !save.isPending && <Alert tone="green">Saved{selfService ? ' and switched on' : ''}. Use “Test connection” to check it.</Alert>}
      {test.data && <Alert tone={test.data.ok ? 'green' : 'red'}>{test.data.ok ? `Connected (${test.data.latencyMs} ms)${test.data.paysInto ? `. Prompts pay into ${test.data.paysInto}.` : ''}` : test.data.error?.message}</Alert>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending}>{selfService && !cfg.enabled ? 'Save & switch on' : 'Save'}</Button>
        {useTenant && cfg.exists !== false && <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending}>Test connection</Button>}
        {selfService && cfg.enabled && <Button variant="ghost" onClick={() => { if (confirm(`Switch off ${cfg.label}? Prompts will stop using it.`)) turnOff.mutate(); }} loading={turnOff.isPending}>Switch off</Button>}
      </div>
    </div>
  );
}

export default function FacilityIntegrationsPage() {
  const q = useQuery({ queryKey: ['admin-integrations'], queryFn: async () => (await api<{ status: Record<string, IntegrationFlag>; facilityConfigs: Record<string, PublicConfig> }>('/admin/integrations')).data });
  return (
    <>
      <PageHeader title="Integrations" crumbs={['Admin', 'Integrations']} subtitle="M-Pesa and Pay Hero are your facility's own accounts: set them up here. Other connections are managed by AfeySync unless facility credentials are permitted." />
      <div className="mb-5 grid max-w-6xl gap-4 xl:grid-cols-2"><DhaConnectionCard /><ShaCallbacksCard mode="facility" /></div>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data && Object.entries(q.data.status).map(([k, s]) => (
          <Card key={k} title={LABEL[k] ?? k} actions={<StatusDot tone={s.enabled ? 'green' : 'gray'} label={s.enabled ? 'Enabled' : 'Disabled'} />}>
            {s.message && <p className="muted text-sm">{s.message}</p>}
            {s.enabled && !s.tenantCredentialsAllowed && <p className="muted text-sm">Using AfeySync platform configuration.</p>}
            {k === 'payhero' && <p className="muted mt-1 text-sm">A second way to send M-Pesa prompts, through your Pay Hero account (paybill, till or bank). Choose below whether it sends every prompt or only stands in when M-Pesa (Daraja) is not set up.</p>}
            {s.tenantCredentialsAllowed && q.data.facilityConfigs[k] && <FacilityConfig cfg={q.data.facilityConfigs[k]} selfService={!!s.selfService} />}
          </Card>
        ))}
      </div>
    </>
  );
}
