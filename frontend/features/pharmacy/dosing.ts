/**
 * Standard prescribing vocabulary; mirrors backend/src/modules/pharmacy/dosing.ts (a backend test
 * checks the lists match). The server validates every value again.
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
export type DoseUnit = (typeof DOSE_UNITS)[number];

export const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, 30, 60, 90];

export const INSTRUCTIONS = ['After meals', 'Before meals', 'With food', 'On an empty stomach', 'At bedtime', 'Complete the full course', 'Avoid alcohol', 'Do not crush or chew', 'Shake well before use', 'Dissolve in water', 'May cause drowsiness'];

/** Countable units: a dose in these is also a number of stock units, so quantity can be worked out. */
const COUNTABLE: DoseUnit[] = ['tab', 'cap', 'sachet', 'suppository', 'pessary', 'patch', 'vial', 'ampoule'];

const AMOUNTS: Record<string, number[]> = {
  tab: [0.25, 0.5, 1, 1.5, 2, 3, 4],
  cap: [1, 2, 3, 4],
  ml: [0.5, 1, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 100, 250, 500, 1000],
  mg: [0.5, 1, 2, 2.5, 4, 5, 10, 12.5, 15, 20, 25, 40, 50, 75, 80, 100, 120, 125, 150, 200, 250, 300, 400, 500, 600, 750, 800, 1000, 1500, 2000],
  g: [0.25, 0.5, 1, 1.5, 2, 3, 4],
  mcg: [5, 10, 25, 50, 75, 100, 125, 150, 200, 250, 400, 500],
  IU: [100, 500, 1000, 2000, 5000, 10000, 50000],
  units: [1, 2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 40],
  mmol: [5, 10, 20, 40],
  drop: [1, 2, 3, 4, 5],
  puff: [1, 2, 3, 4],
};
export const amountsFor = (unit: string) => AMOUNTS[unit] ?? [1, 2, 3];

const FORM_DEFAULTS: Array<[RegExp, DoseUnit, string]> = [
  [/tablet|lozenge/i, 'tab', 'PO'],
  [/capsule/i, 'cap', 'PO'],
  [/syrup|suspension|solution|oral drops|mouthwash|elixir|liquid/i, 'ml', 'PO'],
  [/sachet|granule|powder for oral/i, 'sachet', 'PO'],
  [/infusion|fluid/i, 'ml', 'IV'],
  [/injection|vial|ampoule/i, 'mg', 'IV'],
  [/eye/i, 'drop', 'EYE'],
  [/ear/i, 'drop', 'EAR'],
  [/nasal/i, 'drop', 'NASAL'],
  [/nebuli/i, 'ml', 'NEB'],
  [/inhaler/i, 'puff', 'INH'],
  [/suppositor/i, 'suppository', 'PR'],
  [/pessary/i, 'pessary', 'PV'],
  [/patch/i, 'patch', 'TD'],
  [/cream|ointment|gel|lotion/i, 'application', 'TOP'],
  [/vaccine/i, 'ml', 'IM'],
];

/** Sensible starting unit and route for an item, from its dosage form. */
export function defaultsForForm(form?: string | null): { unit: DoseUnit; route: string } {
  const hit = FORM_DEFAULTS.find(([re]) => re.test(form ?? ''));
  return hit ? { unit: hit[1], route: hit[2] } : { unit: 'tab', route: 'PO' };
}

/** "500mg" → { amount: 500, unit: 'mg' } (strength in mg, g or mcg); null for other strengths. */
function strengthMg(strength?: string | null) {
  const m = (strength ?? '').replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)(mg|g|mcg)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'g' ? n * 1000 : m[2].toLowerCase() === 'mcg' ? n / 1000 : n;
}

const toMg = (amount: number, unit: string) => (unit === 'mg' ? amount : unit === 'g' ? amount * 1000 : unit === 'mcg' ? amount / 1000 : null);

/**
 * Suggested dispense quantity (in stock units) for dose × frequency × days, when it can be worked out:
 * countable doses (1 tab TDS × 5 days = 15), or mg/g doses of tablets/capsules with a known strength
 * (1 g of 500mg tabs = 2 tabs). Null when it cannot (liquids, PRN, …): the prescriber then chooses.
 */
export function suggestQuantity(l: { amount: number; unit: string; frequency: string; days: number; strength?: string | null; form?: string | null }) {
  const f = FREQUENCIES.find((x) => x.code === l.frequency);
  if (!f || !l.amount) return null;
  let unitsPerDose: number | null = null;
  if ((COUNTABLE as string[]).includes(l.unit)) unitsPerDose = l.amount;
  else if (/tablet|capsule/i.test(l.form ?? '')) {
    const per = strengthMg(l.strength);
    const mg = toMg(l.amount, l.unit);
    if (per && mg) unitsPerDose = mg / per;
  }
  if (unitsPerDose == null) return null;
  if (f.code === 'STAT') return Math.ceil(unitsPerDose);
  if (f.perDay == null || !l.days) return null;
  return Math.ceil(unitsPerDose * f.perDay * l.days);
}

export const fmtAmount = (n: number) => (n === 0.25 ? '¼' : n === 0.5 ? '½' : n === 1.5 ? '1½' : String(n));
export const unitLabel = (unit: string, amount: number) => (['tab', 'cap', 'sachet', 'drop', 'puff', 'application', 'suppository', 'pessary', 'patch', 'vial', 'ampoule'].includes(unit) && amount > 1 ? `${unit}s` : unit);

/** "1 g" / "500mg" / "0.5 tab" → { amount, unit } for the dose picker (unit defaults to tab). */
export function parseDose(s?: string | null, fallbackUnit: string = 'tab'): { amount: number | ''; unit: string } {
  const m = (s ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/);
  if (!m) return { amount: '', unit: fallbackUnit };
  const unit = (DOSE_UNITS as readonly string[]).find((u) => u.toLowerCase() === m[2].toLowerCase()) ?? m[2].replace(/s$/, '');
  return { amount: Number(m[1]), unit };
}
