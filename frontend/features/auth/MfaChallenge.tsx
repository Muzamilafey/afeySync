'use client';

import { useState } from 'react';
import { Fingerprint, KeyRound, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api } from '@/services/api';
import type { Realm } from '@/stores/session';
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { authBase, METHOD_LABEL, type LoginResult, type MfaChallengeData, type MfaMethod } from './types';

const ICON = { totp: Smartphone, email: Mail, sms: MessageSquare, passkey: Fingerprint } as const;

/** Second sign-in step: authenticator code, emailed/SMS code, or a recovery code. */
export function MfaChallenge({ realm, challenge, onSuccess, onCancel }: { realm: Realm; challenge: MfaChallengeData; onSuccess: (r: LoginResult) => void; onCancel: () => void }) {
  const base = authBase(realm);
  const [method, setMethod] = useState<MfaMethod | 'recovery'>(challenge.preferred ?? challenge.methods[0]);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Partial<Record<MfaMethod, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async (m: 'email' | 'sms') => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ sentTo: string }>(`${base}/mfa/challenge/send`, { method: 'POST', body: { challengeToken: challenge.challengeToken, method: m }, auth: false, realm });
      setSent({ ...sent, [m]: r.data.sentTo });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<LoginResult>(`${base}/mfa/challenge/verify`, { method: 'POST', body: { challengeToken: challenge.challengeToken, method, code }, auth: false, realm });
      onSuccess(r.data);
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  const usePasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      const o = await api<PublicKeyCredentialRequestOptionsJSON>(`${base}/mfa/challenge/passkey-options`, { method: 'POST', body: { challengeToken: challenge.challengeToken }, auth: false, realm });
      const assertion = await startAuthentication({ optionsJSON: o.data });
      const r = await api<LoginResult>(`${base}/mfa/challenge/verify`, { method: 'POST', body: { challengeToken: challenge.challengeToken, method: 'passkey', assertion }, auth: false, realm });
      onSuccess(r.data);
    } catch (err) {
      // A cancelled browser prompt is not an error worth alarming the user about.
      setError(err instanceof Error && err.name === 'NotAllowedError' ? new Error('The passkey prompt was cancelled or timed out. Try again.') : err);
    } finally {
      setBusy(false);
    }
  };
  const needsSend = method === 'email' || method === 'sms';
  const isPasskey = method === 'passkey';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="font-semibold">Two-step verification</p>
        <p className="muted text-sm">Confirm it&apos;s you to finish signing in.</p>
      </div>
      {challenge.methods.length > 1 && (
        <div className="grid gap-2" role="radiogroup" aria-label="Verification method">
          {challenge.methods.map((m) => {
            const Icon = ICON[m];
            return (
              <button type="button" key={m} role="radio" aria-checked={method === m} onClick={() => { setMethod(m); setCode(''); setError(null); }} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm', method === m ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'border-[var(--border)]')}>
                <Icon className="h-4 w-4" /> {METHOD_LABEL[m]}
                <span className="muted ml-auto text-xs">{m === 'email' ? challenge.email : m === 'sms' ? challenge.phone : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {method === 'totp' && <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>}
      {isPasskey && (browserSupportsWebAuthn() ? (
        <>
          <p className="text-sm">Use your fingerprint, face or device PIN with the passkey saved on this device or your phone.</p>
          <Button type="button" className="w-full" loading={busy} onClick={usePasskey}><Fingerprint className="h-4 w-4" /> Use passkey</Button>
        </>
      ) : <Alert tone="amber">This browser does not support passkeys. Choose another method.</Alert>)}
      {needsSend && (sent[method] ? <Alert tone="green">Code sent to {sent[method]}. It expires in 10 minutes.</Alert> : (
        <Button type="button" variant="secondary" className="w-full" loading={busy} onClick={() => send(method)}>Send code {method === 'email' ? `to ${challenge.email}` : challenge.phone ? `to ${challenge.phone}` : ''}</Button>
      ))}
      {method === 'recovery' && <p className="text-sm">Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.</p>}
      {!isPasskey && (!needsSend || sent[method]) && (
        <Field label={method === 'recovery' ? 'Recovery code' : 'Verification code'}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode={method === 'recovery' ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus maxLength={method === 'recovery' ? 12 : 6} placeholder={method === 'recovery' ? 'xxxxx-xxxxx' : '123456'} className="text-center font-mono text-lg tracking-widest" />
        </Field>
      )}
      <ErrorText error={error} />
      {!isPasskey && (!needsSend || sent[method]) && <Button type="submit" className="w-full" loading={busy} disabled={code.trim().length < 6}>Verify</Button>}
      <div className="flex justify-between text-sm">
        {needsSend && sent[method] ? <button type="button" className="text-brand-600" onClick={() => send(method as 'email' | 'sms')}>Resend code</button> : <span />}
        {challenge.recoveryAvailable && method !== 'recovery' && <button type="button" className="text-brand-600" onClick={() => { setMethod('recovery'); setCode(''); }}><KeyRound className="mr-1 inline h-3.5 w-3.5" />Use a recovery code</button>}
        {method === 'recovery' && <button type="button" className="text-brand-600" onClick={() => setMethod(challenge.preferred ?? challenge.methods[0])}>Use another method</button>}
      </div>
      <button type="button" className="muted w-full text-center text-xs underline" onClick={onCancel}>Back to sign in</button>
    </form>
  );
}
