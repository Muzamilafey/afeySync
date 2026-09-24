/** Obstetric calculations and rule-based alerts (decision support; clinical judgement prevails). */
export const DAY = 86400_000;

/** Naegele's rule: EDD = LMP + 280 days. */
export const eddFromLmp = (lmp: Date) => new Date(lmp.getTime() + 280 * DAY);

export function gestation(lmp?: Date | null, at: Date = new Date()) {
  if (!lmp) return null;
  const days = Math.floor((at.getTime() - new Date(lmp).getTime()) / DAY);
  if (days < 0) return null;
  return { weeks: Math.floor(days / 7), days: days % 7, totalDays: days };
}

export function assessRisk(input: { ageYears?: number; gravida?: number; para?: number; riskFactors?: string[]; obstetricHistory?: Array<{ mode?: string | null; outcome?: string | null; complications?: string | null }> }) {
  const reasons: string[] = [...(input.riskFactors ?? [])];
  if (input.ageYears !== undefined && input.ageYears < 18) reasons.push('Adolescent pregnancy (<18)');
  if (input.ageYears !== undefined && input.ageYears > 35) reasons.push('Advanced maternal age (>35)');
  if ((input.para ?? 0) >= 5) reasons.push('Grand multiparity (para ≥5)');
  if ((input.gravida ?? 0) === 1) reasons.push('Primigravida');
  const hist = input.obstetricHistory ?? [];
  if (hist.some((h) => /c.?s|caesar|cesar/i.test(h.mode ?? ''))) reasons.push('Previous caesarean section');
  if (hist.some((h) => /still|neonatal death|iufd/i.test(h.outcome ?? ''))) reasons.push('Previous stillbirth / neonatal death');
  if (hist.some((h) => /pph|haemorrhage|hemorrhage|eclampsia/i.test(h.complications ?? ''))) reasons.push('Previous PPH / eclampsia');
  const high = reasons.some((r) => /caesarean|stillbirth|pph|eclampsia|hiv|diabet|hypertens|cardiac|sickle|twin|multiple|placenta|<18|grand/i.test(r));
  return { riskLevel: (high ? 'high' : reasons.length ? 'moderate' : 'low') as 'low' | 'moderate' | 'high', reasons };
}

export function ancFlags(v: { systolic?: number; diastolic?: number; haemoglobin?: number; urineProtein?: string; fetalHeartRate?: number; gestationWeeks?: number }) {
  const f: string[] = [];
  if ((v.systolic ?? 0) >= 140 || (v.diastolic ?? 0) >= 90) f.push('Hypertension in pregnancy — assess for pre-eclampsia');
  if (v.urineProtein && !/neg|nil|trace/i.test(v.urineProtein) && ((v.systolic ?? 0) >= 140 || (v.diastolic ?? 0) >= 90)) f.push('Proteinuria with hypertension');
  if (v.haemoglobin !== undefined && v.haemoglobin < 11) f.push(v.haemoglobin < 7 ? 'Severe anaemia' : 'Anaemia (Hb < 11)');
  if (v.fetalHeartRate !== undefined && (v.fetalHeartRate < 110 || v.fetalHeartRate > 160)) f.push('Abnormal fetal heart rate');
  return f;
}

/**
 * Partograph alerts (WHO modified partograph): active phase from 4 cm; alert line = 1 cm/hour from the
 * first active-phase dilation; action line = 4 hours to the right of the alert line.
 */
export function partographAlerts(entry: { at: Date; cervicalDilationCm?: number; fetalHeartRate?: number; systolic?: number; diastolic?: number; temperatureC?: number; liquor?: string; maternalPulse?: number }, activePhaseAt?: Date | null, activeStartDilation = 4) {
  const alerts: string[] = [];
  if (activePhaseAt && entry.cervicalDilationCm !== undefined) {
    const hours = (entry.at.getTime() - activePhaseAt.getTime()) / 3600_000;
    const alertLine = Math.min(10, activeStartDilation + hours);
    const actionLine = Math.min(10, activeStartDilation + Math.max(0, hours - 4));
    if (hours > 4 && entry.cervicalDilationCm < actionLine) alerts.push('ACTION LINE crossed — prolonged labour: review for augmentation/CS/referral');
    else if (entry.cervicalDilationCm < alertLine) alerts.push('Alert line crossed — slow progress');
  }
  if (entry.fetalHeartRate !== undefined && (entry.fetalHeartRate < 110 || entry.fetalHeartRate > 160)) alerts.push('Abnormal fetal heart rate');
  if ((entry.systolic ?? 0) >= 160 || (entry.diastolic ?? 0) >= 110) alerts.push('Severe hypertension');
  if ((entry.temperatureC ?? 0) >= 38) alerts.push('Maternal fever');
  if ((entry.maternalPulse ?? 0) > 120) alerts.push('Maternal tachycardia');
  if (entry.liquor && /meconium|m\b|blood/i.test(entry.liquor)) alerts.push('Meconium / blood-stained liquor');
  return alerts;
}

/**
 * Kenya Expanded Programme on Immunization (KEPI) routine schedule (ages in days). Regional vaccines
 * (e.g. malaria RTS,S, yellow fever) are included but only apply where the county programme offers them.
 */
export const KEPI_SCHEDULE: Array<{ vaccine: string; dose: number; ageDays: number; regional?: boolean }> = [
  { vaccine: 'BCG', dose: 1, ageDays: 0 },
  { vaccine: 'OPV', dose: 0, ageDays: 0 },
  { vaccine: 'OPV', dose: 1, ageDays: 42 },
  { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: 1, ageDays: 42 },
  { vaccine: 'PCV10', dose: 1, ageDays: 42 },
  { vaccine: 'Rotavirus', dose: 1, ageDays: 42 },
  { vaccine: 'OPV', dose: 2, ageDays: 70 },
  { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: 2, ageDays: 70 },
  { vaccine: 'PCV10', dose: 2, ageDays: 70 },
  { vaccine: 'Rotavirus', dose: 2, ageDays: 70 },
  { vaccine: 'OPV', dose: 3, ageDays: 98 },
  { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: 3, ageDays: 98 },
  { vaccine: 'PCV10', dose: 3, ageDays: 98 },
  { vaccine: 'IPV', dose: 1, ageDays: 98 },
  { vaccine: 'Vitamin A', dose: 1, ageDays: 183 },
  { vaccine: 'Malaria (RTS,S)', dose: 1, ageDays: 183, regional: true },
  { vaccine: 'Malaria (RTS,S)', dose: 2, ageDays: 213, regional: true },
  { vaccine: 'Measles-Rubella', dose: 1, ageDays: 274 },
  { vaccine: 'Yellow Fever', dose: 1, ageDays: 274, regional: true },
  { vaccine: 'Malaria (RTS,S)', dose: 3, ageDays: 274, regional: true },
  { vaccine: 'Vitamin A', dose: 2, ageDays: 365 },
  { vaccine: 'Measles-Rubella', dose: 2, ageDays: 548 },
  { vaccine: 'Malaria (RTS,S)', dose: 4, ageDays: 730, regional: true },
];

export function immunizationStatus(dob: Date | null | undefined, given: Array<{ vaccine: string; dose?: number | null; givenAt?: Date | null }>) {
  if (!dob) return [];
  const now = Date.now();
  return KEPI_SCHEDULE.map((s) => {
    const g = given.find((x) => x.vaccine === s.vaccine && (x.dose ?? 1) === s.dose);
    const due = new Date(new Date(dob).getTime() + s.ageDays * DAY);
    return { ...s, dueDate: due, givenAt: g?.givenAt ?? null, status: g ? 'given' : due.getTime() > now ? 'upcoming' : now - due.getTime() > 28 * DAY ? 'overdue' : 'due' };
  });
}

export function nextDueFor(vaccine: string, dose: number, dob?: Date | null) {
  if (!dob) return undefined;
  const next = KEPI_SCHEDULE.find((s) => s.vaccine === vaccine && s.dose === dose + 1);
  return next ? new Date(new Date(dob).getTime() + next.ageDays * DAY) : undefined;
}

/** MUAC nutrition classification for children 6–59 months. */
export function muacStatus(muacCm?: number, ageMonths?: number) {
  if (muacCm === undefined || ageMonths === undefined || ageMonths < 6 || ageMonths > 59) return undefined;
  return muacCm < 11.5 ? 'Severe acute malnutrition' : muacCm < 12.5 ? 'Moderate acute malnutrition' : 'Normal';
}

/** Default return interval by family-planning method (days). */
export const FP_RETURN_DAYS: Record<string, number | undefined> = { coc_pills: 28, pop_pills: 28, injectable_dmpa: 91, implant: 1095, iucd: 3650, condoms: 30, emergency_pill: undefined, btl: undefined, vasectomy: 90, lam: 180, natural: 90, counselling_only: undefined };
