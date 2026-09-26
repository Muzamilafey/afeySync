'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Fingerprint, RefreshCw } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Loading, Table, Td } from '@/components/ui';
import { cn, fmtDateTime } from '@/lib/utils';
import { JOB_OUTCOME_LABEL, type BiometricJob } from '../shaVisitTypes';
import { HealthIdCard } from './HealthIdCard';
import { useWorkstation } from './healthId';
import { useBiometricJob } from './ConsentFlows';

interface Enrollment { beneficiaryCode: string; useSilBiometrics: boolean | null; enrollmentStatus: string; verified: number[]; nonVerified: number[]; total: number }

/** Standard finger positions: 1–5 right hand (thumb to little finger), 6–10 left hand. */
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const fingerName = (p: number) => `${p <= 5 ? 'Right' : 'Left'} ${FINGERS[(p - 1) % 5].toLowerCase()}`;

/**
 * Minors biometrics enrollment: each finger is enrolled, then verified with a second capture. Both outcomes arrive
 * from SHA by callback. Completion is SHA's decision (enrollment_status), never a finger count of our own.
 */
export function ChildEnrollmentPanel({ patientId, childFlag }: { patientId: string; childFlag?: boolean | null }) {
  const can = useCan();
  const ws = useWorkstation(true);
  const [position, setPosition] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | undefined>();
  const status = useQuery({ queryKey: ['sha-enrollment', patientId], queryFn: async () => (await api<Enrollment>('/sha/biometrics/enrollment-status', { query: { patientId } })).data, retry: false });
  const jobs = useQuery({ queryKey: ['sha-bio-jobs', patientId], queryFn: async () => (await api<BiometricJob[]>('/sha/biometrics/jobs', { query: { patientId } })).data });
  const job = useBiometricJob(jobId);
  useEffect(() => {
    if (job.data && ['succeeded', 'failed'].includes(job.data.status)) { status.refetch(); jobs.refetch(); }
  }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const dispatch = useMutation({
    mutationFn: async (kind: 'enrollments' | 'verifications') => (await api<BiometricJob>(`/sha/biometrics/${kind}`, { method: 'POST', body: { patientId, position, workstationId: ws.resolved.workstationId, deviceId: ws.resolved.deviceId, agentId: ws.resolved.agentId } })).data,
    onSuccess: (j) => { setJobId(j._id); jobs.refetch(); },
  });
  const e = status.data;
  const state = (p: number) => (e?.verified.includes(p) ? 'verified' : e?.nonVerified.includes(p) ? 'enrolled' : 'none');
  const waiting = !!job.data && ['dispatched', 'pending'].includes(job.data.status);
  const complete = e?.enrollmentStatus === 'fully_enrolled';
  const sel = position ? state(position) : null;
  const hand = (from: number, label: string) => (
    <div>
      <p className="muted mb-1.5 text-xs font-semibold uppercase">{label}</p>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 5 }, (_, i) => from + i).map((p) => {
          const st = state(p);
          return (
            <button key={p} type="button" onClick={() => setPosition(p)} disabled={waiting} aria-pressed={position === p} title={`${p}. ${fingerName(p)}`}
              className={cn('flex flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 text-[11px] transition',
                position === p ? 'border-brand-600' : 'border-[var(--border)]',
                st === 'verified' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : st === 'enrolled' ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'hover:bg-[var(--surface-2)]')}>
              <Fingerprint className="h-5 w-5" />
              <span className="font-semibold">{p}</span>
              <span className="leading-tight">{FINGERS[(p - 1) % 5]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <Card title="Child fingerprint enrollment (SHA minors biometrics)" actions={<Button size="sm" variant="ghost" onClick={() => status.refetch()} loading={status.isFetching}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}>
      <div className="space-y-4">
        {childFlag === false && <Alert tone="blue">SHA did not mark this beneficiary for minors biometrics, so a guardian OTP is used instead. Enrollment is only needed for children SHA marks for fingerprint consent.</Alert>}
        {status.isLoading ? <Loading /> : status.error ? <ErrorText error={status.error} /> : e && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={complete ? 'green' : e.total ? 'amber' : 'gray'}>{complete ? 'Fully enrolled' : e.enrollmentStatus === 'partially_enrolled' ? 'Partly enrolled' : 'Not enrolled'}</Badge>
              <span className="muted">{e.verified.length} verified · {e.nonVerified.length} waiting to be verified · beneficiary code <span className="font-mono">{e.beneficiaryCode}</span></span>
            </div>
            {complete
              ? <Alert tone="green">The child can now consent with their fingerprint at the start of an SHA visit.</Alert>
              : <p className="muted text-xs">Enrol a finger, then verify it with a second capture. Repeat for the fingers the child needs until SHA reports the child as fully enrolled. It does not have to be done in one sitting.</p>}
            <div className="grid gap-4 md:grid-cols-2">{hand(1, 'Right hand')}{hand(6, 'Left hand')}</div>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-200" /> Verified</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-200" /> Enrolled, needs verifying</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-[var(--border)]" /> Not enrolled</span>
            </div>
          </>
        )}
        {can('sha.authorization') && (
          <>
            <HealthIdCard ws={ws} />
            {waiting ? (
              <Alert tone="blue" title={`Waiting for ${job.data!.kind === 'verification' ? 'the verification' : 'the enrollment'} capture`}>Ask the child to place their {position ? fingerName(position).toLowerCase() : ''} finger on the scanner. SHA sends the result back on its own.</Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => dispatch.mutate('enrollments')} loading={dispatch.isPending && dispatch.variables === 'enrollments'} disabled={!position || !ws.ready || sel === 'verified'} variant={sel === 'enrolled' ? 'outline' : 'primary'}>
                  {sel === 'enrolled' ? 'Enrol again' : 'Enrol finger'}{position ? ` ${position}` : ''}
                </Button>
                <Button onClick={() => dispatch.mutate('verifications')} loading={dispatch.isPending && dispatch.variables === 'verifications'} disabled={!position || !ws.ready || sel !== 'enrolled'}>Verify finger{position ? ` ${position}` : ''}</Button>
                {!position && <span className="muted text-sm">Choose a finger above.</span>}
              </div>
            )}
            {job.data && !waiting && (
              <Alert tone={job.data.status === 'succeeded' ? 'green' : 'amber'} title={JOB_OUTCOME_LABEL[job.data.outcome ?? ''] ?? job.data.outcome ?? 'Result received'}>
                {job.data.outcome === 'not_verified' && job.data.attemptsRemaining !== undefined ? `Try again: ${job.data.attemptsRemaining} attempt(s) left for this finger.` : job.data.requiresReenroll ? 'Enrol this finger again: a fresh enrollment resets its attempts.' : job.data.outcome === 'enrolled' ? 'Now verify the same finger.' : job.data.errorDetail ?? ''}
              </Alert>
            )}
            <ErrorText error={dispatch.error} />
          </>
        )}
        {(jobs.data?.length ?? 0) > 0 && (
          <details>
            <summary className="muted cursor-pointer text-sm">Capture history</summary>
            <Table head={['When', 'Capture', 'Finger', 'Result', 'By']}>
              {jobs.data!.map((j) => <tr key={j._id}><Td className="text-xs">{fmtDateTime(j.createdAt)}</Td><Td className="capitalize">{j.kind}</Td><Td>{j.position ? `${j.position}. ${fingerName(j.position)}` : 'Any'}</Td><Td><Badge tone={j.status === 'succeeded' ? 'green' : j.status === 'failed' ? 'red' : 'gray'}>{JOB_OUTCOME_LABEL[j.outcome ?? ''] ?? j.status}</Badge></Td><Td className="text-xs">{j.requestedByName}</Td></tr>)}
            </Table>
          </details>
        )}
      </div>
    </Card>
  );
}
