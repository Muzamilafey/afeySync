import { z } from 'zod';

/**
 * Standard prescribing vocabulary. Prescriptions and medication charting store these canonical codes,
 * so orders read the same everywhere (pharmacy, MAR, ePrescription, FHIR). Keep in step with
 * frontend/features/pharmacy/dosing.ts (a test checks the two lists match).
 */
export const FREQUENCIES = [
  { code: 'OD', label: 'Once daily', perDay: 1 },
  { code: 'BD', label: 'Twice daily', perDay: 2 },
  { code: 'TDS', label: 'Three times daily', perDay: 3 },
  { code: 'QID', label: 'Four times daily', perDay: 4 },
  { code: 'Q4H', label: 'Every 4 hours', perDay: 6 },
  { code: 'Q6H', label: 'Every 6 hours', perDay: 4 },
  { code: 'Q8H', label: 'Every 8 hours', perDay: 3 },
  { code: 'Q12H', label: 'Every 12 hours', perDay: 2 },
  { code: 'MANE', label: 'Every morning', perDay: 1 },
  { code: 'NOCTE', label: 'At night', perDay: 1 },
  { code: 'EOD', label: 'Every other day', perDay: 0.5 },
  { code: 'WEEKLY', label: 'Once a week', perDay: 1 / 7 },
  { code: 'STAT', label: 'Once, immediately', perDay: null },
  { code: 'PRN', label: 'When required', perDay: null },
] as const;

export const ROUTES = [
  { code: 'PO', label: 'Oral' },
  { code: 'SL', label: 'Sublingual' },
  { code: 'BUCCAL', label: 'Buccal' },
  { code: 'IV', label: 'Intravenous' },
  { code: 'IM', label: 'Intramuscular' },
  { code: 'SC', label: 'Subcutaneous' },
  { code: 'ID', label: 'Intradermal' },
  { code: 'PR', label: 'Rectal' },
  { code: 'PV', label: 'Vaginal' },
  { code: 'TOP', label: 'Topical (skin)' },
  { code: 'INH', label: 'Inhaled' },
  { code: 'NEB', label: 'Nebulised' },
  { code: 'EYE', label: 'Eye' },
  { code: 'EAR', label: 'Ear' },
  { code: 'NASAL', label: 'Nasal' },
  { code: 'TD', label: 'Transdermal' },
  { code: 'NG', label: 'Nasogastric tube' },
] as const;

export const DOSE_UNITS = ['mg', 'g', 'mcg', 'ml', 'IU', 'units', 'mmol', 'tab', 'cap', 'sachet', 'drop', 'puff', 'application', 'suppository', 'pessary', 'patch', 'vial', 'ampoule'] as const;

const FREQ_ALIASES: Record<string, string> = { ONCE: 'OD', 'ONCE DAILY': 'OD', QD: 'OD', DAILY: 'OD', BID: 'BD', 'TWICE DAILY': 'BD', TID: 'TDS', 'THREE TIMES DAILY': 'TDS', QDS: 'QID', 'FOUR TIMES DAILY': 'QID', ON: 'NOCTE', HS: 'NOCTE', OM: 'MANE', 'AS NEEDED': 'PRN', SOS: 'PRN', 'ALTERNATE DAYS': 'EOD' };
const ROUTE_ALIASES: Record<string, string> = { ORAL: 'PO', 'BY MOUTH': 'PO', 'SUB-LINGUAL': 'SL', INTRAVENOUS: 'IV', INTRAMUSCULAR: 'IM', SUBCUT: 'SC', SUBCUTANEOUS: 'SC', SQ: 'SC', RECTAL: 'PR', VAGINAL: 'PV', TOPICAL: 'TOP', INHALED: 'INH', INHALATION: 'INH', NEBULISED: 'NEB', NEBULIZED: 'NEB', OPHTHALMIC: 'EYE', OTIC: 'EAR', INTRANASAL: 'NASAL', TRANSDERMAL: 'TD', NGT: 'NG' };
const UNIT_ALIASES: Record<string, (typeof DOSE_UNITS)[number]> = { tabs: 'tab', tablet: 'tab', tablets: 'tab', caps: 'cap', capsule: 'cap', capsules: 'cap', sachets: 'sachet', drops: 'drop', puffs: 'puff', applications: 'application', suppositories: 'suppository', pessaries: 'pessary', patches: 'patch', vials: 'vial', ampoules: 'ampoule', unit: 'units', iu: 'IU', microgram: 'mcg', micrograms: 'mcg', µg: 'mcg', milligram: 'mg', milligrams: 'mg', gram: 'g', grams: 'g', millilitre: 'ml', millilitres: 'ml', mL: 'ml' };

export const frequencyInfo = (code?: string | null) => FREQUENCIES.find((f) => f.code === code);

export function normalizeFrequency(v: string) {
  const s = v.trim().toUpperCase().replace(/\s+/g, ' ');
  const code = FREQUENCIES.some((f) => f.code === s) ? s : FREQ_ALIASES[s];
  return code ?? null;
}

export function normalizeRoute(v: string) {
  const s = v.trim().toUpperCase().replace(/\s+/g, ' ');
  return ROUTES.some((r) => r.code === s) ? s : ROUTE_ALIASES[s] ?? null;
}

/** "1g", "1 tab", "½ tab", "2.5 ml", "1/2 tabs" → "1 g", "1 tab", "0.5 tab", "2.5 ml", "0.5 tab"; null when not a dose. */
export function normalizeDose(v: string) {
  const m = v.trim().replace(/½/g, '0.5').replace(/¼/g, '0.25').match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*([A-Za-zµ]+)$/);
  if (!m) return null;
  const amount = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  if (!(amount > 0) || amount > 100_000) return null;
  const raw = m[3];
  const unit = (DOSE_UNITS as readonly string[]).includes(raw) ? raw : UNIT_ALIASES[raw] ?? UNIT_ALIASES[raw.toLowerCase()] ?? ((DOSE_UNITS as readonly string[]).find((u) => u.toLowerCase() === raw.toLowerCase()) ?? null);
  if (!unit) return null;
  return `${Math.round(amount * 1000) / 1000} ${unit}`;
}

const dosing = <T extends string>(fn: (v: string) => T | null, what: string) =>
  z.string().max(60).transform((v, ctx) => {
    const n = fn(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: what });
      return z.NEVER;
    }
    return n;
  });

export const doseSchema = dosing(normalizeDose, 'Choose a dose, e.g. 1 tab, 500 mg or 5 ml');
export const frequencySchema = dosing(normalizeFrequency, `Choose a frequency: ${FREQUENCIES.map((f) => f.code).join(', ')}`);
export const routeSchema = dosing(normalizeRoute, `Choose a route: ${ROUTES.map((r) => r.code).join(', ')}`);
