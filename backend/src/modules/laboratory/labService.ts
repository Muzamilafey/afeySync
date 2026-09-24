import { nextSequence, type TenantModels } from '../../models/tenant';
import { ageInDays } from '../common/helpers';

type Range = { sex?: string | null; ageMinDays?: number | null; ageMaxDays?: number | null; low?: number | null; high?: number | null; criticalLow?: number | null; criticalHigh?: number | null; text?: string | null };
type Param = { code: string; name: string; unit?: string | null; type?: string | null; ranges?: Range[] | null };

/** Select the reference range matching the patient's sex and age (most specific first). */
export function pickRange(param: Param, sex?: string | null, dob?: Date | null): Range | undefined {
  const days = ageInDays(dob) ?? 30 * 365;
  const candidates = (param.ranges ?? []).filter((r) => (r.ageMinDays ?? 0) <= days && days <= (r.ageMaxDays ?? 54750) && (!r.sex || r.sex === 'any' || r.sex === sex));
  return candidates.sort((a, b) => Number(b.sex && b.sex !== 'any') - Number(a.sex && a.sex !== 'any'))[0];
}

export function interpret(param: Param, raw: string, sex?: string | null, dob?: Date | null) {
  const range = pickRange(param, sex, dob);
  const refText = range ? (range.low != null || range.high != null ? `${range.low ?? ''}–${range.high ?? ''}` : range.text ?? '') : '';
  if (param.type === 'numeric' || param.type == null) {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) return { value: raw, flag: '' as const, critical: false, referenceRange: refText };
    let flag: 'N' | 'L' | 'H' | 'LL' | 'HH' = 'N';
    let critical = false;
    if (range?.criticalLow != null && n <= range.criticalLow) [flag, critical] = ['LL', true];
    else if (range?.criticalHigh != null && n >= range.criticalHigh) [flag, critical] = ['HH', true];
    else if (range?.low != null && n < range.low) flag = 'L';
    else if (range?.high != null && n > range.high) flag = 'H';
    return { value: raw, numeric: n, flag, critical, referenceRange: refText };
  }
  const normal = range?.text;
  return { value: raw, flag: (normal && raw && raw !== normal ? 'A' : normal ? 'N' : '') as 'A' | 'N' | '', critical: false, referenceRange: refText };
}

export async function nextAccession(m: TenantModels, prefix: string) {
  const d = new Date(Date.now() + 3 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '');
  const seq = await nextSequence(m, `${prefix}:${d}`);
  return `${prefix}${d}${String(seq).padStart(4, '0')}`;
}

export const TERMINAL = ['released', 'rejected', 'cancelled'];
