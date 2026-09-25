'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, MessageSquareText, ShieldAlert } from 'lucide-react';
import { api } from '@/services/api';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';
import { cn } from '@/lib/utils';

export type PhoneVerificationValue = { token: string; phoneMasked: string } | { skipReason: string; note?: string } | null;
interface Info { policy: 'required' | 'optional' | 'off'; options: Array<{ target: 'patient' | 'next_of_kin'; index?: number; label: string; phoneMasked: string }>; skipReasons: Array<{ key: string; label: string }> }

/**
 * Confirms the patient's phone at admission: a 6-digit code by SMS, entered back by the admitting
 * staff member. When that is not possible (emergency, no phone) a reason is recorded instead.
 */
export function PhoneVerification({ patientId, value, onChange, onPolicy }: { patientId: string; value: PhoneVerificationValue; onChange: (v: PhoneVerificationValue) => void; onPolicy?: (p: Info['policy']) => void }) {
  const info = useQuery({ queryKey: ['admission-phone', patientId], queryFn: async () => (await api<Info>('/inpatient/admissions/phone-verification', { query: { patientId } })).data });
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [savePhone, setSavePhone] = useState(true);
  const [sent, setSent] = useState<{ otpId: string; sentTo: string } | null>(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'code' | 'skip'>('code');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (info.data) { onPolicy?.(info.data.policy); setChoice(info.data.options[0] ? `${info.data.options[0].target}:${info.data.options[0].index ?? ''}` : 'other'); } }, [info.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(null); setSent(null); setCode(''); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'skip') onChange(reason ? { skipReason: reason, note: note || undefined } : null); }, [mode, reason, note]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: async () => {
      const [target, idx] = choice.split(':');
      const body = target === 'other' ? { patientId, target: 'other', phone: other, savePhone } : { patientId, target, nextOfKinIndex: idx ? Number(idx) : undefined };
      return (await api<{ otpId: string; sentTo: string }>('/inpatient/admissions/phone-otp', { method: 'POST', body })).data;
    },
    onSuccess: (d) => { setSent(d); setCode(''); verify.reset(); },
  });
  const verify = useMutation({
    mutationFn: async () => (await api<{ verificationToken: string; phoneMasked: string }>(`/inpatient/admissions/phone-otp/${sent!.otpId}/verify`, { method: 'POST', body: { code } })).data,
    onSuccess: (d) => onChange({ token: d.verificationToken, phoneMasked: d.phoneMasked }),
  });

  if (!info.data || info.data.policy === 'off') return null;
  if (value && 'token' in value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
        <CheckCircle2 className="h-5 w-5" /> Phone verified ({value.phoneMasked}).
        <button type="button" className="ml-auto text-xs underline" onClick={() => { onChange(null); setSent(null); }}>Change</button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-medium"><MessageSquareText className="h-4 w-4" /> Verify the patient&apos;s phone {info.data.policy === 'optional' && <span className="muted text-xs font-normal">(optional)</span>}</p>
        <div className="ml-auto flex rounded-md border border-[var(--border)] p-0.5 text-xs">
          {(['code', 'skip'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); onChange(null); }} className={cn('rounded px-2 py-1', mode === m ? 'bg-brand-600 text-white' : '')}>{m === 'code' ? 'Send a code' : "Can't verify"}</button>
          ))}
        </div>
      </div>
      {mode === 'code' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select value={choice} onChange={(e) => { setChoice(e.target.value); setSent(null); }}>
              {info.data.options.map((o) => <option key={`${o.target}:${o.index ?? ''}`} value={`${o.target}:${o.index ?? ''}`}>{o.label}: {o.phoneMasked}</option>)}
              <option value="other">Another number…</option>
            </Select>
            <Button type="button" variant="outline" onClick={() => send.mutate()} loading={send.isPending} disabled={choice === 'other' && other.trim().length < 9}>{sent ? 'Send again' : 'Send code'}</Button>
          </div>
          {choice === 'other' && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <Input type="tel" placeholder="e.g. 0712345678" value={other} onChange={(e) => setOther(e.target.value)} />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={savePhone} onChange={(e) => setSavePhone(e.target.checked)} /> Save to the patient&apos;s record once verified</label>
            </div>
          )}
          <ErrorText error={send.error} />
          {sent && (
            <div className="space-y-2">
              <p className="muted text-xs">Code sent by SMS to {sent.sentTo}. Ask the patient (or next of kin) to read it to you. It expires in 10 minutes.</p>
              <div className="flex gap-2">
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-36 text-center font-mono text-lg tracking-widest" placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button type="button" onClick={() => verify.mutate()} loading={verify.isPending} disabled={code.length !== 6}>Verify</Button>
              </div>
              <ErrorText error={verify.error} />
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select…</option>{info.data.skipReasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select></Field>
          <Field label={reason === 'other' ? 'Explain' : 'Note (optional)'}><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="muted col-span-full flex items-center gap-1 text-xs"><ShieldAlert className="h-3 w-3" /> The reason is recorded on the admission and in the audit trail. Emergency care is never delayed.</p>
        </div>
      )}
    </div>
  );
}

export const phoneVerificationReady = (policy: string, v: PhoneVerificationValue) => policy !== 'required' || (!!v && ('token' in v || (!!v.skipReason && (v.skipReason !== 'other' || (v.note ?? '').length >= 5))));
