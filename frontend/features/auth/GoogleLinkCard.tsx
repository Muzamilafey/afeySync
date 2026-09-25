'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Realm } from '@/stores/session';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Modal } from '@/components/ui';
import { GoogleLogo } from './GoogleButton';
import { authBase } from './types';

/** Link / unlink a Google account for "Continue with Google". */
export function GoogleLinkCard({ realm, justLinked }: { realm: Realm; justLinked?: boolean }) {
  const base = authBase(realm);
  const qc = useQueryClient();
  const [unlinking, setUnlinking] = useState(false);
  const [password, setPassword] = useState('');
  const q = useQuery({ queryKey: ['google-link', realm], queryFn: async () => (await api<{ enabled: boolean; linked: boolean; googleEmail: string | null }>(`${base}/google/link`, { realm })).data });
  const link = useMutation({ mutationFn: async () => (await api<{ url: string }>(`${base}/google/link`, { method: 'POST', body: { returnOrigin: window.location.origin }, realm })).data, onSuccess: (d) => window.location.assign(d.url) });
  const unlink = useMutation({ mutationFn: () => api(`${base}/google/unlink`, { method: 'POST', body: { password }, realm }), onSuccess: () => { setUnlinking(false); setPassword(''); qc.invalidateQueries({ queryKey: ['google-link', realm] }); } });
  if (!q.data || (!q.data.enabled && !q.data.linked)) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><GoogleLogo /> Sign in with Google {q.data.linked ? <Badge tone="green">Linked</Badge> : <Badge>Not linked</Badge>}</span>}>
      {justLinked && <div className="mb-3"><Alert tone="green">Google account linked.</Alert></div>}
      {q.data.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Linked to <strong>{q.data.googleEmail}</strong></span>
          <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>Unlink</Button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="muted">Link your Google account to sign in with one click. Two-step verification still applies.</p>
          <ErrorText error={link.error} />
          <Button size="sm" variant="secondary" onClick={() => link.mutate()} loading={link.isPending}>Link Google account</Button>
        </div>
      )}
      <Modal open={unlinking} onClose={() => setUnlinking(false)} title="Unlink Google account">
        <div className="space-y-3">
          <Field label="Confirm your password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <ErrorText error={unlink.error} />
          <Button variant="danger" onClick={() => unlink.mutate()} loading={unlink.isPending} disabled={!password}>Unlink</Button>
        </div>
      </Modal>
    </Card>
  );
}
