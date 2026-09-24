import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { TenantModels } from '../../models/tenant';
import { nextSequence } from '../../models/tenant';
import { QUEUE_STAGES } from '../../models/tenant/clinical';

export type Stage = (typeof QUEUE_STAGES)[number];

/** Permission required to work a queue stage (call / start / complete). */
export const STAGE_PERMISSION: Record<Stage, string> = {
  triage: 'opd.create',
  consultation: 'consultation.create',
  laboratory: 'lab.sample',
  radiology: 'radiology.view',
  pharmacy: 'pharmacy.dispense',
  billing: 'billing.create',
  nursing: 'nursing.record',
  dental: 'dental.manage',
  mch: 'mch.manage',
  maternity: 'maternity.manage',
};

const PREFIX: Record<Stage, string> = { triage: 'T', consultation: 'C', laboratory: 'L', radiology: 'R', pharmacy: 'P', billing: 'B', nursing: 'N', dental: 'D', mch: 'M', maternity: 'MT' };

export const PRIORITY_RANK = { emergency: 0, urgent: 1, normal: 2 } as const;

export async function enqueue(m: TenantModels, input: { visitId: Types.ObjectId | string; patientId: Types.ObjectId | string; branchId: Types.ObjectId | string; stage: Stage; priority?: 'normal' | 'urgent' | 'emergency'; notes?: string }) {
  // One active entry per visit+stage.
  const active = await m.QueueEntry.findOne({ visitId: input.visitId, stage: input.stage, status: { $in: ['waiting', 'called', 'in_service'] } });
  if (active) return active;
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  const seq = await nextSequence(m, `ticket:${input.branchId}:${input.stage}:${day}`);
  return m.QueueEntry.create({ ...input, ticket: `${PREFIX[input.stage]}${String(seq).padStart(3, '0')}`, priority: input.priority ?? 'normal' });
}

export function canWorkStage(req: Request, stage: Stage) {
  return req.permissions!.has(STAGE_PERMISSION[stage]);
}
