import type { Request } from 'express';
import { Types } from 'mongoose';
import { forbidden } from '../utils/errors';

/** Mongo filter restricting a query to the branches the current user may see. */
export function branchFilter(req: Request, field = 'branchId'): Record<string, unknown> {
  const u = req.user!;
  if (u.branchAccess === 'all') return {};
  return { [field]: { $in: u.branchIds.map((id) => new Types.ObjectId(id)) } };
}

export function canAccessBranch(req: Request, branchId: string | Types.ObjectId | null | undefined): boolean {
  const u = req.user!;
  if (u.branchAccess === 'all') return true;
  return branchId != null && u.branchIds.includes(String(branchId));
}

export function assertBranchAccess(req: Request, branchId: string | Types.ObjectId | null | undefined) {
  if (!canAccessBranch(req, branchId)) throw forbidden('This record belongs to a branch you cannot access', 'BRANCH_FORBIDDEN');
}

/** True when the user may see a record linked to any of the given branches. */
export function canAccessAnyBranch(req: Request, branchIds: Array<string | Types.ObjectId>): boolean {
  const u = req.user!;
  if (u.branchAccess === 'all') return true;
  return branchIds.some((b) => u.branchIds.includes(String(b)));
}
