'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import type { SmsWallet } from './types';

/** Reminds wallet managers to top up when the SMS balance is low or empty. */
export function SmsWalletBanner() {
  const can = useCan();
  const allowed = can('subscription.view', 'admin.settings');
  const q = useQuery({ queryKey: ['sms-wallet'], queryFn: async () => (await api<SmsWallet>('/sms-wallet')).data, enabled: allowed, staleTime: 60_000 });
  if (!allowed || !q.data || q.data.status === 'ok') return null;
  const empty = q.data.status === 'empty';
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${empty ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}>
      <MessageSquareWarning className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1">
        {empty ? <><strong>Your SMS wallet is empty.</strong> Appointment reminders, receipts and other SMS are paused.</> : <><strong>SMS wallet running low:</strong> {q.data.balance} SMS left.</>} Top up with M-Pesa to keep messages going.
      </p>
      <Link href="/admin/sms" className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">Top up</Link>
    </div>
  );
}
