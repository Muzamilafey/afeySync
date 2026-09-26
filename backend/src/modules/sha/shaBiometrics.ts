import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AppError } from '../../utils/errors';
import type { TenantModels } from '../../models/tenant';
import { hieRequest } from '../../integrations/hie/hieClient';
import { pick } from '../../integrations/hie/normalize';
import { audit } from '../audit/auditService';

/**
 * Minors biometrics (DHA HIE Consent Services). Enrollment, verification and matching are all asynchronous: the
 * HIE answers 202 and delivers the outcome to the facility's registered callback endpoint. Each dispatch is kept as
 * a ShaBiometricJob; the callback (or, if one was missed, a single reconciliation read) resolves it.
 */
type Obj = Record<string, unknown>;
type Kind = 'enrollment' | 'verification' | 'match';
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const body0 = (d: unknown): Obj => (isObj(d) ? (isObj(d.data) ? (d.data as Obj) : d) : {});
const upstream = (err: unknown) => ((err as AppError)?.details as { upstreamCode?: string; httpStatus?: number } | undefined) ?? {};

const OPERATION: Record<Kind, string> = { enrollment: 'sha.biometrics.enrollment.create', verification: 'sha.biometrics.verification.create', match: 'sha.biometrics.match.create' };

export interface DispatchInput {
  patientId: Types.ObjectId | string;
  beneficiaryCode: string;
  shaVisitId?: Types.ObjectId | string;
  workstationId: string;
  deviceId: string;
  agentId: string;
  position?: number;
}

/** Turns documented dispatch refusals into messages a clinician can act on. */
function explain(kind: Kind, err: unknown): never {
  const e = err as AppError;
  const { upstreamCode, httpStatus } = upstream(err);
  if (httpStatus === 503 || e?.code === 'SHA_UNAVAILABLE') {
    throw new AppError(503, 'SHA_WORKSTATION_OFFLINE', 'The HealthID workstation is not live. Make sure HealthID is running on this computer and the scanner is plugged in, then try again. Nothing was sent.');
  }
  if (upstreamCode === 'subject_not_enrolled') {
    throw new AppError(422, 'SHA_CHILD_NOT_ENROLLED', 'This child\'s fingerprint enrollment is not complete. Finish enrolling and verifying the child\'s fingers, then try again.');
  }
  if (httpStatus === 422 && /callback|endpoint/i.test(e?.message ?? '')) {
    throw new AppError(422, 'SHA_CALLBACK_NOT_REGISTERED', 'SHA needs a registered callback endpoint for this facility before it can send fingerprint results. Register it under Administration → Integrations → SHA callbacks.');
  }
  if (httpStatus === 400) throw new AppError(422, 'SHA_VALIDATION_ERROR', e.message);
  void kind;
  throw err;
}

export async function dispatchBiometric(req: Request, kind: Kind, input: DispatchInput) {
  const m = req.tenant!.models;
  const base = { workstation_id: input.workstationId, device_id: input.deviceId, agent_id: input.agentId };
  // The same dependant code must be used from enrollment through match and visit (siblings differ only by the suffix).
  const body = kind === 'match'
    ? { health_id: input.beneficiaryCode, ...base, ...(input.position !== undefined ? { position: input.position } : {}) }
    : { beneficiary_code: input.beneficiaryCode, ...base, position: input.position };
  if (kind !== 'match' && !(input.position! >= 1 && input.position! <= 10)) throw new AppError(400, 'VALIDATION_ERROR', 'Choose the finger position (1 to 10)');
  let data: unknown;
  try {
    data = (await hieRequest('sha', { tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId }, { operation: OPERATION[kind], body })).data;
  } catch (err) {
    explain(kind, err);
  }
  const o = body0(data);
  const externalId = kind === 'match' ? pick(o, 'match_id', 'matchId') : pick(o, 'job_id', 'jobId');
  if (!externalId) throw new AppError(502, 'SHA_UPSTREAM_ERROR', 'SHA accepted the capture but returned no reference to follow it');
  const job = await m.ShaBiometricJob.create({
    kind,
    externalId,
    patientId: input.patientId,
    branchId: req.branch?.id,
    shaVisitId: input.shaVisitId,
    beneficiaryCode: input.beneficiaryCode,
    position: input.position,
    workstationId: input.workstationId,
    deviceId: input.deviceId,
    status: 'dispatched',
    requestedBy: req.user!.id,
    requestedByName: req.user!.name,
  });
  await audit(req, { action: `sha.biometrics.${kind}_dispatched`, resource: 'patient', resourceId: String(input.patientId), newValue: { position: input.position, job: String(job._id) } });
  return job;
}

type Job = NonNullable<Awaited<ReturnType<TenantModels['ShaBiometricJob']['findOne']>>>;

/** Reads an outcome (callback body or reconciliation read) into the job. */
function applyOutcome(job: Job, raw: Obj, via: 'callback' | 'reconciliation') {
  const o = body0(raw);
  const status = pick(o, 'status', 'state', 'data.status')?.toLowerCase();
  const errorCode = pick(o, 'error_code', 'errorCode');
  job.errorCode = errorCode ?? undefined;
  job.errorDetail = pick(o, 'error_detail', 'errorDetail', 'message') ?? undefined;
  if (job.kind === 'match') {
    const matched = o.matched === true || status === 'matched';
    if (status === 'pending' && !matched) return false;
    job.outcome = matched ? 'matched' : status === 'no_match' ? 'no_match' : 'failed';
    job.status = matched ? 'succeeded' : 'failed';
    const exp = pick(o, 'expires_at', 'expiresAt');
    if (exp) job.expiresAt = new Date(exp);
  } else if (job.kind === 'verification') {
    const verified = o.verified === true || status === 'verified';
    const reenroll = o.requires_reenroll === true || o.requiresReenroll === true || status === 'max_attempts_exceeded';
    const remaining = Number(pick(o, 'attempts_remaining', 'attemptsRemaining'));
    job.attemptsRemaining = Number.isNaN(remaining) ? undefined : remaining;
    job.requiresReenroll = reenroll || undefined;
    job.outcome = verified ? 'verified' : reenroll ? 'max_attempts_exceeded' : errorCode === 'deadline_exceeded' ? 'deadline_exceeded' : 'not_verified';
    job.status = verified ? 'succeeded' : 'failed';
  } else {
    const failed = !!errorCode || ['failed', 'deadline_exceeded', 'error'].includes(status ?? '');
    if (status === 'pending' || status === 'dispatched') return false;
    job.outcome = failed ? errorCode ?? status ?? 'failed' : 'enrolled';
    job.status = failed ? 'failed' : 'succeeded';
  }
  job.resolvedAt = new Date();
  job.resolvedBy = via;
  return true;
}

const OUTCOME_TEXT: Record<string, string> = {
  matched: 'fingerprint matched',
  no_match: 'fingerprint did not match',
  failed: 'capture failed',
  deadline_exceeded: 'capture window closed with no finger',
  enrolled: 'finger enrolled; verify it next',
  verified: 'finger verified',
  not_verified: 'finger did not match its enrolled print',
  max_attempts_exceeded: 'finger ran out of attempts; enrol it again',
};

async function afterResolve(m: TenantModels, job: Job) {
  await job.save();
  if (job.kind === 'match' && job.shaVisitId) {
    const v = await m.ShaVisit.findById(job.shaVisitId);
    if (v && v.consent?.match?.matchId === job.externalId) {
      v.set('consent.match.status', job.outcome);
      v.set('consent.match.expiresAt', job.expiresAt);
      v.set('consent.match.errorCode', job.errorCode);
      if (job.outcome === 'matched') {
        v.set('consent.status', 'MATCHED');
        if (v.status === 'biometric_pending' || v.status === 'consent_pending') v.status = 'authorized';
      }
      else if (v.status === 'biometric_pending') v.status = 'consent_pending';
      v.history.push({ at: new Date(), action: `minor_match_${job.outcome}`, note: job.errorCode ?? undefined } as never);
      await v.save();
    }
  }
  if (job.requestedBy) {
    const text = OUTCOME_TEXT[job.outcome ?? ''] ?? job.outcome ?? 'result received';
    const link = job.shaVisitId ? `/sha/visits/${job.shaVisitId}` : `/patients/${job.patientId}`;
    await m.Notification.create({ userId: job.requestedBy, branchId: job.branchId, event: 'Authorization', title: `Fingerprint ${job.kind}: ${text}`, body: job.position ? `Finger position ${job.position}` : undefined, link });
  }
}

/** Applies a status callback to a biometric job. Returns false when the payload is not a biometric outcome. */
export async function applyBiometricCallback(m: TenantModels, payload: Obj): Promise<{ jobId: Types.ObjectId } | false> {
  const o = body0(payload);
  const ids = [pick(o, 'match_id', 'matchId'), pick(o, 'job_id', 'jobId')].filter(Boolean) as string[];
  if (!ids.length) return false;
  const job = await m.ShaBiometricJob.findOne({ externalId: { $in: ids } });
  if (!job) return false;
  if (job.status === 'succeeded' || job.status === 'failed') return { jobId: job._id };
  if (applyOutcome(job, payload, 'callback')) await afterResolve(m, job);
  else await job.save();
  return { jobId: job._id };
}

/**
 * Reconciliation for a callback believed missed: only matches have a documented read. Enrollment progress is read
 * from enrollment-status instead. Called once on request, never in a loop.
 */
export async function reconcileJob(req: Request, job: Job) {
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  if (job.kind !== 'match') return job;
  const r = await hieRequest('sha', { tenantId: req.tenant!.id, userId: req.user!.id, requestId: req.requestId }, { operation: 'sha.biometrics.match.get', pathParams: { match_id: job.externalId } });
  if (applyOutcome(job, body0(r.data), 'reconciliation')) await afterResolve(req.tenant!.models, job);
  return job;
}
