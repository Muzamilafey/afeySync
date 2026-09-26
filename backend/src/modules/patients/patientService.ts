import type { Request } from 'express';
import { Types } from 'mongoose';
import { nextSequence, type TenantModels } from '../../models/tenant';
import { canAccessAnyBranch } from '../../middleware/branchScope';
import { escapeRegex } from '../../utils/validate';

export function normalizePhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const d = raw.replace(/[^\d+]/g, '');
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^\+?254[17]\d{8}$/.test(d)) return d.replace('+', '');
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  return d || undefined;
}

export async function nextPatientNumber(m: TenantModels): Promise<string> {
  const prefix = ((await m.FacilitySetting.findOne({ key: 'patientNumberPrefix' }).lean())?.value as string) || 'AFS';
  const seq = await nextSequence(m, 'patientNumber');
  return `${prefix}-${String(seq).padStart(7, '0')}`;
}

export interface IdentifierInput {
  type: string;
  value: string;
}

/**
 * Tenant-wide duplicate detection on strong identifiers. Runs across all branches (duplicates must be
 * caught even when the existing record is in another branch) but only returns minimal fields.
 */
export async function findDuplicates(req: Request, input: { identifiers?: IdentifierInput[]; nationalId?: string; clientRegistryId?: string; shaNumber?: string; excludeId?: string }) {
  const { Patient } = req.tenant!.models;
  const or: Record<string, unknown>[] = [];
  if (input.nationalId) or.push({ nationalId: input.nationalId.trim() });
  if (input.clientRegistryId) or.push({ clientRegistryId: input.clientRegistryId.trim() });
  if (input.shaNumber) or.push({ shaNumber: input.shaNumber.trim() });
  for (const id of input.identifiers ?? []) if (id.value?.trim()) or.push({ identifiers: { $elemMatch: { type: id.type, value: id.value.trim() } } });
  if (!or.length) return [];
  const filter: Record<string, unknown> = { $or: or, status: { $ne: 'merged' } };
  if (input.excludeId) filter._id = { $ne: new Types.ObjectId(input.excludeId) };
  const matches = await Patient.find(filter).select('patientNumber firstName lastName clientRegistryId branchIds registeredBranchId').limit(5).lean();
  return matches.map((p) => {
    const accessible = canAccessAnyBranch(req, p.branchIds ?? []);
    return {
      id: accessible ? String(p._id) : undefined,
      patientNumber: p.patientNumber,
      name: accessible ? `${p.firstName} ${p.lastName}` : undefined,
      clientRegistryId: accessible ? p.clientRegistryId : undefined,
      accessible,
    };
  });
}

/** Build a fast, index-friendly search filter from a single free-text query. */
export function buildSearchFilter(q: string): Record<string, unknown> {
  const term = q.trim();
  const or: Record<string, unknown>[] = [];
  const upper = term.toUpperCase();
  if (/^[A-Z]{2,5}-?\d{1,9}$/.test(upper)) {
    const m = upper.match(/^([A-Z]{2,5})-?(\d+)$/)!;
    or.push({ patientNumber: `${m[1]}-${m[2].padStart(7, '0')}` }, { patientNumber: upper });
  }
  if (/^CR/i.test(term)) or.push({ clientRegistryId: upper }, { clientRegistryId: term });
  if (/^[\d+\s-]{6,15}$/.test(term)) {
    const digits = term.replace(/\D/g, '');
    or.push({ nationalId: digits }, { shaNumber: term }, { 'identifiers.value': term });
    const phone = normalizePhone(term);
    if (phone && phone.length >= 12) or.push({ phone });
  }
  if (/^[A-Za-z0-9/-]{5,30}$/.test(term)) or.push({ 'identifiers.value': term }, { 'insurance.memberNumber': term }, { shaNumber: term });
  if (/^[A-Za-z' -]{2,}$/.test(term)) {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean).map(escapeRegex);
    // Prefix match on the normalized name uses the searchName index; additional words must also appear.
    or.push({ $and: [{ searchName: new RegExp(`^${words[0]}`) }, ...words.slice(1).map((w) => ({ searchName: new RegExp(`\\b${w}`) }))] });
    if (words.length === 1) or.push({ searchName: new RegExp(`\\s${words[0]}`) });
  }
  return or.length ? { $or: or } : { _id: null };
}

export const patientSummaryFields = 'patientNumber firstName middleName lastName gender dateOfBirth phone email nationalId nationality clientRegistryId shaNumber sha.status registeredBranchId branchIds status';
