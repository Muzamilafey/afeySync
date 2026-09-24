import type { TenantModels } from '../../models/tenant';

/**
 * Starter clinical catalogs. Reference ranges are common adult/paediatric defaults and MUST be reviewed
 * and adjusted by each facility's laboratory (analyser- and population-specific). Prices are not seeded:
 * every facility sets its own price lists.
 */
type R = { sex?: 'any' | 'male' | 'female'; ageMinDays?: number; ageMaxDays?: number; low?: number; high?: number; criticalLow?: number; criticalHigh?: number; text?: string };
const num = (code: string, name: string, unit: string, ranges: R[]) => ({ code, name, unit, type: 'numeric' as const, ranges });
const opt = (code: string, name: string, options: string[], normal: string) => ({ code, name, type: 'option' as const, options, ranges: [{ text: normal }] });
const ADULT = 18 * 365;

export const DEFAULT_LAB_TESTS = [
  {
    code: 'FBC', name: 'Full Blood Count', department: 'Haematology', specimen: 'Whole blood (EDTA)', container: 'Purple top', turnaroundMinutes: 60,
    parameters: [
      num('HB', 'Haemoglobin', 'g/dL', [{ sex: 'male', ageMinDays: ADULT, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 }, { sex: 'female', ageMinDays: ADULT, low: 12, high: 15.5, criticalLow: 7, criticalHigh: 20 }, { ageMaxDays: ADULT, low: 11, high: 16, criticalLow: 7 }]),
      num('WBC', 'White cell count', 'x10^9/L', [{ low: 4, high: 11, criticalLow: 2, criticalHigh: 30 }]),
      num('PLT', 'Platelets', 'x10^9/L', [{ low: 150, high: 400, criticalLow: 50, criticalHigh: 1000 }]),
      num('HCT', 'Haematocrit', '%', [{ sex: 'male', low: 40, high: 52 }, { sex: 'female', low: 36, high: 48 }]),
      num('MCV', 'MCV', 'fL', [{ low: 80, high: 100 }]),
    ],
  },
  { code: 'MPS', name: 'Malaria Parasites (BS for MPS)', department: 'Parasitology', specimen: 'Whole blood', turnaroundMinutes: 30, parameters: [opt('MPS', 'Malaria parasites', ['Not seen', 'Seen +', 'Seen ++', 'Seen +++'], 'Not seen')] },
  { code: 'MRDT', name: 'Malaria RDT', department: 'Parasitology', specimen: 'Whole blood', turnaroundMinutes: 20, parameters: [opt('MRDT', 'Malaria RDT', ['Negative', 'Positive'], 'Negative')] },
  { code: 'RBS', name: 'Random Blood Sugar', department: 'Chemistry', specimen: 'Capillary/venous blood', turnaroundMinutes: 15, parameters: [num('GLU', 'Glucose (random)', 'mmol/L', [{ low: 3.9, high: 7.8, criticalLow: 2.5, criticalHigh: 25 }])] },
  { code: 'FBS', name: 'Fasting Blood Sugar', department: 'Chemistry', specimen: 'Venous blood', turnaroundMinutes: 30, parameters: [num('FGLU', 'Glucose (fasting)', 'mmol/L', [{ low: 3.9, high: 5.6, criticalLow: 2.5, criticalHigh: 25 }])] },
  {
    code: 'UEC', name: 'Urea, Electrolytes & Creatinine', department: 'Chemistry', specimen: 'Serum', container: 'Red/Yellow top', turnaroundMinutes: 120,
    parameters: [
      num('NA', 'Sodium', 'mmol/L', [{ low: 135, high: 145, criticalLow: 120, criticalHigh: 160 }]),
      num('K', 'Potassium', 'mmol/L', [{ low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 }]),
      num('CL', 'Chloride', 'mmol/L', [{ low: 98, high: 107 }]),
      num('UREA', 'Urea', 'mmol/L', [{ low: 2.5, high: 7.8 }]),
      num('CREA', 'Creatinine', 'µmol/L', [{ sex: 'male', low: 62, high: 115 }, { sex: 'female', low: 53, high: 97 }]),
    ],
  },
  { code: 'HIV', name: 'HIV Rapid Test', department: 'Serology', specimen: 'Whole blood', turnaroundMinutes: 30, parameters: [opt('HIV', 'HIV 1/2', ['Non-reactive', 'Reactive', 'Inconclusive'], 'Non-reactive')] },
  { code: 'VDRL', name: 'VDRL / RPR', department: 'Serology', specimen: 'Serum', turnaroundMinutes: 60, parameters: [opt('VDRL', 'VDRL', ['Non-reactive', 'Reactive'], 'Non-reactive')] },
  { code: 'HCG', name: 'Pregnancy Test (Urine hCG)', department: 'Serology', specimen: 'Urine', turnaroundMinutes: 15, parameters: [opt('HCG', 'Urine hCG', ['Negative', 'Positive'], 'Negative')] },
  { code: 'GXM', name: 'Blood Group & Rhesus', department: 'Blood Transfusion', specimen: 'Whole blood (EDTA)', turnaroundMinutes: 30, parameters: [opt('ABO', 'ABO group', ['A', 'B', 'AB', 'O'], ''), opt('RH', 'Rhesus', ['Positive', 'Negative'], '')] },
  {
    code: 'URINALYSIS', name: 'Urinalysis', department: 'Microbiology', specimen: 'Urine', turnaroundMinutes: 30,
    parameters: [opt('UPRO', 'Protein', ['Negative', 'Trace', '+', '++', '+++'], 'Negative'), opt('UGLU', 'Glucose', ['Negative', 'Trace', '+', '++', '+++'], 'Negative'), opt('ULEU', 'Leucocytes', ['Negative', 'Trace', '+', '++', '+++'], 'Negative'), opt('UNIT', 'Nitrites', ['Negative', 'Positive'], 'Negative')],
  },
  { code: 'STOOL', name: 'Stool for O/C', department: 'Parasitology', specimen: 'Stool', turnaroundMinutes: 45, parameters: [{ code: 'STOOL', name: 'Findings', type: 'text' as const, ranges: [] }] },
];

export const DEFAULT_IMAGING_EXAMS = [
  { code: 'XR-CHEST', name: 'Chest X-ray (PA)', modality: 'XR', bodyPart: 'Chest' },
  { code: 'XR-ABD', name: 'Abdominal X-ray', modality: 'XR', bodyPart: 'Abdomen' },
  { code: 'XR-LIMB', name: 'Limb X-ray', modality: 'XR', bodyPart: 'Extremity' },
  { code: 'US-OBS', name: 'Obstetric Ultrasound', modality: 'US', bodyPart: 'Pelvis' },
  { code: 'US-ABD', name: 'Abdominal Ultrasound', modality: 'US', bodyPart: 'Abdomen' },
  { code: 'US-PELVIC', name: 'Pelvic Ultrasound', modality: 'US', bodyPart: 'Pelvis' },
  { code: 'CT-HEAD', name: 'CT Head (non-contrast)', modality: 'CT', bodyPart: 'Head', requiresPreauth: true },
  { code: 'MR-BRAIN', name: 'MRI Brain', modality: 'MR', bodyPart: 'Head', requiresPreauth: true },
  { code: 'ECG', name: '12-lead ECG', modality: 'ECG', bodyPart: 'Chest' },
];

export async function seedTenantCatalogs(m: TenantModels) {
  for (const t of DEFAULT_LAB_TESTS) await m.LabTest.updateOne({ code: t.code }, { $setOnInsert: t }, { upsert: true });
  for (const e of DEFAULT_IMAGING_EXAMS) await m.ImagingExam.updateOne({ code: e.code }, { $setOnInsert: e }, { upsert: true });
  // One default dispensing location per branch.
  const branches = await m.Branch.find({}).select('_id branchName').lean();
  for (const b of branches) {
    if (!(await m.StockLocation.exists({ branchId: b._id }))) {
      await m.StockLocation.create([{ name: `${b.branchName} Pharmacy`, branchId: b._id, type: 'pharmacy' }, { name: `${b.branchName} Main Store`, branchId: b._id, type: 'store' }]);
    }
  }
}
