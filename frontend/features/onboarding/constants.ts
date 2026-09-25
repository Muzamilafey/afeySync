export const COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii',
  'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok',
  'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

export const FACILITY_TYPES = ['Hospital', 'Medical Centre', 'Health Centre', 'Dispensary', 'Clinic', 'Nursing Home', 'Maternity Home', 'Dental Clinic', 'Eye Clinic', 'Laboratory', 'Imaging Centre', 'Pharmacy'];
export const FACILITY_LEVELS = ['Level 2', 'Level 3', 'Level 3A', 'Level 3B', 'Level 4', 'Level 5', 'Level 6'];
export const OWNERSHIP = ['Private', 'Faith-based', 'NGO', 'Public', 'Community'];
export const HEARD_FROM = ['Referral from another facility', 'Search engine', 'Social media', 'Event or conference', 'AfeySync team', 'Other'];

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
