import {
  Baby, BarChart3, BedDouble, Bell, Building2, CalendarDays, ClipboardList, CreditCard, FileCheck2, FileText, FlaskConical,
  HeartPulse, KeyRound, Landmark, Layers, Pill, Printer, Radiation, ScanLine, ShieldCheck, Smartphone, Stethoscope, Upload,
  UserPlus, Users, Wallet, WifiOff, Smile, Archive, type LucideIcon,
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
      { icon: Pill, title: 'Prescribing', text: 'Pick-list dose, frequency, route and duration, checked on the server, straight to the pharmacy.' },
      { icon: Smile, title: 'Dental & specialist clinics', text: 'Dental charting and procedures alongside general outpatient care.' },
    ],
  },
  {
    id: 'diagnostics',
    title: 'Laboratory & imaging',
    summary: 'Orders arrive from the clinician; results go back to the patient record.',
    items: [
      { icon: FlaskConical, title: 'Laboratory', text: 'Sample collection, result entry with reference ranges, verification and printable reports.' },
      { icon: Radiation, title: 'Radiology', text: 'Imaging requests, reporting and results linked to the visit.' },
    ],
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy & stores',
    summary: 'Know what is on the shelf, what it costs and what was dispensed.',
    items: [
      { icon: Pill, title: 'Dispensing', text: 'Prescriptions arrive from the doctor and ward; pharmacists dispense against stock.' },
      { icon: Layers, title: 'Inventory & procurement', text: 'Items, batches, stock levels, suppliers, purchase orders and goods received.' },
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

/** The user guide, section by section. Each step is something a user actually does in AfeySync. */
export const GUIDE: { id: string; title: string; intro: string; steps: { title: string; text: string }[] }[] = [
  {
    id: 'register',
    title: '1. Register your facility',
    intro: 'Registration is done online and takes about five minutes.',
    steps: [
      { title: 'Open the registration page', text: 'Click “Get started” on this website. You will be taken to accounts.afey.co.ke/get-started.' },
      { title: 'Choose a plan', text: 'Pick the plan that fits your facility. You can change it later from your subscription page.' },
      { title: 'Enter your facility details', text: 'Facility name, type, level, county and phone number. Choose your web address, for example mynursinghome.afey.co.ke.' },
      { title: 'Add your branches', text: 'Add at least one branch. Each branch gets a short code such as MAIN or TOWN.' },
      { title: 'Create the administrator', text: 'Enter the details of the person who will manage users, prices and settings, and choose a strong password.' },
      { title: 'Verify your email', text: 'Enter the 6-digit code sent to the administrator’s email. Your application is then reviewed and you are emailed as soon as your facility is ready.' },
    ],
  },
  {
    id: 'sign-in',
    title: '2. Sign in securely',
    intro: 'All staff sign in on one page, accounts.afey.co.ke, and are then taken to their facility.',
    steps: [
      { title: 'Go to the sign-in page', text: 'Open accounts.afey.co.ke, or your facility’s own address. It will send you to the sign-in page automatically.' },
      { title: 'Enter your email and password', text: 'If you work in more than one facility, choose the one you want to open.' },
      { title: 'Confirm it is you', text: 'If two-step verification is on, confirm with your passkey, authenticator app, or the code sent by email or SMS.' },
      { title: 'Set up two-step verification', text: 'Open Security under My account and add a passkey or an authenticator app. Administrators can require this for all staff.' },
      { title: 'Forgot your password?', text: 'Click “Forgot password?” on the sign-in page and follow the link sent to your email.' },
    ],
  },
  {
    id: 'setup',
    title: '3. Set up your facility',
    intro: 'The administrator does this once, before staff start using the system.',
    steps: [
      { title: 'Add your logo and details', text: 'Open Branding. Your logo and details appear on every printout.' },
      { title: 'Create users and roles', text: 'Open Users & Roles. Give each person only the access their job needs, such as reception, nurse, clinician, lab, pharmacy or cashier.' },
      { title: 'Set your prices', text: 'Open Services & Prices. Enter cash, SHA, insurance and foreigner prices for each service. Patients are billed from these automatically.' },
      { title: 'Load your stock', text: 'Open Inventory and use Import. Upload your drugs and items from Excel, then set opening stock and prices.' },
      { title: 'Connect M-Pesa, SMS and insurance', text: 'Open Integrations. Enter the credentials issued to your facility by Safaricom, your SMS provider or the insurer.' },
    ],
  },
  {
    id: 'visit',
    title: '4. A patient’s visit',
    intro: 'This is how a typical outpatient visit moves through AfeySync.',
    steps: [
      { title: 'Reception', text: 'Search for the patient or register a new one, choose how they will pay, and start the visit.' },
      { title: 'Triage', text: 'The nurse records vitals. Abnormal values are flagged.' },
      { title: 'Consultation', text: 'The clinician records history, examination and diagnoses, then orders tests and prescribes from the pick-lists.' },
      { title: 'Lab & radiology', text: 'Orders appear in the lab and radiology queues. Results are verified and sent back to the clinician.' },
      { title: 'Pharmacy', text: 'The pharmacist sees the prescription, dispenses from stock, and the item is added to the bill.' },
      { title: 'Cashier', text: 'The bill is built from your price list. Take cash or M-Pesa, print the receipt, and close the visit.' },
    ],
  },
  {
    id: 'inpatient',
    title: '5. Admissions & maternity',
    intro: 'For facilities with beds.',
    steps: [
      { title: 'Admit', text: 'Admit from a visit to a ward and bed. A patient can only have one active admission at a time.' },
      { title: 'Ward care', text: 'Record nursing notes, ward rounds and the medication round. Transfer beds when needed.' },
      { title: 'Maternity', text: 'Record deliveries, register the baby and print the birth notification: two copies on one A4 page, one for the parent and one for the facility.' },
      { title: 'Discharge', text: 'Enter the final diagnoses, complete the discharge summary and clear the bill.' },
    ],
  },
  {
    id: 'reports',
    title: '6. Reports & claims',
    intro: 'Keep an eye on the numbers and get paid for your work.',
    steps: [
      { title: 'Daily reports', text: 'Open Reports, choose a report and a date range. Print or export it.' },
      { title: 'Insurance & SHA claims', text: 'Claims are prepared from the visit and bill. A claim is only marked paid when the payment is received, not when it is approved.' },
      { title: 'Audit trail', text: 'Administrators can see who did what and when.' },
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: 'What kind of facilities can use AfeySync?', a: 'Hospitals, medical centres, clinics, nursing and maternity homes, dental clinics and faith-based facilities of any level in Kenya. You turn on the modules you need.' },
  { q: 'Do we need to install anything?', a: 'No. AfeySync runs in the web browser on computers, tablets and phones. You can also install it on a device like an app.' },
  { q: 'Is our patient data kept separate from other facilities?', a: 'Yes. Every facility has its own database and its own web address, and every request is checked against your facility. Staff only see what their role allows.' },
  { q: 'Does AfeySync work with SHA?', a: 'AfeySync supports SHA claims through the official integration. Your facility connects once it has been onboarded by SHA and has its own credentials. We never use unofficial routes.' },
  { q: 'Can patients pay with M-Pesa?', a: 'Yes. Cashiers can send an M-Pesa prompt to the patient’s phone. A payment is only recorded once Safaricom confirms it.' },
  { q: 'Can we bring in our existing drug list?', a: 'Yes. Upload your items from an Excel file. Thousands of rows can be imported in one go.' },
  { q: 'How do we get started?', a: 'Click “Get started”, fill in your facility details and verify your email. We will email you as soon as your facility is ready. You can also call us on 0722 651 888.' },
];
