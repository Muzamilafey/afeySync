'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Realm } from '@/stores/session';
import { Alert, Button, Card, ErrorText, Field, Loading, Select } from '@/components/ui';
import { METHOD_LABEL, type MfaMethod } from './types';

interface Policy { mode: 'optional' | 'admins' | 'all'; methods: MfaMethod[] }

/** Organisation-wide two-step verification policy (facility admin or platform owner). */
export function MfaPolicyCard({ realm }: { realm: Realm }) {
  const path = realm === 'owner' ? '/owner/security/mfa-policy' : '/admin/security/mfa-policy';
  const supported: MfaMethod[] = realm === 'owner' ? ['totp', 'email'] : ['totp', 'email', 'sms'];
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mfa-policy', realm], queryFn: async () => (await api<Policy>(path, { realm })).data });
  const [p, setP] = useState<Policy | null>(null);
  useEffect(() => { if (q.data) setP(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api(path, { method: 'PUT', body: p, realm }), onSuccess: () => qc.invalidateQueries({ queryKey: ['mfa-policy', realm] }) });
  if (q.isLoading || !p) return <Card title="Two-step verification policy"><Loading /></Card>;
  const toggle = (m: MfaMethod) => setP({ ...p, methods: p.methods.includes(m) ? p.methods.filter((x) => x !== m) : [...p.methods, m] });
  return (
    <Card title="Two-step verification policy">
      <div className="space-y-4">
        <Field label="Who must use two-step verification">
          <Select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value as Policy['mode'] })}>
            <option value="optional">Optional — users choose</option>
            <option value="admins">{realm === 'owner' ? 'Owners and platform admins' : 'Anyone with administrator permissions'}</option>
            <option value="all">Everyone</option>
          </Select>
        </Field>
        <div>
          <p className="label">Allowed methods</p>
          <div className="flex flex-wrap gap-4">
            {supported.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.methods.includes(m)} onChange={() => toggle(m)} /> {METHOD_LABEL[m]}</label>
            ))}
          </div>
        </div>
        {p.mode !== 'optional' && <Alert tone="blue">Users without a method will be asked to set one up at their next sign-in and cannot use anything else until they do.</Alert>}
        {p.methods.includes('sms') && <p className="muted text-xs">SMS codes use the SMS provider configured for your facility and incur SMS charges. The authenticator app is the most secure option.</p>}
        <ErrorText error={save.error} />
        {save.isSuccess && <Alert tone="green">Policy saved.</Alert>}
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!p.methods.length}>Save policy</Button>
      </div>
    </Card>
  );
}
