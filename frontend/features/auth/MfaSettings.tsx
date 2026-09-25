'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, Download, Fingerprint, Mail, MessageSquare, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api } from '@/services/api';
import { useSessionStore, type Realm } from '@/stores/session';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { authBase, METHOD_LABEL, type MfaMethod } from './types';

interface Status { enabled: MfaMethod[]; available: MfaMethod[]; required: boolean; policy: { mode: string; methods: MfaMethod[] }; preferred: MfaMethod | null; email: string; smsPhone?: string; phoneOnFile?: string; recoveryCodesRemaining: number; passkeys?: Passkey[] }
interface Passkey { id: string; name?: string; createdAt?: string; lastUsedAt?: string; backedUp?: boolean }
type Enrolled = { recoveryCodes?: string[]; accessToken?: string };

const ICON = { totp: Smartphone, email: Mail, sms: MessageSquare, passkey: Fingerprint } as const;
const DESC: Record<MfaMethod, string> = {
  totp: 'Google Authenticator, Microsoft Authenticator, Authy or any TOTP app. Works offline.',
  email: 'A 6-digit code is emailed to you at sign-in.',
  sms: 'A 6-digit code is sent by SMS to your phone at sign-in.',
  passkey: 'Sign in with your fingerprint, face or device PIN. Phishing-resistant and nothing to type.',
};

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const download = () => {
    const blob = new Blob([`AfeySync recovery codes\nGenerated ${new Date().toISOString()}\nEach code can be used once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'afeysync-recovery-codes.txt';
    a.click();
  };
  return (
    <div className="space-y-3">
      <Alert tone="amber" title="Save your recovery codes">Use one of these if you lose access to your phone or email. They are shown only once.</Alert>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-2)] p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={download}><Download className="h-4 w-4" /> Download</Button>
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</Button>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have saved these codes somewhere safe</label>
      <Button disabled={!ack} onClick={onDone}>Done</Button>
    </div>
  );
}

function TotpSetup({ realm, onEnrolled }: { realm: Realm; onEnrolled: (e: Enrolled) => void }) {
  const base = authBase(realm);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const setup = useMutation({ mutationFn: async () => (await api<{ secret: string; otpauthUri: string }>(`${base}/mfa/totp/setup`, { method: 'POST', realm })).data });
  const confirm = useMutation({ mutationFn: async () => (await api<Enrolled>(`${base}/mfa/totp/confirm`, { method: 'POST', body: { code }, realm })).data, onSuccess: onEnrolled });
  const { mutate } = setup;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);
  useEffect(() => {
    if (setup.data) QRCode.toDataURL(setup.data.otpauthUri, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(null));
  }, [setup.data]);
  if (setup.isPending) return <Loading />;
  if (setup.error) return <ErrorText error={setup.error} />;
  const secret = setup.data?.secret ?? '';
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open Google Authenticator (or another authenticator app) and add an account.</li>
        <li>Scan this QR code, or enter the key manually.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {qr && <img src={qr} alt="Authenticator QR code" className="h-44 w-44 rounded-lg border border-[var(--border)] bg-white p-1" />}
        <div className="text-sm">
          <p className="muted text-xs">Setup key</p>
          <p className="break-all font-mono">{secret.match(/.{1,4}/g)?.join(' ')}</p>
        </div>
      </div>
      <Field label="Code from the app"><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="font-mono tracking-widest" /></Field>
      <ErrorText error={confirm.error} />
      <Button onClick={() => confirm.mutate()} loading={confirm.isPending} disabled={code.length !== 6}>Verify and turn on</Button>
    </div>
  );
}

function CodeSetup({ realm, method, phoneOnFile, onEnrolled }: { realm: Realm; method: 'email' | 'sms'; phoneOnFile?: string; onEnrolled: (e: Enrolled) => void }) {
  const base = authBase(realm);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const send = useMutation({ mutationFn: async () => (await api<{ challengeToken: string; sentTo: string }>(`${base}/mfa/${method}/setup`, { method: 'POST', body: method === 'sms' && phone ? { phone } : {}, realm })).data });
  const confirm = useMutation({ mutationFn: async () => (await api<Enrolled>(`${base}/mfa/${method}/confirm`, { method: 'POST', body: { challengeToken: send.data!.challengeToken, code }, realm })).data, onSuccess: onEnrolled });
  return (
    <div className="space-y-3">
      {method === 'sms' && !send.data && (
        <Field label="Mobile number" hint={phoneOnFile ? `Leave blank to use the number on file (${phoneOnFile})` : 'Kenyan mobile number, e.g. 0712 345 678'}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
      )}
      {!send.data ? (
        <Button onClick={() => send.mutate()} loading={send.isPending}>Send verification code</Button>
      ) : (
        <>
          <Alert tone="green">Code sent to {send.data.sentTo}.</Alert>
          <Field label="Verification code"><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="font-mono tracking-widest" /></Field>
          <div className="flex gap-2">
            <Button onClick={() => confirm.mutate()} loading={confirm.isPending} disabled={code.length !== 6}>Verify and turn on</Button>
            <Button variant="ghost" onClick={() => send.mutate()} loading={send.isPending}>Resend</Button>
          </div>
        </>
      )}
      <ErrorText error={send.error ?? confirm.error} />
    </div>
  );
}

function PasskeySetup({ realm, onEnrolled }: { realm: Realm; onEnrolled: (e: Enrolled) => void }) {
  const base = authBase(realm);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const o = await api<{ challengeToken: string; options: PublicKeyCredentialCreationOptionsJSON }>(`${base}/mfa/passkey/options`, { method: 'POST', realm });
      let response;
      try {
        response = await startRegistration({ optionsJSON: o.data.options });
      } catch (err) {
        if (err instanceof Error && err.name === 'InvalidStateError') throw new Error('This device already has a passkey for your account.');
        if (err instanceof Error && err.name === 'NotAllowedError') throw new Error('The passkey prompt was cancelled or timed out. Try again.');
        throw err;
      }
      return (await api<Enrolled>(`${base}/mfa/passkey/confirm`, { method: 'POST', body: { challengeToken: o.data.challengeToken, name: name.trim() || 'Passkey', response }, realm })).data;
    },
    onSuccess: onEnrolled,
  });
  if (!browserSupportsWebAuthn()) return <Alert tone="amber">This browser does not support passkeys. Use a current version of Chrome, Edge, Safari or Firefox.</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-sm">Your browser will ask you to create a passkey with this device (fingerprint, face or PIN), a phone, or a security key. The private key never leaves your device.</p>
      <Field label="Name" hint="Helps you recognise it later, e.g. “Ward laptop” or “My phone”"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <ErrorText error={add.error} />
      <Button onClick={() => add.mutate()} loading={add.isPending}><Fingerprint className="h-4 w-4" /> Create passkey</Button>
    </div>
  );
}

/** Two-step verification settings for the signed-in user (facility or owner portal). */
export function MfaSettings({ realm, onEnrollmentComplete }: { realm: Realm; onEnrollmentComplete?: () => void }) {
  const base = authBase(realm);
  const qc = useQueryClient();
  const setToken = useSessionStore((s) => s.setToken);
  const [adding, setAdding] = useState<MfaMethod | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState<{ action: 'disable' | 'regen' | 'passkey'; method?: MfaMethod; passkey?: Passkey } | null>(null);
  const [password, setPassword] = useState('');
  const status = useQuery({ queryKey: ['mfa-status', realm], queryFn: async () => (await api<Status>(`${base}/mfa`, { realm })).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['mfa-status', realm] });
  const onEnrolled = (e: Enrolled) => {
    setAdding(null);
    if (e.accessToken) setToken(realm, e.accessToken);
    if (e.recoveryCodes) setCodes(e.recoveryCodes);
    else if (e.accessToken) onEnrollmentComplete?.();
    refresh();
  };
  const withPw = useMutation({
    mutationFn: async () => (pw!.action === 'disable' ? api(`${base}/mfa/${pw!.method}/disable`, { method: 'POST', body: { password }, realm }) : pw!.action === 'passkey' ? api(`${base}/mfa/passkey/remove`, { method: 'POST', body: { id: pw!.passkey!.id, password }, realm }) : api<{ recoveryCodes: string[] }>(`${base}/mfa/recovery-codes`, { method: 'POST', body: { password }, realm })),
    onSuccess: (r) => {
      const rc = (r.data as { recoveryCodes?: string[] })?.recoveryCodes;
      if (rc) setCodes(rc);
      setPw(null);
      setPassword('');
      refresh();
    },
  });
  const preferred = useMutation({ mutationFn: (method: MfaMethod) => api(`${base}/mfa/preferred`, { method: 'POST', body: { method }, realm }), onSuccess: refresh });

  if (status.isLoading) return <Loading />;
  if (!status.data) return <ErrorText error={status.error} />;
  const s = status.data;
  const methods = [...new Set([...s.enabled, ...s.available])] as MfaMethod[];
  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Two-step verification {s.enabled.length ? <Badge tone="green">On</Badge> : <Badge tone={s.required ? 'red' : 'gray'}>Off</Badge>}</span>}>
      {s.required && !s.enabled.length && <div className="mb-4"><Alert tone="amber" title="Required by your organisation">Add at least one method to continue using AfeySync.</Alert></div>}
      <ul className="divide-y divide-[var(--border)]">
        {methods.map((m) => {
          const Icon = ICON[m];
          const on = s.enabled.includes(m);
          const allowed = s.available.includes(m);
          return (
            <li key={m} className="flex flex-wrap items-center gap-3 py-3">
              <Icon className="h-5 w-5 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{METHOD_LABEL[m]} {on && <CheckCircle2 className="inline h-4 w-4 text-emerald-600" />} {s.preferred === m && on && <Badge tone="blue">Default</Badge>}</p>
                <p className="muted text-xs">{on && m === 'email' ? s.email : on && m === 'sms' ? s.smsPhone : DESC[m]}</p>
                {!allowed && !on && <p className="text-xs text-amber-600">Not permitted by policy</p>}
                {m === 'passkey' && on && (
                  <ul className="mt-2 space-y-1">
                    {(s.passkeys ?? []).map((k) => (
                      <li key={k.id} className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{k.name ?? 'Passkey'}</span>
                        {k.backedUp && <Badge tone="gray">synced</Badge>}
                        <span className="muted text-xs">added {fmtDateTime(k.createdAt)}{k.lastUsedAt ? ` · last used ${fmtDateTime(k.lastUsedAt)}` : ''}</span>
                        <button type="button" aria-label={`Remove passkey ${k.name ?? ''}`} className="muted ml-auto hover:text-red-600" onClick={() => { withPw.reset(); setPw({ action: 'passkey', passkey: k }); }}><Trash2 className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {on ? (
                <div className="flex gap-1">
                  {m === 'passkey' && allowed && (s.passkeys?.length ?? 0) < 10 && <Button size="sm" variant="ghost" onClick={() => setAdding('passkey')}>Add another</Button>}
                  {s.preferred !== m && <Button size="sm" variant="ghost" onClick={() => preferred.mutate(m)}>Make default</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { withPw.reset(); setPw({ action: 'disable', method: m }); }}>{m === 'passkey' ? 'Remove all' : 'Remove'}</Button>
                </div>
              ) : allowed && <Button size="sm" variant="secondary" onClick={() => setAdding(m)}>Set up</Button>}
            </li>
          );
        })}
      </ul>
      {s.enabled.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3 text-sm">
          <span>Recovery codes: <strong>{s.recoveryCodesRemaining}</strong> unused</span>
          <Button size="sm" variant="ghost" onClick={() => { withPw.reset(); setPw({ action: 'regen' }); }}>Generate new codes</Button>
        </div>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Set up ${METHOD_LABEL[adding].toLowerCase()}` : ''}>
        {adding === 'totp' && <TotpSetup realm={realm} onEnrolled={onEnrolled} />}
        {adding === 'passkey' && <PasskeySetup realm={realm} onEnrolled={onEnrolled} />}
        {(adding === 'email' || adding === 'sms') && <CodeSetup realm={realm} method={adding} phoneOnFile={s.phoneOnFile} onEnrolled={onEnrolled} />}
      </Modal>
      <Modal open={!!codes} onClose={() => undefined} title="Recovery codes">
        {codes && <RecoveryCodes codes={codes} onDone={() => { setCodes(null); onEnrollmentComplete?.(); }} />}
      </Modal>
      <Modal open={!!pw} onClose={() => setPw(null)} title={pw?.action === 'disable' ? `Remove ${pw.method === 'passkey' ? 'all passkeys' : pw.method ? METHOD_LABEL[pw.method].toLowerCase() : ''}` : pw?.action === 'passkey' ? `Remove passkey “${pw.passkey?.name ?? 'Passkey'}”` : 'Generate new recovery codes'}>
        <div className="space-y-3">
          {pw?.action === 'regen' && <p className="muted text-sm">Your existing recovery codes will stop working.</p>}
          <Field label="Confirm your password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <ErrorText error={withPw.error} />
          <Button variant={pw?.action === 'regen' ? 'primary' : 'danger'} onClick={() => withPw.mutate()} loading={withPw.isPending} disabled={!password}>Confirm</Button>
        </div>
      </Modal>
    </Card>
  );
}
