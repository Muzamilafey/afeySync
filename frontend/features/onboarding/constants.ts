export const COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii',
  'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok',
  'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

export const FACILITY_TYPES = ['Hospital', 'Medical Centre', 'Health Centre', 'Dispensary', 'Clinic', 'Nursing Home', 'Maternity Home', 'Dental Clinic', 'Eye Clinic', 'Laboratory', 'Imaging Centre', 'Pharmacy'];
export const FACILITY_LEVELS = ['Level 2', 'Level 3', 'Level 3A', 'Level 3B', 'Level 4', 'Level 5', 'Level 6'];
export const OWNERSHIP = ['Private', 'Faith-based', 'NGO', 'Public', 'Community'];
export const HEARD_FROM = ['Referral from another facility', 'Search engine', 'Social media', 'Event or conference', 'AfeySync team', 'Other'];

export type PlanKey = 'trial' | 'basic' | 'standard' | 'premium';
export const PLAN_COPY: Record<PlanKey, { tagline: string; features: string[]; highlight?: boolean }> = {
  trial: { tagline: 'Explore everything, no commitment', features: ['All clinical & billing modules', 'Up to 2 branches, 15 users', '30 days, then choose a plan'] },
  basic: { tagline: 'Single clinics and dispensaries', features: ['Front desk, OPD, pharmacy, billing', '1 branch, 20 users', 'Email support'] },
  standard: { tagline: 'Growing hospitals & medical centres', features: ['Lab, radiology, inpatient, maternity', 'Up to 3 branches, 60 users', 'SHA, M-Pesa & insurance workflows'], highlight: true },
  premium: { tagline: 'Multi-branch hospital groups', features: ['Everything in Standard', 'Up to 10 branches, 250 users', 'Priority onboarding & support'] },
};

export const INTEREST_COPY: Record<string, { label: string; desc: string }> = {
  sha: { label: 'SHA claims', desc: 'Eligibility, pre-authorization and eClaims via the DHA HIE' },
  dha: { label: 'DHA HIE', desc: 'Client Registry, terminology and shared health records' },
  mpesa: { label: 'M-Pesa', desc: 'STK push, paybill reconciliation and refunds' },
  sms: { label: 'SMS', desc: 'Appointment reminders and patient notifications' },
  insurance: { label: 'Private insurance', desc: 'Slade360 eligibility, claims and remittances' },
  laboratory: { label: 'Laboratory', desc: 'Orders, results and verification' },
  pharmacy: { label: 'Pharmacy & stores', desc: 'Dispensing, stock and procurement' },
  inpatient: { label: 'Inpatient', desc: 'Wards, beds, nursing and discharge' },
  maternity: { label: 'Maternity & MCH', desc: 'ANC, delivery, immunization and FP' },
  radiology: { label: 'Radiology', desc: 'Imaging worklists and reports' },
};
