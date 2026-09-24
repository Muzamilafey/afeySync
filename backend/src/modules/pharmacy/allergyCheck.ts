/**
 * Allergy decision support. Matches recorded allergy substances against the prescribed drug name,
 * generic name and common drug classes. This is a safety net, NOT an exhaustive interaction database:
 * clinicians remain responsible for allergy review. Overrides require a documented reason (audited).
 */
const CLASSES: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'benzylpenicillin', 'phenoxymethylpenicillin', 'piperacillin', 'co-amoxiclav', 'augmentin', 'benzathine'],
  cephalosporin: ['cef', 'ceph'],
  sulfonamide: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septrin', 'sulfadoxine', 'fansidar', 'sulfasalazine'],
  sulfa: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septrin', 'sulfadoxine', 'fansidar'],
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'indomethacin', 'meloxicam', 'piroxicam', 'ketorolac', 'mefenamic', 'celecoxib'],
  aspirin: ['aspirin', 'acetylsalicylic'],
  quinolone: ['floxacin'],
  fluoroquinolone: ['floxacin'],
  macrolide: ['azithromycin', 'erythromycin', 'clarithromycin'],
  tetracycline: ['tetracycline', 'doxycycline', 'oxytetracycline', 'minocycline'],
  opioid: ['morphine', 'codeine', 'tramadol', 'pethidine', 'fentanyl', 'oxycodone', 'dihydrocodeine'],
  artemisinin: ['artemether', 'artesunate', 'artemisinin', 'coartem', 'dihydroartemisinin'],
};

export function allergyConflicts(allergies: Array<{ substance?: string | null }>, drugNames: string[]): string[] {
  const names = drugNames.filter(Boolean).map((s) => s.toLowerCase());
  const hits: string[] = [];
  for (const a of allergies) {
    const sub = a.substance?.toLowerCase().trim();
    if (!sub) continue;
    const key = Object.keys(CLASSES).find((k) => sub.includes(k) || k.includes(sub));
    const needles = [sub, ...(key ? CLASSES[key] : [])];
    if (names.some((n) => needles.some((needle) => n.includes(needle)) || (sub.length > 3 && sub.includes(n)))) hits.push(a.substance!);
  }
  return [...new Set(hits)];
}
