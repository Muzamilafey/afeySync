'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { Button, ErrorText } from '@/components/ui';

/** Builds an SHA claim draft from an SHA-payer invoice (lines + finalized diagnoses), or opens the existing one. */
export function CreateClaimButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: async () => (await api<{ _id: string }>('/sha/transactions/from-invoice', { method: 'POST', body: { invoiceId } })).data,
    onSuccess: (tx) => router.push(`/sha/transactions/${tx._id}`),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CLAIM_EXISTS') router.push(`/sha/transactions/${(e.details as { id: string }).id}`);
    },
  });
  const exists = m.error instanceof ApiError && m.error.code === 'CLAIM_EXISTS';
  return (
    <>
      <Button variant="outline" onClick={() => m.mutate()} loading={m.isPending}><ShieldCheck className="h-4 w-4" /> SHA claim</Button>
      {m.error && !exists && <div className="basis-full"><ErrorText error={m.error} /></div>}
    </>
  );
}
