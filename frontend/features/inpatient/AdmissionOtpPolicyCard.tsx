'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { api } from '@/services/api';
import { Card, ErrorText, Select } from '@/components/ui';

/** Facility setting: must the patient's phone be confirmed by SMS code at admission? */
export function AdmissionOtpPolicyCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: async () => (await api<Array<{ key: string; value: unknown }>>('/admin/settings')).data });
  const value = String(q.data?.find((s) => s.key === 'admissionPhoneVerification')?.value ?? 'required');
  const m = useMutation({ mutationFn: (v: string) => api('/admin/settings/admissionPhoneVerification', { method: 'PUT', body: { value: v } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }) });
  return (
    <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> Admission phone verification</span>}>
      <p className="muted mb-3 text-sm">When admitting, staff send a code by SMS to the patient&apos;s (or next of kin&apos;s) phone and enter it back. If that is not possible, such as in an emergency or when there is no phone, they record a reason instead, so care is never delayed.</p>
      <Select value={value} onChange={(e) => m.mutate(e.target.value)} disabled={m.isPending}>
        <option value="required">Required: a code or a recorded reason</option>
        <option value="optional">Optional</option>
        <option value="off">Off</option>
      </Select>
      <div className="mt-2"><ErrorText error={m.error} /></div>
    </Card>
  );
}
