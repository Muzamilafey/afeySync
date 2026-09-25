'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Card, ErrorText } from '@/components/ui';
import { GoogleLogo } from './GoogleButton';

/** Facility administrators can turn off "Continue with Google" even when the platform offers it. */
export function GoogleToggleCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['google-toggle'], queryFn: async () => (await api<{ enabled: boolean; platformEnabled: boolean }>('/admin/security/google-login')).data });
  const m = useMutation({ mutationFn: (enabled: boolean) => api('/admin/security/google-login', { method: 'PUT', body: { enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['google-toggle'] }) });
  if (!q.data) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><GoogleLogo /> Sign in with Google</span>}>
      {!q.data.platformEnabled ? <Alert tone="blue">Not offered by AfeySync platform administration yet.</Alert> : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={q.data.enabled} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} />
          Allow staff to sign in with a linked Google account (two-step verification still applies)
        </label>
      )}
      <ErrorText error={m.error} />
    </Card>
  );
}
