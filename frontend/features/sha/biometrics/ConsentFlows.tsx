'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Fingerprint, RefreshCw, Send, Timer } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { Alert, Button, ErrorText, Field, Input, Loading, Select } from '@/components/ui';
import { JOB_OUTCOME_LABEL, type BiometricJob, type ShaVisit } from '../shaVisitTypes';
import { HealthIdCard } from './HealthIdCard';
import { useWorkstation } from './healthId';

/** Seconds until a moment (negative once passed), ticking every second. */
export function useCountdown(until?: string | Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.round((new Date(until).getTime() - now) / 1000) : null;
}
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** Watches a capture's local record: SHA's callback updates it, so this never polls SHA itself. */
export function useBiometricJob(jobId?: string) {
  return useQuery({
    queryKey: ['sha-bio-job', jobId],
    enabled: !!jobId,
    queryFn: async () => (await api<BiometricJob>(`/sha/biometrics/jobs/${jobId}`)).data,
    refetchInterval: (q) => (q.state.data && ['succeeded', 'failed'].includes(q.state.data.status) ? false : 3000),
  });
}

function ErrorWithHelp({ error, patientId }: { error: unknown; patientId?: string }) {
  if (error instanceof ApiError && error.code === 'SHA_CHILD_NOT_ENROLLED' && patientId) {
    return <Alert tone="amber" title="The child is not fully enrolled">{error.message} <Link className="font-semibold underline" href={`/patients/${patientId}?tab=sha`}>Open fingerprint enrollment</Link></Alert>;
  }
  if (error instanceof ApiError && error.code === 'SHA_CALLBACK_NOT_REGISTERED') return <Alert tone="amber" title="SHA callbacks not registered">{error.message}</Alert>;
  if (error instanceof ApiError && error.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED') return <Alert tone="amber">This SHA operation has not been configured yet by AfeySync platform administration.</Alert>;
  return <ErrorText error={error} />;
}

/* ------------------------------------------------------------------ OTP */
export function OtpConsent({ v, onAuthorized, otp, setOtp }: { v: ShaVisit; onAuthorized: () => void; otp: string; setOtp: (s: string) => void }) {
  const [contact, setContact] = useState('');
  const contacts = useQuery({ queryKey: ['sha-contacts', v._id], queryFn: async () => (await api<{ results?: Array<{ id: number; contactType?: string; contactValue?: string; isConfirmed?: boolean; active?: boolean }> }>(`/sha/visits/${v._id}/contacts`)).data, retry: false });
  const send = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/otp`, { method: 'POST', body: contact ? { contactId: Number(contact) } : {} }) });
  const authorize = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/authorize`, { method: 'POST', body: { method: 'otp', otp } }), onSuccess: onAuthorized });
  const list = (contacts.data?.results ?? []).filter((c) => c.active !== false);
  return (
    <div className="space-y-3">
      <Field label="Send the OTP to">
        {contacts.isLoading ? <Loading /> : (
          <Select value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Primary confirmed contact on the SHA record</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.contactValue ?? c.id}{c.contactType ? ` (${c.contactType.toLowerCase()})` : ''}{c.isConfirmed === false ? ' – not confirmed' : ''}</option>)}
          </Select>
        )}
      </Field>
      <ErrorWithHelp error={contacts.error} />
      <p className="muted text-xs">Ask the patient (or the child&apos;s guardian) to confirm which number to use. The OTP is never stored.</p>
      <Button size="sm" variant="secondary" onClick={() => send.mutate()} loading={send.isPending}><Send className="h-4 w-4" /> Send OTP</Button>
      {send.isSuccess && <Alert tone="green">OTP sent.</Alert>}
      <ErrorWithHelp error={send.error} />
      <Field label="OTP"><Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={8} autoComplete="one-time-code" className="font-mono tracking-widest" /></Field>
      <Button onClick={() => authorize.mutate()} loading={authorize.isPending} disabled={otp.length < 4}>Verify &amp; continue</Button>
      <ErrorWithHelp error={authorize.error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Adult fingerprint (SHA capture page) */
interface Capture { url?: string; embeddedToken?: string; expiresAt?: string }

export function AdultFingerprint({ v, refresh, discharge = false }: { v: ShaVisit; refresh: () => void; discharge?: boolean }) {
  const ws = useWorkstation(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const AUTH = /^AUTHORI[SZ]ED(_PENDING_VISIT)?$/i;
  const d = v.dischargeAuth;
  const pending = discharge ? !!d?.status && !AUTH.test(d.status) && !d.rejectedAt : v.status === 'biometric_pending' && v.consent?.method === 'biometric';
  const src = discharge ? d : v.consent;
  const url = capture?.url ?? src?.verificationUrl;
  const expiresAt = capture?.expiresAt ?? src?.verificationExpiresAt;
  const left = useCountdown(pending ? expiresAt : null);
  const expired = pending && left !== null && left <= 0;
  const create = useMutation({
    mutationFn: async () => (await api<{ capture: Capture | null; authorized: boolean }>(`/sha/visits/${v._id}/authorize`, { method: 'POST', body: { method: 'biometric', deviceOs: ws.resolved.deviceOs, workStationId: ws.resolved.workstationId, agentId: ws.resolved.agentId, ekycProviderId: ws.resolved.ekycProviderId || undefined, isDischargeAuthorization: discharge } })).data,
    onSuccess: (d) => { setCapture(d.capture); refresh(); },
  });
  // Get Authorizations: has the capture matched? Checked every few seconds while the capture page is open.
  const check = useQuery({
    queryKey: ['sha-auth-check', v._id, src?.authGuid, discharge],
    enabled: pending && !!src?.authGuid,
    queryFn: async () => (await api<{ authorized: boolean; captureExpired: boolean }>(`/sha/visits/${v._id}/authorization/refresh`, { method: 'POST', body: { discharge } })).data,
    refetchInterval: (q) => (q.state.data?.authorized ? false : expired ? 30_000 : 5000),
    retry: false,
  });
  useEffect(() => {
    if (check.data?.authorized) refresh();
  }, [check.data?.authorized, refresh]);
  const reject = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/authorization/reject`, { method: 'POST', body: { reason: 'Capture window expired', discharge } }), onSuccess: () => { setCapture(null); refresh(); } });

  if (discharge && d?.status && AUTH.test(d.status)) return <Alert tone="green" title="Discharge authorized">The patient&apos;s fingerprint authorized the discharge{d.authCode ? ` · Auth code ${d.authCode}` : ''}.</Alert>;

  if (pending) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Alert tone={expired ? 'red' : 'blue'} title={expired ? 'The capture window has expired' : 'Capture the patient\'s fingerprint'}>
            {expired
              ? 'No fingerprint was captured in time, so this authorization is stuck waiting. Cancel it and start again.'
              : 'In the SHA screen below, click Start. The scanner wakes; the patient places their finger. AfeySync checks with SHA automatically and continues when the fingerprint matches.'}
          </Alert>
        </div>
        {left !== null && !expired && <p className="flex items-center gap-2 text-sm font-medium"><Timer className="h-4 w-4" /> Time left to capture: <span className="font-mono">{mmss(left)}</span></p>}
        {url && /^https:\/\//.test(url) && !expired && (
          <iframe title="SHA fingerprint capture" src={url} className="h-[520px] w-full rounded-lg border border-[var(--border)] bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
        )}
        {!url && <Alert tone="amber">SHA did not return a capture page for this authorization. Check the status, or cancel and try again.</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => check.refetch()} loading={check.isFetching}><RefreshCw className="h-4 w-4" /> Check status now</Button>
          <Button variant={expired ? 'primary' : 'ghost'} onClick={() => (expired || confirm('Cancel this fingerprint authorization? You can start a new one straight away.')) && reject.mutate()} loading={reject.isPending}>{expired ? 'Cancel it and start again' : 'Cancel authorization'}</Button>
        </div>
        <ErrorWithHelp error={check.error ?? reject.error} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <HealthIdCard ws={ws} />
      <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ws.ready}><Fingerprint className="h-4 w-4" /> {discharge ? 'Start fingerprint discharge authorization' : 'Start fingerprint verification'}</Button>
      <ErrorWithHelp error={create.error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Child fingerprint (minors biometrics) */
export function ChildFingerprint({ v, refresh }: { v: ShaVisit; refresh: () => void }) {
  const ws = useWorkstation(true);
  const [failures, setFailures] = useState(0);
  const match = v.consent?.method === 'minor_biometric' ? v.consent.match : undefined;
  const job = useBiometricJob(match?.jobId);
  const waiting = !!match && (!job.data || ['dispatched', 'pending'].includes(job.data.status));
  const waitedFor = useCountdown(job.data?.createdAt ? new Date(new Date(job.data.createdAt).getTime()) : null);
  const matchedLeft = useCountdown(match?.status === 'matched' ? match.expiresAt : null);
  useEffect(() => {
    if (job.data && ['succeeded', 'failed'].includes(job.data.status)) {
      if (job.data.status === 'failed') setFailures((n) => n + 1);
      refresh();
    }
  }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const dispatch = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/minor-match`, { method: 'POST', body: { workstationId: ws.resolved.workstationId, deviceId: ws.resolved.deviceId, agentId: ws.resolved.agentId } }), onSuccess: refresh });
  const reconcile = useMutation({ mutationFn: () => api(`/sha/biometrics/jobs/${match?.jobId}/reconcile`, { method: 'POST' }), onSuccess: () => job.refetch() });
  const patientId = v.patientId._id;

  if (match?.status === 'matched' && !match.usedAt) {
    return matchedLeft !== null && matchedLeft <= 0
      ? <div className="space-y-2"><Alert tone="amber" title="The match has expired">A fingerprint match can be used for 10 minutes from the capture. Capture again.</Alert><Button onClick={() => dispatch.mutate()} loading={dispatch.isPending} disabled={!ws.ready}>Capture again</Button></div>
      : <Alert tone="green" title="Fingerprint matched">Start the visit now: this match is valid for another {matchedLeft !== null ? mmss(matchedLeft) : '10:00'} and can be used once.</Alert>;
  }
  if (waiting) {
    return (
      <div className="space-y-3">
        <Alert tone="blue" title="Waiting for the child's fingerprint">The scanner is awake. Ask the child to place their enrolled finger on it. The result comes back from SHA on its own.</Alert>
        <div className="flex items-center gap-2 text-sm"><Loading label="Waiting for SHA's result…" /></div>
        {waitedFor !== null && -waitedFor > 60 && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="muted text-xs">No result yet? Make sure the child placed the finger, and that SHA callbacks are registered for this facility.</p>
            <Button size="sm" variant="outline" onClick={() => reconcile.mutate()} loading={reconcile.isPending}>Ask SHA for the result</Button>
          </div>
        )}
        <ErrorWithHelp error={reconcile.error} />
      </div>
    );
  }
  const lastFailed = job.data?.status === 'failed' ? job.data : null;
  return (
    <div className="space-y-3">
      {lastFailed && (
        <Alert tone="amber" title={JOB_OUTCOME_LABEL[lastFailed.outcome ?? ''] ?? 'No match'}>
          {lastFailed.outcome === 'no_match' ? 'Ask the child to try again with an enrolled finger, pressing flat and still.' : 'Request a fresh capture.'}{lastFailed.errorDetail ? ` (${lastFailed.errorDetail})` : ''}
        </Alert>
      )}
      {failures >= 2 && (
        <Alert tone="blue" title="Still not matching?">
          A finger that repeatedly fails will keep failing. Ask SHA to allow OTP for this child: <Link className="font-semibold underline" href={`/patients/${patientId}?tab=sha`}>Request OTP whitelisting</Link>. If the child&apos;s fingers were never fully enrolled, enrol them first.
        </Alert>
      )}
      <HealthIdCard ws={ws} />
      <Button onClick={() => dispatch.mutate()} loading={dispatch.isPending} disabled={!ws.ready}><Fingerprint className="h-4 w-4" /> {lastFailed ? 'Capture again' : 'Capture the child\'s fingerprint'}</Button>
      <ErrorWithHelp error={dispatch.error} patientId={patientId} />
      <p className="muted text-xs">The child consents with their own enrolled finger (SHA marked them for minors biometrics). Not enrolled yet? <Link className="underline" href={`/patients/${patientId}?tab=sha`}>Enrol the child&apos;s fingers</Link>.</p>
    </div>
  );
}
