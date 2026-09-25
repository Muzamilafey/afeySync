'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Gift, Loader2, MessageSquareText, Smartphone } from 'lucide-react';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { cn, fmtDateTime } from '@/lib/utils';
import type { SmsLedgerRow, SmsWallet } from '@/features/sms/types';

const PRESETS = [100, 250, 500, 1000, 2500];
const TYPE: Record<SmsLedgerRow['type'], { label: string; tone: 'green' | 'blue' | 'gray' | 'purple' | 'amber' }> = {
  welcome: { label: 'Welcome gift', tone: 'purple' },
  topup: { label: 'Top-up', tone: 'green' },
  debit: { label: 'SMS sent', tone: 'gray' },
  refund: { label: 'Returned', tone: 'blue' },
  adjustment: { label: 'Adjustment', tone: 'amber' },
};

function TopUp({ w }: { w: SmsWallet }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(500);
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState<{ id: string; credits: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const credits = Math.floor(amount / w.pricePerSms);
  const start = useMutation({
    mutationFn: async () => (await api<{ paymentId: string; credits: number }>('/sms-wallet/topup', { method: 'POST', body: { amount, phone } })).data,
    onSuccess: (d) => { setResult(null); setPending({ id: d.paymentId, credits: d.credits }); },
  });
  const status = useQuery({
    queryKey: ['sms-topup', pending?.id],
    queryFn: async () => (await api<{ status: string; credits?: number; receipt?: string; message?: string }>(`/sms-wallet/topup/${pending!.id}`)).data,
    enabled: !!pending,
    refetchInterval: 4000,
  });
  useEffect(() => {
    if (!pending || !status.data || status.data.status === 'pending') return;
    setResult(status.data.status === 'completed' ? { ok: true, text: `Payment received (${status.data.receipt}). ${status.data.credits} SMS added to your wallet.` } : { ok: false, text: status.data.message || 'The payment was not completed.' });
    setPending(null);
    qc.invalidateQueries({ queryKey: ['sms-wallet'] });
    qc.invalidateQueries({ queryKey: ['sms-ledger'] });
  }, [status.data, pending, qc]);

  if (!w.mpesa.available) return <Card title="Top up"><Alert tone="amber">M-Pesa top-ups are not available yet. Contact AfeySync to top up your SMS wallet.</Alert></Card>;
  const valid = amount >= w.minTopupKes && amount <= w.maxTopupKes && /^\+?\d[\d\s]{8,14}$/.test(phone.trim());
  return (
    <Card title={<span className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> Top up with M-Pesa</span>}>
      <div className="space-y-4">
        <div>
          <p className="label">Amount (KES)</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.filter((p) => p >= w.minTopupKes).map((p) => (
              <button key={p} type="button" onClick={() => setAmount(p)} className={cn('rounded-lg border px-3 py-2 text-sm transition', amount === p ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30' : 'border-[var(--border)] hover:border-brand-500')}>
                KES {p.toLocaleString()}
                <span className="muted block text-[11px]">{Math.floor(p / w.pricePerSms).toLocaleString()} SMS</span>
              </button>
            ))}
          </div>
          <Input type="number" className="mt-2 max-w-40" min={w.minTopupKes} max={w.maxTopupKes} value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} />
          <p className="muted mt-1 text-xs">KES {w.pricePerSms} per SMS · you get <strong>{credits.toLocaleString()} SMS</strong> · minimum KES {w.minTopupKes}</p>
        </div>
        <Field label="M-Pesa phone number" hint="You will get a prompt on this phone to enter your M-Pesa PIN."><Input type="tel" placeholder="e.g. 0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <ErrorText error={start.error} />
        {pending && <Alert tone="blue"><span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Check your phone and enter your M-Pesa PIN to pay KES {amount.toLocaleString()} for {pending.credits.toLocaleString()} SMS…</span></Alert>}
        {result && <Alert tone={result.ok ? 'green' : 'amber'}>{result.text}</Alert>}
        <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!valid || !!pending}>Pay KES {amount.toLocaleString()} with M-Pesa</Button>
        {w.mpesa.paybill && (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm">
            <p className="font-medium">Or pay by Paybill</p>
            <p className="muted text-xs">M-Pesa → Lipa na M-Pesa → Paybill · Business number <strong className="text-[var(--text)]">{w.mpesa.paybill}</strong> · Account number <strong className="text-[var(--text)]">{w.mpesa.accountRef}</strong>. Credits are added automatically.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function SmsWalletPage() {
  const w = useQuery({ queryKey: ['sms-wallet'], queryFn: async () => (await api<SmsWallet>('/sms-wallet')).data });
  const ledger = useQuery({ queryKey: ['sms-ledger'], queryFn: async () => (await api<SmsLedgerRow[]>('/sms-wallet/ledger', { query: { limit: 50 } })).data });
  if (w.isLoading) return <Loading />;
  if (!w.data) return <ErrorText error={w.error} />;
  const d = w.data;
  const tone = d.status === 'empty' ? 'from-red-600 to-red-800' : d.status === 'low' ? 'from-amber-500 to-amber-700' : 'from-brand-600 to-brand-900';
  return (
    <>
      <PageHeader title="SMS wallet" subtitle="Credits for appointment reminders, payment receipts, results notices and sign-in codes." crumbs={['Admin', 'SMS wallet']} />
      <div className="max-w-5xl space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-4">
            <div className={cn('rounded-2xl bg-gradient-to-br p-5 text-white shadow-lg', tone)}>
              <p className="flex items-center gap-2 text-sm opacity-90"><MessageSquareText className="h-4 w-4" /> SMS balance</p>
              <p className="mt-1 text-4xl font-bold">{d.balance.toLocaleString()} <span className="text-lg font-medium opacity-90">SMS</span></p>
              <p className="mt-1 text-sm opacity-90">{d.status === 'empty' ? 'Empty: SMS are paused until you top up.' : d.status === 'low' ? 'Running low: top up soon.' : d.usedLast30Days > 0 ? `About ${Math.max(1, Math.round(d.balance / (d.usedLast30Days / 30)))} days at your current use.` : 'Ready to use for reminders, receipts and sign-in codes.'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="surface rounded-xl p-3"><p className="muted text-xs">Used in the last 30 days</p><p className="text-lg font-semibold">{d.usedLast30Days.toLocaleString()} SMS</p></div>
              <div className="surface rounded-xl p-3"><p className="muted text-xs">Price</p><p className="text-lg font-semibold">KES {d.pricePerSms} <span className="muted text-xs font-normal">per SMS</span></p></div>
            </div>
            {d.welcome && (
              <div className="surface flex items-start gap-3 rounded-xl p-3 text-sm">
                <Gift className="h-5 w-5 shrink-0 text-purple-500" />
                <p>Welcome to AfeySync SMS: your facility received <strong>{d.welcome.credits} free SMS</strong>. Long messages use more than one SMS (160 characters each).</p>
              </div>
            )}
          </div>
          <TopUp w={d} />
        </div>

        <Card title="Wallet history">
          {ledger.isLoading && <Loading />}
          {ledger.data && (
            <Table head={['Date', 'Type', 'Details', 'SMS', 'Balance']} empty={ledger.data.length === 0}>
              {ledger.data.map((l) => (
                <tr key={l._id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</Td>
                  <Td><Badge tone={TYPE[l.type].tone}>{TYPE[l.type].label}</Badge></Td>
                  <Td className="text-xs">{l.note}{l.byName && <span className="muted"> · {l.byName}</span>}</Td>
                  <Td className={cn('font-mono text-sm', l.credits > 0 ? 'text-emerald-600' : '')}>{l.credits > 0 ? `+${l.credits}` : l.credits}</Td>
                  <Td className="font-mono text-sm">{l.balanceAfter ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="muted mt-3 flex items-center gap-1 text-xs"><CheckCircle2 className="h-3 w-3" /> SMS that fail to send are returned to your wallet automatically.</p>
        </Card>
      </div>
    </>
  );
}
