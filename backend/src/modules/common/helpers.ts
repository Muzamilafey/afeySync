import type { Request } from 'express';
import { isValidObjectId, type Model } from 'mongoose';
import { nextSequence, type TenantModels } from '../../models/tenant';
import { forbidden, notFound } from '../../utils/errors';
import { canAccessBranch } from '../../middleware/branchScope';

export const oid = (id: unknown, what = 'Record') => {
  if (typeof id !== 'string' || !isValidObjectId(id)) throw notFound(`${what} not found`);
  return id;
};

/** Human-friendly, tenant-unique sequential numbers, e.g. INV-000123. */
export async function nextNumber(m: TenantModels, key: string, prefix: string, pad = 6) {
  const seq = await nextSequence(m, key);
  return `${prefix}-${String(seq).padStart(pad, '0')}`;
}

/** Load a branch-scoped record and enforce branch access. */
export async function loadScoped<T extends { branchId?: unknown }>(req: Request, model: Model<T>, id: unknown, what = 'Record') {
  const doc = await model.findById(oid(id, what));
  if (!doc) throw notFound(`${what} not found`);
  if (!canAccessBranch(req, (doc as unknown as { branchId?: string }).branchId as string)) throw forbidden(`This ${what.toLowerCase()} belongs to a branch you cannot access`, 'BRANCH_FORBIDDEN');
  return doc;
}

export const actor = (req: Request) => ({ id: req.user!.id, name: req.user!.name });

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const dayRange = (from?: unknown, to?: unknown) => {
  const start = from ? new Date(String(from)) : new Date(new Date().setHours(0, 0, 0, 0));
  const end = to ? new Date(new Date(String(to)).setHours(23, 59, 59, 999)) : new Date(new Date(start).setHours(23, 59, 59, 999));
  return { $gte: start, $lte: end };
};

export function ageInDays(dob?: Date | null) {
  return dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 86400_000) : undefined;
}
