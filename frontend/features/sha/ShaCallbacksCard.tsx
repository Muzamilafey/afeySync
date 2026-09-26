'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api, ApiError, ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Loading, Table, Td } from '@/components/ui';

interface State { entityType: 'claim' | 'preauth' | 'authorization'; registered: boolean; ours: boolean; isActive: boolean; baseUrl?: string }
const LABEL: Record<State['entityType'], string> = { claim: 'Claim status changes', preauth: 'Preauthorization status changes', authorization: 'Authorization changes and fingerprint results' };

/**
 * Registers AfeySync with the HIE Status Callbacks API: without it SHA cannot push claim, preauthorization and
 * authorization updates, and minors fingerprint enrollment and match results are never delivered.
 */
export function ShaCallbacksCard({ mode }: { mode: 'facility' | 'owner' }) {
  const call = mode === 'owner' ? ownerApi : api;
  const base = mode === 'owner' ? '/sha-callbacks' : '/sha/hie-callbacks';
  const q = useQuery({ queryKey: ['sha-hie-callbacks', mode], queryFn: async () => (await call<{ states: State[]; receiverBase: string }>(base)).data, retry: false });
  const register = useMutation({ mutationFn: () => call(`${base}/register`, { method: 'POST' }), onSuccess: () => q.refetch() });
  const active = useMutation({ mutationFn: (a: boolean) => call(`${base}/active`, { method: 'POST', body: { active: a } }), onSuccess: () => q.refetch() });
  const managed = q.error instanceof ApiError && q.error.code === 'SHA_CALLBACKS_PLATFORM_MANAGED';
  const states = q.data?.states ?? [];
  const allOk = states.length > 0 && states.every((s) => s.registered && s.ours && s.isActive);
  return (
    <Card title="SHA status callbacks" actions={<Radio className="h-4 w-4 text-brand-600" />}>
      <p className="muted mb-3 text-sm">Where SHA sends status changes for {mode === 'owner' ? 'facilities on AfeySync\'s SHA connection' : 'this facility'}. Minors fingerprint enrollment, verification and match results also arrive here, so this must be set up before children can consent by fingerprint.</p>
      {q.isLoading ? <Loading /> : managed ? (
        <Alert tone="blue">This facility uses AfeySync&apos;s SHA connection, so AfeySync registers its callbacks for you.</Alert>
      ) : q.error ? <ErrorText error={q.error} /> : (
        <>
          <Table head={['Updates', 'Registered', 'Delivered to AfeySync']}>
            {states.map((s) => (
              <tr key={s.entityType}>
                <Td>{LABEL[s.entityType]}</Td>
                <Td><Badge tone={s.registered ? (s.isActive ? 'green' : 'amber') : 'gray'}>{s.registered ? (s.isActive ? 'active' : 'paused') : 'not registered'}</Badge></Td>
                <Td>{s.registered ? (s.ours ? <Badge tone="green">yes</Badge> : <Badge tone="red">elsewhere</Badge>) : '—'}</Td>
              </tr>
            ))}
          </Table>
          {states.some((s) => s.registered && !s.ours) && <Alert tone="amber">Some updates are registered to a different address. Registering again points them at AfeySync.</Alert>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => register.mutate()} loading={register.isPending}>{allOk ? 'Register again' : 'Register with SHA'}</Button>
            {states.some((s) => s.registered && s.ours) && (allOk
              ? <Button variant="outline" onClick={() => confirm('Pause SHA status callbacks? Nothing is delivered while paused.') && active.mutate(false)} loading={active.isPending}>Pause</Button>
              : <Button variant="outline" onClick={() => active.mutate(true)} loading={active.isPending}>Resume</Button>)}
          </div>
          <p className="muted mt-2 text-xs">Receiver: {q.data?.receiverBase}/… (secret address). SHA calls it with POST whenever a status changes.</p>
        </>
      )}
      <ErrorText error={register.error ?? active.error} />
    </Card>
  );
}
