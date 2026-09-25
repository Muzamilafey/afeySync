'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';

interface Settings { pricePerSms: number; welcomeCredits: number; lowBalanceCredits: number; minTopupKes: number; otpOverdraftCredits: number }
interface WalletRow { tenantId: string; name: string; slug: string; status: string; balance: number; walletStatus: 'ok' | 'low' | 'empty'; usedLast30Days: number; toppedUpLast30Days: number }

function SettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-sms-settings'], queryFn: async () => (await ownerApi<Settings>('/sms/settings')).data });
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => ownerApi('/sms/settings', { method: 'PUT', body: f }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-sms-settings'] }) });
  if (!f) return <Loading />;
  const num = (k: keyof Settings, label: string, hint: string, step = 1) => (
    <Field label={label} hint={hint}><Input type="number" step={step} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></Field>
  );
  return (
    <Card title="SMS pricing and rules">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {num('pricePerSms', 'Price per SMS (KES)', 'What facilities pay per SMS credit (one 160-character segment).', 0.1)}
        {num('welcomeCredits', 'Free welcome SMS', 'Given once to every facility when it starts.')}
        {num('lowBalanceCredits', 'Low-balance alert at', 'Administrators are alerted when the balance falls to this many SMS.')}
        {num('minTopupKes', 'Minimum top-up (KES)', 'Smallest M-Pesa top-up accepted.')}
        {num('otpOverdraftCredits', 'Sign-in code reserve', 'Sign-in codes may take an empty wallet this far below zero so nobody is locked out.')}
        <div className="col-span-full space-y-2">
          <ErrorText error={save.error} />
          {save.isSuccess && <Alert tone="green">Saved. New prices apply to top-ups from now on.</Alert>}
          <Button type="submit" loading={save.isPending}>Save</Button>
        </div>
      </form>
    </Card>
  );
}

export default function OwnerSmsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-sms-wallets'], queryFn: async () => (await ownerApi<WalletRow[]>('/sms/wallets')).data });
  const [adj, setAdj] = useState<WalletRow | null>(null);
  const [credits, setCredits] = useState('');
  const [note, setNote] = useState('');
  const adjust = useMutation({
    mutationFn: () => ownerApi(`/sms/wallets/${adj!.tenantId}/adjust`, { method: 'POST', body: { credits: Math.trunc(Number(credits)), note } }),
    onSuccess: () => { setAdj(null); setCredits(''); setNote(''); qc.invalidateQueries({ queryKey: ['owner-sms-wallets'] }); },
  });
  const total = q.data?.reduce((n, w) => n + w.usedLast30Days, 0) ?? 0;
  return (
    <>
      <PageHeader title="SMS" subtitle="SMS is available to every facility on every plan. Facilities pay from a prepaid SMS wallet, topped up with M-Pesa through your Billing collection channel." crumbs={['Owner', 'SMS']} />
      <div className="space-y-5">
        <Alert tone="blue" title="Where SMS is sent from">All facility SMS (reminders, receipts, results notices and sign-in codes) go through the SMS gateway set up in Integrations (Africa&apos;s Talking or Talksasa). Top-ups are paid into the M-Pesa channel under Integrations → M-Pesa (AfeySync billing).</Alert>
        <SettingsCard />
        <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> Facility wallets <span className="muted text-xs font-normal">· {total.toLocaleString()} SMS used in the last 30 days</span></span>}>
          {q.isLoading && <Loading />}
          <ErrorText error={q.error} />
          {q.data && (
            <Table head={['Facility', 'Balance', 'Used (30 days)', 'Topped up (30 days)', '']} empty={q.data.length === 0}>
              {q.data.map((w) => (
                <tr key={w.tenantId}>
                  <Td className="font-medium">{w.name}<span className="muted block text-xs">{w.slug}</span></Td>
                  <Td><span className="font-mono">{w.balance.toLocaleString()}</span> <Badge tone={w.walletStatus === 'ok' ? 'green' : w.walletStatus === 'low' ? 'amber' : 'red'}>{w.walletStatus}</Badge></Td>
                  <Td>{w.usedLast30Days.toLocaleString()}</Td>
                  <Td>{w.toppedUpLast30Days.toLocaleString()}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setAdj(w)}>Adjust</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Modal open={!!adj} onClose={() => setAdj(null)} title={`Adjust SMS wallet — ${adj?.name ?? ''}`}>
        <div className="space-y-3">
          <p className="muted text-sm">Add credits (e.g. a paybill payment with a wrong account number, or a goodwill gift) or remove them with a negative number. Recorded in the wallet history and audit log.</p>
          <Field label="SMS credits (+ to add, − to remove)"><Input type="number" value={credits} onChange={(e) => setCredits(e.target.value)} /></Field>
          <Field label="Reason"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paybill payment QWE123 sent with wrong account number" /></Field>
          <ErrorText error={adjust.error} />
          <Button onClick={() => adjust.mutate()} loading={adjust.isPending} disabled={!Number(credits) || note.trim().length < 3}>Save adjustment</Button>
        </div>
      </Modal>
    </>
  );
}
