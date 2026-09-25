'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Badge, Button, ErrorText, Field, Input, Modal } from '@/components/ui';
import type { CreditNote } from './types';

const TONE = { submitted: 'blue', completed: 'green', failed: 'red', timeout: 'amber' } as const;

/** Pays an approved M-Pesa refund to the customer's phone (B2C). Must be started by someone other than the approver. */
export function MpesaPayout({ cn, defaultPhone, canPay }: { cn: CreditNote; defaultPhone?: string; canPay: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone ? `0${defaultPhone.slice(-9)}` : '');
  const m = useMutation({ mutationFn: () => api(`/payments/mpesa/refunds/${cn._id}/payout`, { method: 'POST', body: { phone } }), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['invoice'] }); } });
  if (cn.type !== 'refund' || cn.method !== 'mpesa') return null;
  const st = cn.payout?.status;
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1">
      {st && <Badge tone={TONE[st]}>M-Pesa payout {st}{cn.payout?.transactionId ? ` · ${cn.payout.transactionId}` : ''}</Badge>}
      {st === 'timeout' && <span className="text-xs text-amber-700">Outcome unknown — confirm with Safaricom before retrying</span>}
      {st === 'failed' && cn.payout?.resultDesc && <span className="text-xs text-red-600">{cn.payout.resultDesc}</span>}
      {canPay && (!st || st === 'failed') && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Pay out via M-Pesa</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={`Pay refund ${cn.creditNoteNumber} to M-Pesa`}>
        <div className="space-y-3">
          <Alert tone="amber">KES {cn.amount.toLocaleString()} will be sent from the facility&apos;s B2C account. This cannot be reversed from AfeySync.</Alert>
          <Field label="Customer phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
          <ErrorText error={m.error} />
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={phone.replace(/\D/g, '').length < 9}>Send payout</Button>
        </div>
      </Modal>
    </span>
  );
}
