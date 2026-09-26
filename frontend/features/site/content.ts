import {
  Baby, BarChart3, BedDouble, Bell, Building2, CalendarDays, ClipboardList, CreditCard, FileCheck2, FileText, FlaskConical,
  HeartPulse, KeyRound, Landmark, Layers, Pill, Printer, Radiation, ScanLine, ShieldCheck, Smartphone, Stethoscope, Upload,
  UserPlus, Users, Wallet, WifiOff, Smile, Archive, ShoppingBag, Warehouse, FileSignature, Briefcase, Send, Package, type LucideIcon,
} from 'lucide-react';

export interface Feature { icon: LucideIcon; title: string; text: string }
export interface FeatureGroup { id: string; title: string; summary: string; items: Feature[] }

/** Everything below describes what AfeySync actually does today. Keep it that way: no claims the product cannot back. */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'front-desk',
    title: 'Front desk & patient flow',
    summary: 'Register patients once, book them in, and move them through the facility without paper.',
    items: [
      { icon: UserPlus, title: 'Patient registration', text: 'One record per patient with IDs, next of kin, payer and nationality, plus duplicate checks.' },
      { icon: CalendarDays, title: 'Appointments', text: 'List and calendar views, service and practitioner booking, free-slot picking, repeat courses and export.' },
      { icon: ClipboardList, title: 'Visits & queues', text: 'Open a visit, send the patient to triage, the doctor, the lab or the pharmacy, and see every queue live.' },
      { icon: Bell, title: 'Emergency & referrals', text: 'Fast emergency registration and referrals in and out, with the details the next facility needs.' },
    ],
  },
  {
    id: 'clinical',
    title: 'Clinical care',
    summary: 'Structured notes that clinicians can fill quickly and that stay locked once finalised.',
    items: [
      { icon: HeartPulse, title: 'Triage & vitals', text: 'Vitals with normal ranges, BMI and flags, recorded against the visit.' },
      { icon: Stethoscope, title: 'Consultation', text: 'History, examination, ICD-coded diagnoses, orders and procedures in one clinical note.' },
      { icon: Pill, title: 'Prescribing', text: 'Pick-list dose, frequency, route and duration, checked on the server, straight to the pharmacy, with a printable prescription note.' },
      { icon: FileSignature, title: 'Medical reports & certificates', text: 'Sick leave notes, medical reports, fitness certificates and attendance letters, signed with the clinician’s licence number and locked once issued.' },
      { icon: Smile, title: 'Dental & specialist clinics', text: 'Dental charting and procedures alongside general outpatient care.' },
    ],
  },
  {
    id: 'diagnostics',
    title: 'Laboratory & imaging',
    summary: 'Orders arrive from the clinician; results go back to the patient record.',
    items: [
      { icon: FlaskConical, title: 'Laboratory', text: 'Sample collection, result entry with normal ranges, verification and printable reports.' },
      { icon: Package, title: 'Test packages & walk-in requests', text: 'Priced test profiles, plus walk-in patients and requests from outside doctors, billed straight away.' },
      { icon: Radiation, title: 'Radiology', text: 'Imaging requests, billing, reporting and printable reports linked to the visit.' },
    ],
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy & stores',
    summary: 'Know what is on the shelf, what it costs and what was dispensed.',
    items: [
      { icon: Pill, title: 'Dispensing', text: 'Outpatient, ward and discharge prescriptions in their own queues, dispensed earliest-expiry first.' },
      { icon: ShoppingBag, title: 'Pharmacy POS', text: 'Counter sales for walk-in customers and outside prescriptions, with barcode scanning, returns and a daily Z-report.' },
      { icon: Layers, title: 'Inventory & procurement', text: 'Brands and pack units, batches and expiry, suppliers, LPOs from the low-stock list and goods received.' },
      { icon: Warehouse, title: 'Stores & stock takes', text: 'Requisitions with approval, printed stock-take sheets with variances, and a stock movement report.' },
      { icon: Upload, title: 'Excel import', text: 'Bring in your drug and item lists from Excel, up to thousands of rows at a time.' },
    ],
  },
  {
    id: 'inpatient',
    title: 'Wards, maternity & mortuary',
    summary: 'Admissions, nursing and discharge, with one active admission per patient.',
    items: [
      { icon: BedDouble, title: 'Admissions & wards', text: 'Beds, transfers, nursing notes, ward rounds and the ward medication round.' },
      { icon: FileCheck2, title: 'Discharge', text: 'Final diagnoses, discharge summary and bill clearance before the patient leaves.' },
      { icon: Baby, title: 'Maternity & MCH', text: 'Antenatal, delivery, postnatal and family planning records, with printable birth notifications.' },
      { icon: Archive, title: 'Mortuary', text: 'Body admission, storage, release and related charges.' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing, payments & claims',
    summary: 'Every service is priced on the server. The browser never decides what a patient owes.',
    items: [
      { icon: Wallet, title: 'Price lists', text: 'Separate cash, SHA, insurance and foreigner prices for every service and item.' },
      { icon: CreditCard, title: 'Cashier & M-Pesa', text: 'Invoices, receipts, deposits, waivers and M-Pesa STK push, confirmed by Safaricom callback.' },
      { icon: Landmark, title: 'SHA claims', text: 'Claim preparation and tracking through the official SHA integration once your facility is onboarded by SHA.' },
      { icon: ShieldCheck, title: 'Private insurance', text: 'Schemes, pre-authorisations and claims, with remittances reconciled against invoices.' },
      { icon: Briefcase, title: 'Corporates, copay & capitation', text: 'Employer and insurance schemes with their own price lists, fixed or percentage copay, and capitation schemes where the patient pays only the copay.' },
    ],
  },
  {
    id: 'management',
    title: 'Management & reporting',
    summary: 'See how the facility is doing and keep the back office in the same system.',
    items: [
      { icon: BarChart3, title: 'Reports & dashboards', text: 'Collections, visits, diagnoses, stock and more, for any date range.' },
      { icon: Users, title: 'Staff, roles & HR', text: 'Users with exactly the permissions their role needs, plus staff records and duty rosters.' },
      { icon: Building2, title: 'Multiple branches', text: 'Run several branches under one facility with branch-level access control.' },
      { icon: Printer, title: 'Branded printouts', text: 'Receipts, reports, prescriptions and notifications printed on your own letterhead with your logo.' },
      { icon: Send, title: 'SMS alerts & bulk SMS', text: 'Appointment and result alerts, plus bulk health reminders to chosen patients. Patients who declined SMS are always left out.' },
    ],
  },
];

export const HIGHLIGHTS: Feature[] = [
  { icon: Building2, title: 'Your own private database', text: 'Every facility is kept in its own database and web address. One facility can never see another’s data.' },
  { icon: KeyRound, title: 'Strong sign-in', text: 'One secure sign-in page, with two-step verification by passkey, authenticator app, email or SMS.' },
  { icon: Smartphone, title: 'Works on any device', text: 'Use it on a desktop at reception, a tablet on the ward or a phone, and install it like an app.' },
  { icon: WifiOff, title: 'Built for real connections', text: 'Light pages that load quickly on ordinary Kenyan internet.' },
  { icon: FileText, title: 'Records you can trust', text: 'Finalised clinical records are locked, and every change is written to an audit trail.' },
  { icon: ScanLine, title: 'Ready for integrations', text: 'SHA, M-Pesa, SMS and insurance connections through their official channels.' },
];

export const FAQ: { q: string; a: string }[] = [
  { q: 'What is AfeySync (Afey HMIS)?', a: 'AfeySync, also called Afey HMIS, is a cloud hospital management information system made for Kenyan health facilities. It runs reception, clinical care, laboratory, pharmacy, wards, maternity, billing, M-Pesa payments and SHA and insurance claims in one secure system at afey.co.ke.' },
  { q: 'What kind of facilities can use AfeySync?', a: 'Hospitals, medical centres, clinics, nursing and maternity homes, dental clinics and faith-based facilities of any level in Kenya. You turn on the modules you need.' },
  { q: 'Do we need to install anything?', a: 'No. AfeySync runs in the web browser on computers, tablets and phones. You can also install it on a device like an app.' },
  { q: 'Is our patient data kept separate from other facilities?', a: 'Yes. Every facility has its own database and its own web address, and every request is checked against your facility. Staff only see what their role allows.' },
  { q: 'Does AfeySync work with SHA?', a: 'AfeySync supports SHA claims through the official integration. Your facility connects once it has been onboarded by SHA and has its own credentials. We never use unofficial routes.' },
  { q: 'Can patients pay with M-Pesa?', a: 'Yes. Cashiers can send an M-Pesa prompt to the patient’s phone. A payment is only recorded once Safaricom confirms it.' },
  { q: 'Can we bring in our existing drug list?', a: 'Yes. Upload your items from an Excel file. Thousands of rows can be imported in one go.' },
  { q: 'How do we get started?', a: 'Click “Get started”, fill in your facility details and verify your email. We will email you as soon as your facility is ready. You can also call us on 0722 651 888.' },
];
