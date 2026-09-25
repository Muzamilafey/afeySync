import { meta } from '../models/meta';
import { logger } from '../utils/logger';

/**
 * Queue abstraction backed by MongoDB (durable, idempotent by `idempotencyKey`). The interface is
 * deliberately small (enqueue / handler registry / worker) so that a Redis/BullMQ implementation can
 * replace it without touching callers.
 */
export type JobType = 'SMS' | 'EMAIL' | 'DHA_SYNC' | 'SHA_CALLBACK' | 'FHIR_SYNC' | 'REPORT_GENERATION' | 'CLAIM_PROCESSING';

/** Errors a job handler throws to signal that retrying cannot help (invalid credentials, validation, business rejection). */
export class PermanentJobError extends Error {}

type Handler = (payload: Record<string, unknown>, job: { id: string; tenantId?: string; attempts: number }) => Promise<unknown>;
const handlers = new Map<JobType, Handler>();

export function registerHandler(type: JobType, handler: Handler) {
  handlers.set(type, handler);
}

export async function enqueueJob(type: JobType, idempotencyKey: string, payload: Record<string, unknown>, tenantId?: string, opts: { maxAttempts?: number; runAt?: Date } = {}) {
  const { Job } = meta();
  try {
    const job = await Job.create({ type, idempotencyKey: `${type}:${idempotencyKey}`, payload, tenantId, maxAttempts: opts.maxAttempts ?? 5, runAt: opts.runAt ?? new Date() });
    return { id: String(job._id), duplicate: false };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await Job.findOne({ idempotencyKey: `${type}:${idempotencyKey}` }).select('_id').lean();
      return { id: String(existing?._id), duplicate: true };
    }
    throw err;
  }
}

const backoffMs = (attempt: number) => Math.min(30 * 60_000, 2 ** attempt * 5_000);

export async function runNextJob(): Promise<boolean> {
  const { Job } = meta();
  const now = new Date();
  // Reclaim jobs stuck in "running" (e.g. crashed worker) after 5 minutes.
  await Job.updateMany({ status: 'running', lockedAt: { $lt: new Date(now.getTime() - 5 * 60_000) } }, { status: 'queued' });
  const job = await Job.findOneAndUpdate({ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedAt: now, $inc: { attempts: 1 } }, { sort: { runAt: 1 }, returnDocument: 'after' });
  if (!job) return false;
  const handler = handlers.get(job.type as JobType);
  try {
    if (!handler) throw new PermanentJobError(`No handler registered for ${job.type}`);
    const result = await handler((job.payload ?? {}) as Record<string, unknown>, { id: String(job._id), tenantId: job.tenantId ? String(job.tenantId) : undefined, attempts: job.attempts });
    job.status = 'completed';
    job.result = result as never;
    job.lastError = undefined;
  } catch (err) {
    const permanent = err instanceof PermanentJobError;
    job.lastError = (err as Error).message.slice(0, 500);
    if (permanent || job.attempts >= job.maxAttempts) {
      job.status = 'dead'; // dead-letter: visible in the owner portal for manual retry
    } else {
      job.status = 'queued';
      job.runAt = new Date(Date.now() + backoffMs(job.attempts));
    }
    logger.warn({ job: String(job._id), type: job.type, attempts: job.attempts, permanent, error: job.lastError }, `Job failed: ${job.lastError}`);
  }
  job.lockedAt = undefined;
  await job.save();
  return true;
}

let timer: NodeJS.Timeout | null = null;
export function startWorker(intervalMs = 2000) {
  if (timer) return;
  const tick = async () => {
    try {
      let processed = 0;
      while (processed < 20 && (await runNextJob())) processed += 1;
    } catch (err) {
      logger.error({ err }, 'Worker tick failed');
    }
    timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
}

export function stopWorker() {
  if (timer) clearTimeout(timer);
  timer = null;
}
