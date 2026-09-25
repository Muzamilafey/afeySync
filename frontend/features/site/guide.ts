import {
  Archive, Baby, BarChart3, BedDouble, Boxes, CalendarDays, ClipboardList, CreditCard, FlaskConical, HeartHandshake, HeartPulse,
  IdCard, KeyRound, Landmark, LifeBuoy, MessageSquareText, Pill, Printer, Receipt, Rocket, ScanLine, Settings, ShieldCheck, ShoppingCart,
  Smile, Stethoscope, UserPlus, UserRound, Users, Wallet, type LucideIcon,
} from 'lucide-react';

/**
 * The AfeySync user guide. Every step names the menus, tabs and buttons exactly as they appear in the
 * app, so a new user can follow along on screen. Keep it in step with the product when screens change.
 */
export interface GuideStep { title: string; text: string }
export interface GuideSection { title: string; intro?: string; steps: GuideStep[]; tips?: string[] }
export interface GuideTopic { slug: string; title: string; group: string; icon: LucideIcon; summary: string; who: string; where: string; sections: GuideSection[] }

export const GUIDE_GROUPS = ['Getting started', 'Patients & front desk', 'Clinical care', 'Diagnostics & pharmacy', 'Wards & specialist care', 'Money & claims', 'Management', 'Help'] as const;

export const GUIDE_TOPICS: GuideTopic[] = [
  /* ------------------------------------------------------------------ Getting started */
  {
    slug: 'register-your-facility',
    title: 'Register your facility',
    group: 'Getting started',
    icon: Rocket,
    summary: 'Create your facility on AfeySync online in about five minutes and get your own web address.',
    who: 'Facility owner, director or administrator',
    where: 'afey.co.ke → Get started (accounts.afey.co.ke/get-started)',
    sections: [
      {
        title: 'Before you start',
        intro: 'Have these ready so registration goes smoothly:',
        steps: [
          { title: 'Facility details', text: 'The facility name, type (for example clinic, medical centre, hospital or nursing home), level, county and sub-county, physical address and main phone number. Your KMPDC/MFL facility code and registration number are optional but useful.' },
          { title: 'Branches', text: 'The name of each branch and a short code for it (for example MAIN, TOWN or KITALE). You can add more branches later.' },
          { title: 'The administrator', text: 'The name, email, phone number and job title of the person who will manage the system. This person creates the other users.' },
        ],
      },
      {
        title: 'Fill in the registration form',
        steps: [
          { title: 'Open the registration page', text: 'On afey.co.ke click “Get started”. You are taken to accounts.afey.co.ke/get-started. If you picked a plan on the Pricing page, it is already selected.' },
          { title: 'Choose a plan', text: 'Pick the plan that fits your facility. The free trial lets you try everything first. You can change the plan later under Subscription.' },
          { title: 'Enter the facility details', text: 'Fill in the facility section. As you type the name, AfeySync suggests a web address such as mynursinghome.afey.co.ke and tells you straight away if it is free. You can edit it.' },
          { title: 'Add branches', text: 'Enter at least one branch with its code. Use “Add branch” for more.' },
          { title: 'Create the administrator account', text: 'Enter the administrator’s details and choose a strong password (at least 10 characters; longer is better).' },
          { title: 'Tell us what you need', text: 'Tick the services you are interested in (SHA, M-Pesa, SMS, insurance, laboratory and so on) and roughly how many users you expect.' },
          { title: 'Review and accept', text: 'Check the summary, tick the declaration and submit.' },
        ],
      },
      {
        title: 'Verify and wait for approval',
        steps: [
          { title: 'Enter the email code', text: 'A 6-digit code is sent to the administrator’s email. Type it in. If it has not arrived after a minute, check spam, then use “Resend”.' },
          { title: 'Application submitted', text: 'Your application is reviewed by the AfeySync team. You can close the page; use “Check status” to see progress at any time from the same browser.' },
          { title: 'Facility ready', text: 'When approved you receive an email with your facility’s web address. Sign in with the administrator email and the password you chose.' },
        ],
        tips: ['Your draft is saved in the browser, so you can come back and finish later.', 'A web address that is already taken, or reserved (such as accounts, owner or app), cannot be used. Choose another.'],
      },
    ],
  },
  {
    slug: 'signing-in',
    title: 'Signing in and two-step verification',
    group: 'Getting started',
    icon: KeyRound,
    summary: 'How everyone signs in on accounts.afey.co.ke, keeps the account safe and recovers access.',
    who: 'Everyone',
    where: 'accounts.afey.co.ke, or your facility address',
    sections: [
      {
        title: 'Sign in',
        steps: [
          { title: 'Open your facility address', text: 'Go to your facility’s address (for example ndabibi.afey.co.ke) or straight to accounts.afey.co.ke. Facility addresses send you to the secure sign-in page automatically.' },
          { title: 'Enter your email and password', text: 'Type the email your administrator registered for you and your password, then click “Sign in”.' },
          { title: 'Choose a facility (if asked)', text: 'If you work in more than one facility on AfeySync, pick the one you want to open.' },
          { title: 'Confirm it is you', text: 'If two-step verification is on, confirm with your passkey, your authenticator app code, or the code sent by email or SMS.' },
          { title: 'You are in', text: 'You are taken back to your facility, already signed in. The link that carries you across works once, only in the same browser, and expires within a minute.' },
        ],
      },
      {
        title: 'Your first sign-in',
        steps: [
          { title: 'Set your password', text: 'New users receive a welcome email with a “Choose your password” link. Open it, choose a password and sign in.' },
          { title: 'Set up two-step verification', text: 'If your facility requires it, you are asked to add a passkey or an authenticator app straight away. Follow the steps on screen.' },
        ],
      },
      {
        title: 'Set up two-step verification',
        intro: 'Two-step verification stops someone who learns your password from getting in.',
        steps: [
          { title: 'Open Security', text: 'In the menu, under “My account”, click “Security”.' },
          { title: 'Add a passkey (recommended)', text: 'Choose “Passkey” and confirm with your phone’s fingerprint or face, or your computer’s PIN. Next time you only need to touch your fingerprint.' },
          { title: 'Or add an authenticator app', text: 'Choose “Authenticator app”, scan the QR code with Google Authenticator, Microsoft Authenticator or similar, then type the 6-digit code it shows.' },
          { title: 'Keep your recovery codes', text: 'Save or print the recovery codes you are shown. Each works once if you lose your phone.' },
        ],
      },
      {
        title: 'Forgot your password?',
        steps: [
          { title: 'Request a reset link', text: 'On the sign-in page click “Forgot password?”, enter your email and submit.' },
          { title: 'Open the email', text: 'Click the link in the email (it expires after a short time) and choose a new password.' },
          { title: 'Still stuck?', text: 'Your administrator can use “Reset password” or “Reset 2-step” for you under Users & Roles.' },
        ],
        tips: ['Never share your password or codes, even with colleagues or AfeySync staff. We will never ask for them.', 'Always sign out on shared computers: click “Sign out” in the menu.', 'The message “That sign-in link had expired” means the hand-over took too long or was opened in another browser. Simply sign in again.'],
      },
    ],
  },
  {
    slug: 'my-account',
    title: 'My profile, security and leave',
    group: 'Getting started',
    icon: UserRound,
    summary: 'Update your own details, change your password, see where you are signed in and request leave.',
    who: 'Everyone',
    where: 'Menu → My account → My profile / Security',
    sections: [
      {
        title: 'My profile',
        steps: [
          { title: 'Open My profile', text: 'In the menu, under “My account”, click “My profile”.' },
          { title: 'Update your details', text: 'Under “Personal details” correct your full name and phone. Your email is your sign-in and can only be changed by an administrator.' },
          { title: 'Save', text: 'Click “Save changes”.' },
        ],
      },
      {
        title: 'Change your password',
        steps: [
          { title: 'Open Security', text: 'In the menu, under “My account”, click “Security”.' },
          { title: 'Enter passwords', text: 'Type your current password, then the new password twice.' },
          { title: 'Update', text: 'Click “Update password”. Other devices stay signed in until you use “Sign out all other devices”.' },
        ],
      },
      {
        title: 'Request leave',
        steps: [
          { title: 'Open the leave form', text: 'Scroll down My profile to your leave card and click “Request leave”.' },
          { title: 'Fill it in', text: 'Choose the type, the dates (From / To) and the reason, then submit.' },
          { title: 'Track it', text: 'Your request shows as Pending until HR approves or rejects it.' },
        ],
      },
    ],
  },
  {
    slug: 'facility-setup',
    title: 'Set up your facility (administrators)',
    group: 'Getting started',
    icon: Settings,
    summary: 'Branding, branches, users and roles, diagnoses, integrations, security and the audit trail.',
    who: 'Facility administrator',
    where: 'Administration menu: Branches, Users & Roles, Integrations, Audit Trail, Security, Branding, Diagnoses',
    sections: [
      {
        title: 'Add your logo and colours',
        steps: [
          { title: 'Open Branding', text: 'Go to “Branding”.' },
          { title: 'Upload the logo', text: 'Under “Logo” upload a PNG (transparent background is best) or JPEG. It appears on the sign-in page and at the top of every printout: receipts, invoices, lab reports, prescriptions, discharge summaries and birth notifications.' },
          { title: 'Name and message', text: 'Set the display name, tagline and an optional sign-in message for your staff.' },
          { title: 'Brand colour', text: 'Pick your colour or click “Use AfeySync green”, then “Save branding”.' },
        ],
      },
      {
        title: 'Branches',
        steps: [
          { title: 'Open Branches', text: 'Go to “Branches” and click “ADD BRANCH”.' },
          { title: 'Fill in the branch', text: 'Enter the name, code, county, address, phone and bed capacity, then save.' },
          { title: 'Switch branch', text: 'Staff with access to several branches choose the branch they are working in from the branch selector at the top.' },
        ],
      },
      {
        title: 'Users and roles',
        intro: 'Give every person their own account with only the access their job needs.',
        steps: [
          { title: 'Add a user', text: 'Open “Users & Roles” → “Users” → “Add user”. Enter the full name, email and phone. For clinical staff add the cadre and licence number.' },
          { title: 'Choose roles', text: 'Pick one or more roles such as Receptionist, Nurse, Clinician, Lab technologist, Pharmacist, Cashier or Administrator.' },
          { title: 'Choose branch access', text: 'Choose “All branches” or “Specific branches”, then save. The user receives a welcome email with a link to choose a password.' },
          { title: 'Create a custom role', text: 'Under “Roles” click “Create role”, name it, tick exactly the permissions needed and choose the scope. Useful for mixed jobs such as “Nurse & cashier”.' },
          { title: 'Help a user', text: 'Open the user to “Reset password”, “Reset 2-step” (for a lost phone) or deactivate someone who has left.' },
        ],
      },
      {
        title: 'Diagnoses list',
        steps: [
          { title: 'Open Diagnoses', text: 'Go to “Diagnoses”. This is the list clinicians pick from (ICD-10 / ICD-11 / local).' },
          { title: 'Add or import', text: 'Use “Add diagnosis” for one, or “Import from Excel” for many.' },
        ],
      },
      {
        title: 'Integrations',
        intro: 'Connect services using the credentials issued to your facility.',
        steps: [
          { title: 'Open Integrations', text: 'Go to “Integrations” and click “Configure” on M-Pesa, SMS, SHA or an insurer.' },
          { title: 'Enter your credentials', text: 'Enter the keys issued to your facility by Safaricom, your SMS provider, SHA or the insurer. Choose the environment (sandbox for testing, production for real use).' },
          { title: 'Test', text: 'Click “Test connection”. Credentials are stored encrypted and are never shown in full again.' },
        ],
        tips: ['AfeySync connects only through official channels. SHA connections need your facility to be onboarded by SHA first.'],
      },
      {
        title: 'Security settings and audit trail',
        steps: [
          { title: 'Security', text: 'Under “Security” choose who must use two-step verification, whether staff may sign in with Google, and approve, decline or revoke AfeySync support access requests. Support staff can only enter your facility with your permission and for a limited time.' },
          { title: 'Audit Trail', text: '“Audit Trail” is an append-only record of important actions: sign-ins, changes to records, payments and more. Filter it and open any entry for details.' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ Patients & front desk */
  {
    slug: 'front-desk',
    title: 'Front desk: register, check in and emergencies',
    group: 'Patients & front desk',
    icon: UserPlus,
    summary: 'Find or register patients, avoid duplicates, check them in and register emergencies fast.',
    who: 'Receptionists and front-office staff',
    where: 'Front Desk',
    sections: [
      {
        title: 'Find a patient first',
        steps: [
          { title: 'Open Front Desk', text: 'Go to “Front Desk” → “Register / Find Patient”.' },
          { title: 'Search', text: 'Type the name, phone, ID number or AFS patient number. Matching patients appear as you type.' },
          { title: 'Open the patient', text: 'If the patient is listed, click “Open patient”. Always search before registering to avoid duplicate records.' },
        ],
      },
      {
        title: 'Register a new patient',
        steps: [
          { title: 'Start registration', text: 'If nobody matches, click “Register patient” to open “New Patient Registration”.' },
          { title: 'Check the national registry (optional)', text: 'Search the DHA Client Registry by ID to fill in verified details where your facility is connected.' },
          { title: 'Enter details', text: 'First name, last name, sex, date of birth, phone, county, sub-county and ward/village. Add identifiers (National ID, SHA number, birth certificate and so on) with “Add identifier”.' },
          { title: 'Next of kin and insurance', text: 'Add the next of kin and, if the patient is insured, the insurance provider and member number.' },
          { title: 'Save', text: 'Click “Register patient”. If AfeySync finds the same person already registered it shows “PATIENT ALREADY EXISTS”; open that record instead of creating a new one.' },
        ],
      },
      {
        title: 'Check in / walk-in',
        steps: [
          { title: 'Open Check-in', text: 'Go to “Front Desk” → “Check-in / Walk-in”, or click “Check in” on the patient’s page.' },
          { title: 'Choose the visit type and payer', text: 'Pick the visit type and how the patient pays: Cash, SHA, Insurance or Corporate. For SHA use “Check eligibility” first; for insurance choose the scheme and member number.' },
          { title: 'Send the patient', text: 'Choose where the patient goes next (usually Triage), set the priority (Normal, Urgent or Emergency) and click “Check in”.' },
          { title: 'Already has an open visit?', text: 'If the patient already has an open visit you are told so; click “Open visit” to continue that one instead.' },
        ],
      },
      {
        title: 'Emergency registration',
        steps: [
          { title: 'Open Emergency', text: 'Go to “Front Desk” → “Emergency”. Only the essentials are needed.' },
          { title: 'Enter what you know', text: 'First name if known, last name, sex and estimated age, who brought the patient, what happened and the presenting complaint.' },
          { title: 'Register', text: 'Click “Register emergency”. The patient goes straight to the emergency queue. Complete the full details later.' },
        ],
      },
    ],
  },
  {
    slug: 'patient-records',
    title: 'Patient records',
    group: 'Patients & front desk',
    icon: Users,
    summary: 'Search patients, view their history, update contacts and identifiers, and manage insurance.',
    who: 'Reception, clinicians, nurses and records staff',
    where: 'Patients',
    sections: [
      {
        title: 'Find and open a patient',
        steps: [
          { title: 'Search', text: 'Go to “Patients” and search by name, phone, ID or patient number.' },
          { title: 'Open the record', text: 'Click the patient. Tabs show the Overview, visits, SHA eligibility, insurance and national registry details.' },
          { title: 'Read the timeline', text: 'The “Patient timeline” lists visits, admissions, results and payments in order.' },
        ],
      },
      {
        title: 'Update details',
        steps: [
          { title: 'Contacts and address', text: 'Use “Update contact & address”, correct the phone or address and click “Save changes”.' },
          { title: 'Identifiers', text: 'Under “Identifiers” add or correct ID numbers, SHA numbers and so on.' },
          { title: 'Insurance', text: 'On the Insurance tab click “Add insurance”, choose the provider and scheme, and enter the member number, principal member and relationship. Click “Save insurance”.' },
        ],
      },
      {
        title: 'From the patient page you can also',
        steps: [
          { title: 'Check in', text: 'Click “Check in” to start a visit.' },
          { title: 'Book an appointment', text: 'Click “Book appointment”.' },
          { title: 'Start an SHA visit', text: 'Click “Start SHA visit” for SHA-covered care.' },
          { title: 'Link from another branch', text: 'If the patient was registered at another branch, use “Link to my branch” so you can serve them here.' },
        ],
      },
    ],
  },
  {
    slug: 'appointments',
    title: 'Appointments',
    group: 'Patients & front desk',
    icon: CalendarDays,
    summary: 'Book patients by service or practitioner, pick free slots, set repeat courses and check patients in.',
    who: 'Reception and clinicians',
    where: 'Appointments',
    sections: [
      {
        title: 'See your appointments',
        steps: [
          { title: 'Open Appointments', text: 'Go to “Appointments”. Choose Today, Upcoming, Past or All.' },
          { title: 'List or calendar', text: 'Switch the view to a list or a weekly calendar. Use “Previous week” and “Next week” to move around.' },
          { title: 'Filter and search', text: 'Filter by status, service or practitioner, or search by patient.' },
          { title: 'Export', text: 'Export the list to share or print a day’s schedule.' },
        ],
      },
      {
        title: 'Book an appointment',
        steps: [
          { title: 'Start with the patient', text: 'Click book, search for the patient and click “Book” next to them (or register them first).' },
          { title: 'Book by service or practitioner', text: 'Under “Book by” choose a service (for example physiotherapy or dental) or a specific practitioner.' },
          { title: 'Pick a date and a free slot', text: 'Choose the date and duration, then click a free time. Slots already taken are not offered, and a patient cannot be double-booked.' },
          { title: 'Repeat course (optional)', text: 'For a course of sessions set “Number of sessions” and “Repeat every” (for example weekly). AfeySync books them all and warns about clashes.' },
          { title: 'Reason and notes', text: 'Add the reason for the visit and any notes, then save.' },
        ],
      },
      {
        title: 'On the day',
        steps: [
          { title: 'Check in', text: 'When the patient arrives click “Check in”. A visit opens and the patient joins the queue.' },
          { title: 'No-show or cancel', text: 'Use “No-show” if the patient did not come, or “Cancel” if the appointment is called off.' },
        ],
      },
    ],
  },
  {
    slug: 'queues-and-visits',
    title: 'Queues and the patient visit',
    group: 'Patients & front desk',
    icon: ClipboardList,
    summary: 'Call patients from the queue, move them between departments and follow the whole visit.',
    who: 'Nurses, clinicians and all service points',
    where: 'Triage Queue, OPD Consultation, and each visit page',
    sections: [
      {
        title: 'Work a queue',
        steps: [
          { title: 'Open your queue', text: 'Go to “Triage Queue” or “OPD Consultation”. The counters show Waiting, Called / in service, Emergency and Served today. Emergencies are shown first.' },
          { title: 'Call the next patient', text: 'Click “Call”, then “Start” when the patient is with you.' },
          { title: 'Do the work', text: 'Click “Vitals” to record vitals, or “Open” to open the visit.' },
          { title: 'Finish', text: 'Click “Complete” to send the patient to the next stage, or “Skip” if they are not there.' },
        ],
      },
      {
        title: 'The visit page',
        intro: 'Everything about one visit is in one place.',
        steps: [
          { title: 'Overview & Vitals', text: 'The “Patient journey” shows every stage the patient has passed. Use “Record vitals” at any time.' },
          { title: 'Consultation', text: 'The clinical note (see Consultation).' },
          { title: 'Orders', text: 'Lab, imaging and prescriptions ordered in this visit, with their progress and results.' },
          { title: 'Procedures & Referrals', text: 'Use “Add procedure” to record a procedure (and bill it), and “Refer” to refer internally to a department or to another facility.' },
          { title: 'Billing', text: 'See the bill as it builds up and click “Open invoice”.' },
          { title: 'Send to…', text: 'Send the patient to another department’s queue, for example the lab, pharmacy or cashier.' },
          { title: 'Close visit', text: 'When care is complete, click “Close visit”. A draft consultation must be finalised first.' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ Clinical */
  {
    slug: 'triage',
    title: 'Triage and vitals',
    group: 'Clinical care',
    icon: HeartPulse,
    summary: 'Record vitals with automatic flags and set the triage category.',
    who: 'Nurses and clinical officers',
    where: 'Triage Queue → Vitals',
    sections: [
      {
        title: 'Record vitals',
        steps: [
          { title: 'Call the patient', text: 'In “Triage Queue” click “Call”, then “Vitals”.' },
          { title: 'Enter the measurements', text: 'Temperature, pulse, blood pressure, respiratory rate, SpO₂, weight, height and so on. BMI is calculated for you.' },
          { title: 'Check the flags', text: 'Values outside the normal range are highlighted so abnormal results are not missed.' },
          { title: 'Triage category', text: 'Set the triage category and priority (Routine, Urgent or Emergency).' },
          { title: 'Save and send', text: 'Click “Save vitals”, then “Complete” to send the patient to consultation.' },
        ],
      },
    ],
  },
  {
    slug: 'consultation',
    title: 'Consultation, diagnoses and orders',
    group: 'Clinical care',
    icon: Stethoscope,
    summary: 'Write the clinical note, add ICD diagnoses, order tests and imaging, and finalise.',
    who: 'Doctors and clinical officers',
    where: 'OPD Consultation → Open → Consultation',
    sections: [
      {
        title: 'Write the note',
        steps: [
          { title: 'Start', text: 'Open the patient from “OPD Consultation” and click “Start consultation”. The triage vitals are shown at the top.' },
          { title: 'History and examination', text: 'Record the presenting complaint, history and examination findings.' },
          { title: 'Diagnoses', text: 'Search and add diagnoses from the diagnosis list (ICD coded). Use “Remove diagnosis” to correct mistakes.' },
          { title: 'Save as you go', text: 'Click “SAVE DRAFT” at any time. A draft can still be edited.' },
        ],
      },
      {
        title: 'Order tests, imaging and procedures',
        steps: [
          { title: 'Laboratory', text: 'Add the tests you need and set the priority: Routine, Urgent or STAT. Orders appear at once in the lab’s “To collect” list.' },
          { title: 'Imaging', text: 'Use “Request imaging”, choose the exam, add the clinical indication and priority.' },
          { title: 'Prescribe', text: 'Add medicines from the pharmacy stock (see Prescribing).' },
        ],
      },
      {
        title: 'Finish the consultation',
        steps: [
          { title: 'Follow-up', text: 'Set a follow-up date and notes if needed.' },
          { title: 'Finalise', text: 'Click “FINALIZE CONSULTATION”. The note is then locked, as clinical records must be.' },
          { title: 'Corrections later', text: 'To add information after finalising use “Add addendum”. The original note stays visible.' },
        ],
      },
    ],
  },
  {
    slug: 'prescribing',
    title: 'Prescribing medicines',
    group: 'Clinical care',
    icon: Pill,
    summary: 'Prescribe from the pharmacy’s own stock with pick-lists for dose, frequency, route and duration.',
    who: 'Prescribers',
    where: 'Consultation (or ward) → Prescription',
    sections: [
      {
        title: 'Add a medicine',
        steps: [
          { title: 'Search the drug', text: 'Click “Add drug from formulary (shows stock)” and type the name. You see what is in the pharmacy, with strength, form and stock.' },
          { title: 'Dose', text: 'Enter the dose amount and choose the dose unit (mg, ml, tablets and so on).' },
          { title: 'Frequency', text: 'Choose from the list: Once daily, Twice daily, Three times daily, Four times daily, Every 8/6/4 hours, At night, When required, Once immediately and more.' },
          { title: 'Route', text: 'Choose the route: Oral, Intravenous, Intramuscular, Subcutaneous, Topical, Inhaled, Rectal, Eye, Ear and others.' },
          { title: 'Duration and quantity', text: 'Choose for how many days. The quantity is suggested from dose × frequency × days; you can change it. Everything is checked again on the server.' },
          { title: 'Instructions and urgency', text: 'Add instructions (for example “after food”). On the ward, mark medicines needed immediately as STAT; they are highlighted in the pharmacy.' },
        ],
        tips: ['If the patient has a recorded allergy to the medicine you see an ALLERGY ALERT. You can only continue by giving a reason, which is recorded.', 'Where your facility is connected, “Send ePrescription” sends the prescription through the national system.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ Diagnostics & pharmacy */
  {
    slug: 'laboratory',
    title: 'Laboratory',
    group: 'Diagnostics & pharmacy',
    icon: FlaskConical,
    summary: 'From sample collection to verified, printable results, plus the lab test catalogue.',
    who: 'Lab technologists and lab managers',
    where: 'Laboratory',
    sections: [
      {
        title: 'Work through a request',
        intro: 'The Laboratory page has a tab for each step. A request moves along as you work.',
        steps: [
          { title: 'To collect', text: 'New requests from clinicians. Collect the sample and mark it collected; the label shows the specimen and container.' },
          { title: 'To receive', text: 'Confirm the sample has arrived in the lab. If it is unsuitable, click “Reject” and give the reason; it goes to “Rejected (recollect)”.' },
          { title: 'Processing', text: 'Samples being run.' },
          { title: 'Result entry', text: 'Click “Enter results”, type the values (reference ranges and flags appear automatically) and add a comment, then “Save results”.' },
          { title: 'To verify / To approve', text: 'A second person checks and verifies the results. Once verified they are sent back to the clinician and the patient record.' },
          { title: 'Print', text: 'Click “Print report” for a report on your letterhead.' },
        ],
      },
      {
        title: 'Manage the test catalogue',
        steps: [
          { title: 'Open the catalogue', text: 'Click “Test catalog”, then “Add test”.' },
          { title: 'Describe the test', text: 'Enter code, name, department, specimen, container, turnaround time (TAT) and the billing service code so the test is charged.' },
          { title: 'Parameters and ranges', text: 'Use “Add parameter” for each result (numeric, options or free text) and “Add range” for normal ranges by sex and age.' },
          { title: 'Import many tests', text: 'Use “Import from Excel” to load a whole catalogue at once.' },
        ],
      },
    ],
  },
  {
    slug: 'radiology',
    title: 'Radiology and imaging',
    group: 'Diagnostics & pharmacy',
    icon: ScanLine,
    summary: 'Schedule exams, report findings and release verified reports.',
    who: 'Radiographers and radiologists',
    where: 'Radiology',
    sections: [
      {
        title: 'From request to report',
        steps: [
          { title: 'Requested / scheduled', text: 'New imaging requests appear here. Filter by modality. Set the room and time and click “Save schedule”.' },
          { title: 'Start the exam', text: 'Click “Start exam” when the patient is in the room. It moves to “In progress”.' },
          { title: 'Write the report', text: 'Enter the findings and impression. If you use a PACS, paste the viewer link. Click “Save report”.' },
          { title: 'Verify and release', text: 'The reporting radiologist clicks “Verify & release”. The report goes to the clinician and the patient record.' },
          { title: 'Cancel', text: 'Use “Cancel request” with a reason if the exam will not be done.' },
        ],
      },
    ],
  },
  {
    slug: 'pharmacy',
    title: 'Pharmacy and dispensing',
    group: 'Diagnostics & pharmacy',
    icon: Pill,
    summary: 'Dispense prescriptions from stock, safely and in expiry order.',
    who: 'Pharmacists and pharmaceutical technologists',
    where: 'Pharmacy',
    sections: [
      {
        title: 'Dispense a prescription',
        steps: [
          { title: 'Open the list', text: 'Go to “Pharmacy” → “To dispense”. STAT requests waiting are shown at the top.' },
          { title: 'Check the patient', text: 'Open the prescription. Allergies are shown clearly. Check the dose, frequency and duration.' },
          { title: 'Choose the stock location', text: 'Under “Dispense from” choose the store or dispensing point.' },
          { title: 'Dispense', text: 'Click “Dispense (FEFO)”. AfeySync takes the batches that expire first, reduces the stock and adds the items to the patient’s bill.' },
          { title: 'History', text: 'The “Dispensed” tab lists what was given, by whom and when.' },
        ],
      },
      {
        title: 'Ward requests',
        steps: [
          { title: 'Ward medication', text: 'Medicines ordered on the wards arrive in the pharmacy the same way. Dispense them to the ward; nurses then record each dose on the medication chart (MAR).' },
        ],
      },
    ],
  },
  {
    slug: 'inventory',
    title: 'Inventory and stock',
    group: 'Diagnostics & pharmacy',
    icon: Boxes,
    summary: 'Items, prices, batches and expiry, receiving, transfers, adjustments and Excel import.',
    who: 'Store keepers and pharmacists',
    where: 'Inventory',
    sections: [
      {
        title: 'Add items',
        steps: [
          { title: 'New item', text: 'Go to “Inventory” → “Items” → “New item”. Enter the code, name, generic name, category, form, strength and unit.' },
          { title: 'Prices', text: 'Enter the selling price for each price list (cash, SHA, insurance, foreigner) and the billing service code.' },
          { title: 'Reorder level', text: 'Set the reorder level so the item shows under “Low stock items” before it runs out.' },
          { title: 'Import from Excel', text: 'For a whole drug list use “Import from Excel”: download the template, fill it in and upload. Thousands of rows can be imported at once; any row with a problem is listed so you can fix it and upload again.' },
        ],
      },
      {
        title: 'Receive, move and adjust stock',
        steps: [
          { title: 'Receive stock', text: 'Click “Receive”, choose the item and location, enter batch number, expiry date, quantity and the invoice / delivery note reference.' },
          { title: 'Transfer', text: 'Click “Transfer” to move stock to another location (for example from the main store to the pharmacy). Earliest-expiring stock is moved first (FEFO).' },
          { title: 'Adjust', text: 'For breakages or stock-take differences enter a quantity change (+/−) and a reason. Every adjustment is audited.' },
        ],
      },
      {
        title: 'Keep an eye on stock',
        steps: [
          { title: 'Stock on hand and value', text: 'The top of the page shows stock value, low stock items and items with expired stock.' },
          { title: 'Batches and expiry', text: 'The “Batches” and “Expiring (90d)” tabs show what will expire soon so you can use it first.' },
          { title: 'Ledger', text: 'The “Ledger” shows every movement: receipts, dispensing, transfers and adjustments.' },
        ],
      },
    ],
  },
  {
    slug: 'procurement',
    title: 'Procurement: suppliers and purchase orders',
    group: 'Diagnostics & pharmacy',
    icon: ShoppingCart,
    summary: 'Keep suppliers, raise and approve purchase orders and receive goods against them.',
    who: 'Procurement officers, store keepers and managers',
    where: 'Procurement',
    sections: [
      {
        title: 'Suppliers',
        steps: [
          { title: 'Add a supplier', text: 'Go to “Procurement” → “Suppliers” → “Supplier”. Enter the name and contacts and save.' },
        ],
      },
      {
        title: 'Purchase orders',
        steps: [
          { title: 'Create', text: 'Under “Purchase orders” click “Purchase order”, choose the supplier and “Deliver to” location, add the items and quantities and click “Create draft PO”.' },
          { title: 'Approve', text: 'A manager reviews it and clicks “Approve” (or “Cancel”).' },
          { title: 'Receive the goods', text: 'When the delivery arrives click “Receive (GRN)”, enter the delivery note, batch numbers, expiry dates and quantities received. Stock is updated straight away.' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ Wards & specialist */
  {
    slug: 'inpatient',
    title: 'Admissions, wards and discharge',
    group: 'Wards & specialist care',
    icon: BedDouble,
    summary: 'Wards and beds, admission, nursing care, medication rounds, transfers and discharge.',
    who: 'Nurses, doctors and ward managers',
    where: 'Inpatient',
    sections: [
      {
        title: 'Set up wards and beds',
        steps: [
          { title: 'Create a ward', text: 'Go to “Inpatient” → “Create ward”. Enter the name, code, type, gender and category, and the bed-day service code so bed charges are billed.' },
          { title: 'Add beds', text: 'Click “Add beds” and enter bed numbers separated by commas.' },
          { title: 'Bed board', text: 'The “Bed board” shows every bed: available, occupied or waiting to be cleaned. Click “Mark clean” when a bed is ready again.' },
        ],
      },
      {
        title: 'Admit a patient',
        steps: [
          { title: 'Start', text: 'Click “Admit patient” (or admit from the visit).' },
          { title: 'Details', text: 'Choose the patient, admission type (Elective or Emergency), payer, admission diagnosis, ward and bed, then “Admit”.' },
          { title: 'One admission at a time', text: 'A patient who is already admitted cannot be admitted again until discharged. You are told which ward and bed they are in, with “Open the current admission”.' },
        ],
      },
      {
        title: 'Care on the ward',
        steps: [
          { title: 'Notes & rounds', text: 'Add a “Nursing note”, “Doctor’s round”, “Progress note” or “Handover”.' },
          { title: 'Vitals', text: 'Record vitals through the day.' },
          { title: 'Fluid chart', text: 'Record intake and output; the 24-hour balance is calculated.' },
          { title: 'Medication orders', text: 'Doctors prescribe on the ward with the same pick-lists as in OPD. Orders go to the pharmacy.' },
          { title: 'Medication round (MAR)', text: 'On the “Medication (MAR)” tab each due dose is listed. Mark it “Given”, “Held”, “Refused” or “Missed” with a reason. Nothing is ever silently overwritten.' },
          { title: 'Transfer', text: 'Use “Transfer” to move the patient to another bed or ward and give the reason.' },
        ],
      },
      {
        title: 'Discharge',
        steps: [
          { title: 'Final diagnosis', text: 'Choose the final diagnosis from the diagnosis list.' },
          { title: 'Discharge summary', text: 'Write the summary, discharge medications, outcome and follow-up.' },
          { title: 'Discharge', text: 'Click “Discharge (bed-day charges posted)”. Bed-day charges are added to the bill and the bed becomes free for cleaning.' },
          { title: 'Print', text: 'Print the discharge summary on your letterhead for the patient.' },
        ],
      },
    ],
  },
  {
    slug: 'maternity',
    title: 'Maternity: ANC, labour, delivery and birth notification',
    group: 'Wards & specialist care',
    icon: Baby,
    summary: 'Antenatal care, the labour record and partograph, delivery, the newborn and printing the birth notification.',
    who: 'Midwives, nurses and doctors',
    where: 'Maternity',
    sections: [
      {
        title: 'Antenatal care',
        steps: [
          { title: 'Register the pregnancy', text: 'Go to “Maternity” → “Register pregnancy (ANC)”. Enter LMP (the EDD is worked out), gravida, para, blood group, HIV status and known risk factors.' },
          { title: 'ANC contacts', text: 'At each visit click “Record ANC contact” and set the next visit date.' },
        ],
      },
      {
        title: 'Labour',
        steps: [
          { title: 'Start the labour record', text: 'Click “Start labour record” when the mother is admitted in labour.' },
          { title: 'Partograph', text: 'Use “Add partograph entry” to record progress, maternal and fetal observations over time.' },
        ],
      },
      {
        title: 'Delivery and the newborn',
        steps: [
          { title: 'Record delivery', text: 'Click “Record delivery”: time delivered, mode (SVD, Caesarean section, Vacuum, Forceps, Breech), attendant, placenta, perineum and blood loss.' },
          { title: 'The baby', text: 'Record the newborn: sex, weight, outcome (Live birth, Fresh or Macerated stillbirth). For twins or more use “Add baby (multiple birth)”.' },
          { title: 'Register the baby', text: 'Use “Register” on the newborn record to create the baby’s own patient record.' },
        ],
      },
      {
        title: 'Birth notification',
        steps: [
          { title: 'Open Birth notifications', text: 'Go to the “Birth notifications” tab and open the baby.' },
          { title: 'Check the details', text: 'Confirm the child’s names, the mother’s and father’s names and ID numbers, and who the notification is issued to. Enter the official Form B1 serial number if you use one.' },
          { title: 'Print', text: 'Click “Print”. Two copies print on one A4 portrait page: one for the parent and one for the facility.' },
          { title: 'Corrections', text: 'Use “Correct” and give the reason. The correction is recorded; the original is not silently changed.' },
        ],
      },
    ],
  },
  {
    slug: 'mch-family-planning',
    title: 'MCH, immunisation and family planning',
    group: 'Wards & specialist care',
    icon: HeartHandshake,
    summary: 'Immunisation, growth monitoring, family planning and defaulter tracing.',
    who: 'MCH and family planning nurses',
    where: 'MCH / FP',
    sections: [
      {
        title: 'Immunisation and growth',
        steps: [
          { title: 'Immunization', text: 'Open the child, choose the vaccine due, enter the batch and click “Give”.' },
          { title: 'Growth monitoring', text: 'Record weight and height at each visit to follow the child’s growth.' },
          { title: 'Defaulters', text: 'The “Immunization defaulters” tab lists children who missed a vaccine so you can follow them up.' },
        ],
      },
      {
        title: 'Family planning',
        steps: [
          { title: 'Record a visit', text: 'Click “Record FP visit”. Choose the visit type (New, Revisit, Switch or Removal), the method, the quantity or cycles and the counselling given.' },
          { title: 'Defaulters', text: 'The “FP defaulters” tab lists clients who have not returned when due.' },
        ],
      },
    ],
  },
  {
    slug: 'dental',
    title: 'Dental',
    group: 'Wards & specialist care',
    icon: Smile,
    summary: 'The dental chart (FDI), examination, diagnosis and treatment plans with billing.',
    who: 'Dentists and dental officers',
    where: 'Dental',
    sections: [
      {
        title: 'A dental visit',
        steps: [
          { title: 'Open a visit', text: 'Go to “Dental” → “Dental visit” and choose the patient.' },
          { title: 'Chart the teeth', text: 'On the “Dental chart (FDI)” click a tooth and record its condition.' },
          { title: 'Examination and diagnosis', text: 'Record the examination, diagnosis and notes.' },
          { title: 'Treatment plan', text: 'Add treatment items; mark them “Done” when performed so they are billed. Use “Add unbilled item” for anything not charged.' },
          { title: 'Save', text: 'Click “Save visit”.' },
        ],
      },
    ],
  },
  {
    slug: 'mortuary',
    title: 'Mortuary',
    group: 'Wards & specialist care',
    icon: Archive,
    summary: 'Admit bodies, track storage, bill and release to next of kin.',
    who: 'Mortuary attendants and administrators',
    where: 'Mortuary',
    sections: [
      {
        title: 'Admit a body',
        steps: [
          { title: 'Start', text: 'Go to “Mortuary” → “Admit body”.' },
          { title: 'Details', text: 'Choose whether the death was in the facility (select the registered patient) or brought in dead. Enter name, sex, age, ID, date/time and place of death and cause of death.' },
          { title: 'Next of kin and storage', text: 'Enter the next of kin, relationship, phone and ID, and the chamber and tray. Click “Admit”.' },
        ],
      },
      {
        title: 'Release',
        steps: [
          { title: 'Authorise', text: 'Click “Authorize release (posts storage charges)”. Storage charges are added to the bill.' },
          { title: 'Settle the bill', text: 'If a bill is outstanding you are told; use “Open bill” to settle it at the cashier.' },
          { title: 'Release', text: 'Click “Release body”, enter who it is released to, their ID number and the burial permit number.' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ Money */
  {
    slug: 'services-and-prices',
    title: 'Services and price lists',
    group: 'Money & claims',
    icon: Receipt,
    summary: 'Set prices once for cash, SHA, insurance and foreign patients; every bill uses them automatically.',
    who: 'Administrators and finance',
    where: 'Services & Prices',
    sections: [
      {
        title: 'Add services',
        steps: [
          { title: 'Open Services & Prices', text: 'Go to “Services & Prices” and click “Add service”.' },
          { title: 'Describe it', text: 'Enter the code, name, category and department (for example Consultation, Laboratory, Procedure, Bed-day).' },
          { title: 'Set the prices', text: 'Enter a price for each list: Cash, SHA, Insurance and Foreigner. Foreign patients paying cash are billed from the Foreigner list automatically.' },
          { title: 'SHA code', text: 'For SHA-covered services enter the SHA intervention code so claims are coded correctly.' },
          { title: 'Scheme prices', text: 'For an insurer with its own tariff use “Add scheme-specific price”.' },
        ],
      },
      {
        title: 'Load everything at once',
        steps: [
          { title: 'Import from Excel', text: 'Click “Import from Excel”, download the template, fill in your services and prices and upload. Problem rows are listed for you to correct.' },
        ],
        tips: ['Prices are always worked out by the server from these lists. A bill cannot be changed by editing numbers in the browser.'],
      },
    ],
  },
  {
    slug: 'billing-and-cashier',
    title: 'Billing, cashier and M-Pesa',
    group: 'Money & claims',
    icon: CreditCard,
    summary: 'Invoices, taking payments (cash, M-Pesa, card, bank), receipts, waivers, credit notes and refunds.',
    who: 'Cashiers and finance staff',
    where: 'Billing & Cashier',
    sections: [
      {
        title: 'The bill builds itself',
        intro: 'Consultations, tests, medicines, procedures and bed-days are added to the visit’s bill as they happen, priced from your price list.',
        steps: [
          { title: 'Find the bill', text: 'Go to “Billing & Cashier”, search the patient and open the invoice (or click “Open invoice” on the visit).' },
          { title: 'Check the charges', text: 'Review the charges and totals. “Reprice” updates a draft bill if prices changed.' },
          { title: 'Issue the invoice', text: 'Click “Issue invoice” when the bill is final.' },
          { title: 'Walk-in sales', text: 'For over-the-counter sales use “New invoice”, choose the patient or enter the customer’s phone, add services and “Create invoice”.' },
        ],
      },
      {
        title: 'Take a payment',
        steps: [
          { title: 'Receive payment', text: 'Click “Receive payment” and choose the method: Cash, M-Pesa, Card, Bank or Insurance.' },
          { title: 'M-Pesa prompt (STK push)', text: 'Enter the patient’s phone and click “Send STK push”. The patient types their M-Pesa PIN on their phone. The payment is recorded only when Safaricom confirms it.' },
          { title: 'M-Pesa already paid', text: 'If the patient paid to your till or paybill, choose “M-Pesa (enter receipt)” and type the M-Pesa receipt code.' },
          { title: 'Print the receipt', text: 'Click “Receipt” or “Print” to print on your letterhead.' },
        ],
      },
      {
        title: 'Discounts, corrections and refunds',
        steps: [
          { title: 'Discount / waiver', text: 'Click “Discount / waiver”, enter the amount and a reason. Reasons are required and audited.' },
          { title: 'Credit note', text: 'To reduce an issued invoice use “Credit note” with the reason.' },
          { title: 'Refund', text: 'Click “Refund”, choose the refund method (cash or “Pay out via M-Pesa”) and the reason.' },
          { title: 'Void', text: 'A wrong invoice can be voided with a reason; it stays on record as void.' },
        ],
      },
      {
        title: 'End of day',
        steps: [
          { title: 'Collections today', text: 'The top of the page shows today’s collections and what is outstanding.' },
          { title: 'Payment reconciliation', text: 'Unmatched M-Pesa payments are listed under “Payment Reconciliation”; use “Allocate here” to attach them to the right invoice.' },
        ],
      },
    ],
  },
  {
    slug: 'sha-claims',
    title: 'SHA: eligibility, visits, preauthorisation and claims',
    group: 'Money & claims',
    icon: Landmark,
    summary: 'Check SHA eligibility, get member consent, request preauthorisation, submit claims and record payment.',
    who: 'Reception, claims officers and clinicians',
    where: 'SHA, SHA Visits, SHA Claims',
    sections: [
      {
        title: 'Before you start',
        steps: [
          { title: 'Facility connection', text: 'Your facility must be onboarded by SHA and your credentials entered under Integrations. AfeySync uses only the official SHA integration.' },
          { title: 'Emergency protocols', text: 'On the SHA page set up the emergency protocols and attending doctors your facility uses.' },
        ],
      },
      {
        title: 'Check eligibility',
        steps: [
          { title: 'Search', text: 'Go to “SHA”, choose the identification type, enter the number and click “CHECK”.' },
          { title: 'Read the result', text: 'You see whether the member is eligible. Use “VIEW BENEFITS” and “VIEW UTILIZATION” for details.' },
        ],
      },
      {
        title: 'Start an SHA visit',
        steps: [
          { title: 'Open the wizard', text: 'Click “Start SHA visit” on the patient, or go to “SHA Visits” → new.' },
          { title: 'Create the visit', text: 'Confirm the patient and click “Create SHA visit & continue to consent”.' },
          { title: 'Member consent', text: 'Get the member’s consent by OTP (“Send OTP”, then enter the code) or by SHA biometric verification, then “Verify & continue”.' },
          { title: 'Record services', text: 'Add the services given (“Add service”), each with its intervention, diagnosis and quantity.' },
        ],
      },
      {
        title: 'Preauthorisation',
        steps: [
          { title: 'Request', text: 'For services that need approval click “Request preauthorization”, add the clinical justification and estimated cost, then “Submit preauthorization”.' },
          { title: 'Follow up', text: 'Use “Refresh status” to see the decision. Respond to any questions from SHA with “Respond”.' },
        ],
      },
      {
        title: 'Submit and track claims',
        steps: [
          { title: 'Prepare', text: 'Go to “SHA Claims”. Open a draft, check the diagnosis codes and items, and use “Preview claim”.' },
          { title: 'Submit', text: 'Click “Submit to SHA”. For inpatients, discharging the patient sends the inpatient claim.' },
          { title: 'Status', text: 'Use “Refresh status”. If a claim needs correction click “Reopen for correction”, fix it and submit again.' },
          { title: 'Payment', text: 'When SHA pays, click “Record remittance” and enter the amount received. A claim is only marked paid when the money is received, never just because it was approved.' },
        ],
      },
    ],
  },
  {
    slug: 'insurance',
    title: 'Private insurance',
    group: 'Money & claims',
    icon: ShieldCheck,
    summary: 'Payers, member verification, benefit reservation, claims, attachments, remittances and reconciliation.',
    who: 'Insurance desk and claims officers',
    where: 'Insurance, Insurance Claims, Remittances, Payers',
    sections: [
      {
        title: 'Set up payers',
        steps: [
          { title: 'Payer directory', text: 'Go to “Payers” → “Add payer”. Enter the name, payer code and type (for example Slade360 or direct insurer).' },
          { title: 'Sync', text: 'If you use Slade360 click “Sync from Slade360” to load the payers and schemes.' },
          { title: 'Code mappings', text: 'Under “Code mappings” map your service and diagnosis codes to what the insurer expects (for example ICD-10), then “Save mapping”.' },
        ],
      },
      {
        title: 'Verify the member and start the visit',
        steps: [
          { title: 'Add insurance to the patient', text: 'On the patient’s Insurance tab click “Add insurance”, choose the provider and scheme and enter the member details.' },
          { title: 'Authenticate', text: 'Click “Authenticate & start visit”. Choose the authentication method, “Send OTP” to the member’s phone and enter it, then “Verify & start visit”.' },
          { title: 'Reserve the benefit', text: 'Use “Reserve benefit” and enter the amount to reserve against the member’s cover.' },
        ],
      },
      {
        title: 'Claims and payment',
        steps: [
          { title: 'Create the claim', text: 'Open “Insurance Claims” → “Create claim” from the visit’s invoice.' },
          { title: 'Attach documents', text: 'Use “Upload attachment” for the signed claim form, lab results and so on.' },
          { title: 'Send', text: 'Click “Send invoice to payer”, then “Refresh status” to follow it.' },
          { title: 'Remittances', text: 'Under “Remittances” click “Fetch remittance” and “Reconcile” to match payments to invoices. Short payments can be settled with a credit note.' },
        ],
      },
    ],
  },
  {
    slug: 'finance',
    title: 'Finance and expenses',
    group: 'Money & claims',
    icon: Wallet,
    summary: 'Collections, receivables and recording and approving expenses.',
    who: 'Accountants and managers',
    where: 'Finance',
    sections: [
      {
        title: 'Overview',
        steps: [
          { title: 'Open Finance', text: 'Go to “Finance” → “Overview”. Choose a date range.' },
          { title: 'Read the figures', text: 'See collections by method, refunds, approved expenses and net cash, plus receivables (open invoices) by payer and SHA receivables (open claims).' },
        ],
      },
      {
        title: 'Expenses',
        steps: [
          { title: 'Record an expense', text: 'On the “Expenses” tab click “Record expense”. Enter the date, category, description, amount, who was paid, method and reference.' },
          { title: 'Approve', text: 'A manager reviews pending expenses and clicks “Approve” or “Reject”.' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ Management */
  {
    slug: 'reports',
    title: 'Reports',
    group: 'Management',
    icon: BarChart3,
    summary: 'Run live reports for any date range, print them or export to Excel (CSV).',
    who: 'Managers, records and finance',
    where: 'Reports',
    sections: [
      {
        title: 'Run a report',
        steps: [
          { title: 'Open Reports', text: 'Go to “Reports”. Reports are grouped into Clinical (OPD attendance, top diagnoses, admissions and length of stay, bed occupancy, deliveries, immunisation, lab and imaging workload, dispensing, dental, mortuary), Finance (revenue by day and method, charges by category, balances by payer, SHA claims, expenses), Supply (stock valuation and expiry, purchase orders) and Management (provider productivity).' },
          { title: 'Choose a report', text: 'Click the report you need.' },
          { title: 'Pick the dates', text: 'Use a preset (Today, Last 7 days, This month, Last 30 days) or choose From and To dates.' },
          { title: 'Print or export', text: 'Click “Print”, or “CSV” to open it in Excel.' },
        ],
        tips: ['Reports are computed live for the branches you have access to.'],
      },
    ],
  },
  {
    slug: 'hr',
    title: 'HR: staff, licences, roster and leave',
    group: 'Management',
    icon: IdCard,
    summary: 'Staff records, practising licences, the duty roster and leave approvals.',
    who: 'HR officers and managers',
    where: 'HR & Roster',
    sections: [
      {
        title: 'Staff records',
        steps: [
          { title: 'Add staff', text: 'Go to “HR & Roster” → “Staff” → “Add staff”. Enter full name, national ID, KRA PIN, phone, email, cadre, job title, department, employment type and hire date. Link the system user if they sign in.' },
        ],
      },
      {
        title: 'Practising licences',
        steps: [
          { title: 'Record the licence', text: 'On the “Licences” tab enter the regulatory body, licence number and expiry date. Where available, use “Verify” to check the national registry.' },
          { title: 'Stay compliant', text: 'Licences expired or expiring within 90 days are highlighted.' },
        ],
      },
      {
        title: 'Duty roster',
        steps: [
          { title: 'Plan the week', text: 'On “Duty roster” choose the week and branch, then “Add shift”: pick the staff member, department or ward and the shift, and click “Assign”.' },
        ],
      },
      {
        title: 'Leave',
        steps: [
          { title: 'Review requests', text: 'On the “Leave” tab open pending requests and click “Approve” or “Reject”.' },
        ],
      },
    ],
  },
  {
    slug: 'sms-and-subscription',
    title: 'SMS credits and your AfeySync subscription',
    group: 'Management',
    icon: MessageSquareText,
    summary: 'Top up SMS credits and manage your plan, quotations, invoices and payments.',
    who: 'Administrators and finance',
    where: 'SMS wallet, Subscription',
    sections: [
      {
        title: 'SMS credits',
        steps: [
          { title: 'Check the balance', text: 'Go to “SMS wallet” to see your credit balance and history (welcome gift, top-ups and messages sent). One credit sends one SMS of up to 160 characters.' },
          { title: 'Top up', text: 'Click “Top up”, choose the amount and pay with M-Pesa. Credits are added when the payment is confirmed.' },
        ],
      },
      {
        title: 'Subscription',
        steps: [
          { title: 'Your plan', text: 'Go to “Subscription” to see your plan, its status (for example Free trial or Active) and what is included.' },
          { title: 'Quotations and agreements', text: 'Use “Get quotation” for a quote, and “Review & accept” to accept an agreement. “Download PDF” keeps a copy.' },
          { title: 'Pay', text: 'Open an invoice and click “Pay with M-Pesa”. Enter the M-Pesa phone number and approve the prompt on the phone.' },
        ],
      },
    ],
  },
  {
    slug: 'printing',
    title: 'Printing',
    group: 'Management',
    icon: Printer,
    summary: 'What you can print, on your own letterhead, and tips for good printouts.',
    who: 'Everyone',
    where: 'Print buttons throughout AfeySync',
    sections: [
      {
        title: 'What prints',
        steps: [
          { title: 'Letterhead', text: 'Every printout carries your logo and facility details from Branding.' },
          { title: 'Documents', text: 'Receipts, invoices, lab reports, discharge summaries, birth notifications (two copies per A4 page) and reports.' },
          { title: 'Print', text: 'Click “Print” on the page. In the print window choose your printer and A4 paper.' },
        ],
        tips: ['Printouts are always light, even if you use dark mode on screen.', 'To save as a PDF choose “Save as PDF” as the printer.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ Help */
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting and common questions',
    group: 'Help',
    icon: LifeBuoy,
    summary: 'Quick answers to the problems users meet most often.',
    who: 'Everyone',
    where: 'Anywhere',
    sections: [
      {
        title: 'Signing in',
        steps: [
          { title: '“That sign-in link had expired”', text: 'The hand-over from the sign-in page to your facility took too long or was opened in another browser. Sign in again in the same browser.' },
          { title: 'Lost phone / no codes', text: 'Use one of your recovery codes, or ask your administrator to “Reset 2-step” for you under Users & Roles.' },
          { title: 'Forgotten password', text: 'Click “Forgot password?” on the sign-in page.' },
        ],
      },
      {
        title: 'Patients and visits',
        steps: [
          { title: '“PATIENT ALREADY EXISTS”', text: 'AfeySync found the same person. Open the existing record instead of creating a duplicate.' },
          { title: '“Patient already has an open visit”', text: 'Click “Open visit” and continue the existing visit.' },
          { title: '“Already admitted”', text: 'The patient has an active admission. Open it; discharge first before admitting again.' },
        ],
      },
      {
        title: 'Billing',
        steps: [
          { title: 'A price is missing', text: 'Add the price for that payer’s price list under Services & Prices (or on the inventory item), then “Reprice” the draft bill.' },
          { title: 'M-Pesa payment not showing', text: 'Wait a moment for Safaricom’s confirmation. If the patient paid without the prompt, use “M-Pesa (enter receipt)”, or allocate it from Payment Reconciliation.' },
        ],
      },
      {
        title: 'The app itself',
        steps: [
          { title: 'Install it', text: 'Use “Install AfeySync” on the sign-in page, or your browser’s install option, to open it like an app on your phone or computer.' },
          { title: 'Something looks out of date', text: 'Reload the page. If the problem continues, sign out and sign in again.' },
          { title: 'Still need help?', text: 'Call or WhatsApp 0722 651 888 or email info@afey.co.ke. Include your facility’s web address, but never send passwords or patient details.' },
        ],
      },
    ],
  },
];

export const GUIDE_SLUGS = GUIDE_TOPICS.map((t) => t.slug);
export const guideTopic = (slug: string) => GUIDE_TOPICS.find((t) => t.slug === slug) ?? null;
export const guideStepCount = GUIDE_TOPICS.reduce((n, t) => n + t.sections.reduce((m, s) => m + s.steps.length, 0), 0);
