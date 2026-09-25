/**
 * Permission catalog. Tenant permissions live in each tenant database (seeded from here);
 * `owner.*` permissions are platform-only and are never granted inside a tenant.
 */
export const PERMISSION_GROUPS: Record<string, { label: string; permissions: Record<string, string> }> = {
  patients: {
    label: 'Patients',
    permissions: {
      'patients.view': 'View patient records',
      'patients.create': 'Register patients',
      'patients.edit': 'Edit patient demographics',
      'patients.search': 'Search patients',
      'patients.merge': 'Merge duplicate patients',
    },
  },
  frontdesk: {
    label: 'Front desk',
    permissions: {
      'frontdesk.view': 'View front desk',
      'appointments.view': 'View appointments',
      'appointments.manage': 'Create and manage appointments',
      'queue.view': 'View queues',
      'queue.manage': 'Manage queues and visits',
    },
  },
  opd: { label: 'Outpatient', permissions: { 'opd.view': 'View OPD', 'opd.create': 'Create OPD visits and triage' } },
  consultation: {
    label: 'Consultation',
    permissions: {
      'consultation.view': 'View consultations',
      'consultation.create': 'Create consultations',
      'consultation.edit': 'Edit draft consultations',
      'consultation.finalize': 'Finalize consultations',
    },
  },
  inpatient: {
    label: 'Inpatient',
    permissions: {
      'inpatient.view': 'View inpatients',
      'inpatient.admit': 'Admit patients',
      'inpatient.transfer': 'Transfer patients',
      'inpatient.discharge': 'Discharge patients',
      'inpatient.manage': 'Configure wards and beds',
      'nursing.view': 'View nursing records',
      'nursing.record': 'Record nursing notes, vitals, medication administration',
    },
  },
  maternity: {
    label: 'Maternity / MCH',
    permissions: {
      'maternity.view': 'View maternity',
      'maternity.manage': 'Manage maternity records',
      'mch.view': 'View MCH',
      'mch.manage': 'Manage MCH and immunization',
      'fp.view': 'View family planning',
      'fp.manage': 'Manage family planning',
    },
  },
  lab: {
    label: 'Laboratory',
    permissions: {
      'lab.view': 'View laboratory',
      'lab.order': 'Order lab tests',
      'lab.sample': 'Collect/receive samples',
      'lab.result': 'Enter results',
      'lab.verify': 'Verify results',
      'lab.approve': 'Approve and release results',
      'lab.manage': 'Manage lab test catalog and reference ranges',
    },
  },
  radiology: {
    label: 'Radiology',
    permissions: {
      'radiology.view': 'View radiology',
      'radiology.order': 'Order imaging',
      'radiology.report': 'Report imaging studies',
      'radiology.manage': 'Manage imaging catalog and scheduling',
    },
  },
  pharmacy: {
    label: 'Pharmacy',
    permissions: {
      'pharmacy.view': 'View pharmacy',
      'pharmacy.dispense': 'Dispense medication',
      'pharmacy.stock': 'Manage pharmacy stock',
      'prescription.create': 'Prescribe medication',
    },
  },
  dental: { label: 'Dental', permissions: { 'dental.view': 'View dental', 'dental.manage': 'Manage dental records' } },
  mortuary: { label: 'Mortuary', permissions: { 'mortuary.view': 'View mortuary', 'mortuary.manage': 'Manage mortuary', 'mortuary.release': 'Authorize body release' } },
  billing: {
    label: 'Billing',
    permissions: {
      'billing.view': 'View billing',
      'billing.create': 'Create invoices and receive payments',
      'billing.refund': 'Issue refunds and credit notes',
      'billing.waive': 'Approve discounts and waivers',
      'billing.prices': 'Manage service catalog and prices',
      'insurance.view': 'View insurance',
      'insurance.eligibility': 'Check private insurance eligibility, authenticate members and start insurance visits',
      'insurance.manage': 'Manage insurance schemes and claims',
    },
  },
  sha: {
    label: 'SHA',
    permissions: {
      'sha.view': 'View SHA information',
      'sha.eligibility': 'Check SHA eligibility, benefits, utilization',
      'sha.authorization': 'Create SHA authorizations and visit consent',
      'sha.preauthorization': 'Create SHA preauthorizations',
      'sha.claim': 'Create and submit SHA claims',
      'sha.intervention': 'Respond to SHA claim interventions',
      'sha.reconciliation': 'Reconcile SHA payments',
    },
  },
  dha: {
    label: 'DHA HIE',
    permissions: {
      'dha.view': 'View DHA interoperability',
      'dha.registry': 'Search DHA registries',
      'dha.fhir': 'Manage FHIR synchronization',
      'dha.consent': 'Manage HIE consent',
      'dha.shr': 'Access Shared Health Record',
      'dha.terminology': 'Use terminology service',
    },
  },
  supply: {
    label: 'Inventory / Procurement / Finance / HR',
    permissions: {
      'inventory.view': 'View inventory',
      'inventory.manage': 'Manage inventory',
      'procurement.view': 'View procurement',
      'procurement.manage': 'Manage procurement',
      'finance.view': 'View finance',
      'finance.manage': 'Manage finance',
      'hr.view': 'View HR',
      'hr.manage': 'Manage HR',
    },
  },
  reports: { label: 'Reports', permissions: { 'reports.view': 'View reports', 'reports.export': 'Export reports' } },
  documents: {
    label: 'Documents',
    permissions: { 'documents.view': 'View documents', 'documents.upload': 'Upload documents' },
  },
  admin: {
    label: 'Administration',
    permissions: {
      'admin.users': 'Manage users',
      'admin.roles': 'Manage roles and permissions',
      'admin.settings': 'Manage facility settings',
      'admin.branches': 'Manage branches',
      'admin.integrations': 'Manage facility integrations',
      'admin.audit': 'View audit logs',
      'admin.support_access': 'Approve platform support access',
    },
  },
  subscription: {
    label: 'Subscription',
    permissions: { 'subscription.view': 'View the AfeySync plan, invoices, quotations and agreements', 'subscription.manage': 'Pay AfeySync invoices, request quotations and accept agreements' },
  },
};

export const PLATFORM_PERMISSIONS = {
  'owner.tenants': 'Manage facilities/tenants',
  'owner.integrations': 'Manage platform integrations and credentials',
  'owner.subscriptions': 'Manage subscriptions',
  'owner.platform': 'Manage platform settings, users, health and backups',
  'owner.support': 'Request support access to a tenant',
  'owner.logs': 'View integration and audit logs',
} as const;

export const PLATFORM_ROLE_PERMISSIONS: Record<string, string[]> = {
  super_owner: Object.keys(PLATFORM_PERMISSIONS),
  platform_admin: ['owner.tenants', 'owner.integrations', 'owner.subscriptions', 'owner.support', 'owner.logs'],
  platform_support: ['owner.support', 'owner.logs'],
};

export const ALL_TENANT_PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) => Object.keys(g.permissions));

const P = (...prefixes: string[]) =>
  ALL_TENANT_PERMISSIONS.filter((p) => prefixes.some((x) => (x.endsWith('.') ? p.startsWith(x) : p === x)));

const clinicalCore = P('patients.view', 'patients.search', 'queue.view', 'documents.view');

export interface DefaultRole {
  key: string;
  name: string;
  scope: 'tenant' | 'branch';
  permissions: string[];
}

export const DEFAULT_ROLES: DefaultRole[] = [
  { key: 'facility_owner', name: 'Facility Owner', scope: 'tenant', permissions: ALL_TENANT_PERMISSIONS },
  { key: 'facility_admin', name: 'Facility Administrator', scope: 'tenant', permissions: ALL_TENANT_PERMISSIONS },
  {
    key: 'branch_admin',
    name: 'Branch Administrator',
    scope: 'branch',
    permissions: ALL_TENANT_PERMISSIONS.filter((p) => !['admin.roles', 'admin.integrations', 'admin.support_access', 'subscription.manage'].includes(p)),
  },
  {
    key: 'hospital_manager',
    name: 'Hospital Manager',
    scope: 'tenant',
    permissions: [...clinicalCore, ...P('reports.', 'billing.view', 'finance.view', 'inventory.view', 'hr.view', 'sha.view', 'admin.audit')],
  },
  {
    key: 'medical_superintendent',
    name: 'Medical Superintendent',
    scope: 'tenant',
    permissions: [...clinicalCore, ...P('opd.', 'consultation.', 'inpatient.', 'lab.view', 'radiology.view', 'pharmacy.view', 'reports.', 'sha.view', 'dha.view')],
  },
  {
    key: 'doctor',
    name: 'Doctor',
    scope: 'branch',
    permissions: [
      ...clinicalCore,
      ...P('opd.', 'consultation.view', 'consultation.create', 'consultation.finalize', 'inpatient.view', 'inpatient.admit', 'inpatient.transfer', 'inpatient.discharge', 'nursing.view', 'lab.view', 'lab.order', 'radiology.view', 'radiology.order', 'dental.view', 'mortuary.view'),
      ...P('prescription.create', 'pharmacy.view', 'maternity.', 'mch.view', 'sha.view', 'sha.eligibility', 'sha.authorization', 'sha.preauthorization', 'dha.shr', 'dha.terminology', 'dha.consent', 'documents.upload'),
    ],
  },
  {
    key: 'clinical_officer',
    name: 'Clinical Officer',
    scope: 'branch',
    permissions: [...clinicalCore, ...P('opd.', 'consultation.view', 'consultation.create', 'consultation.finalize', 'lab.view', 'lab.order', 'radiology.view', 'radiology.order', 'prescription.create', 'sha.view', 'sha.eligibility', 'dha.terminology')],
  },
  { key: 'nurse', name: 'Nurse', scope: 'branch', permissions: [...clinicalCore, ...P('opd.', 'inpatient.view', 'nursing.', 'consultation.view')] },
  {
    key: 'receptionist',
    name: 'Receptionist',
    scope: 'branch',
    permissions: [...P('patients.view', 'patients.search', 'patients.create', 'patients.edit', 'frontdesk.', 'appointments.', 'queue.', 'sha.view', 'sha.eligibility', 'dha.registry', 'documents.', 'insurance.view', 'insurance.eligibility')],
  },
  { key: 'triage_nurse', name: 'Triage Nurse', scope: 'branch', permissions: [...clinicalCore, ...P('opd.', 'queue.manage', 'nursing.record')] },
  { key: 'cashier', name: 'Cashier', scope: 'branch', permissions: [...P('patients.view', 'patients.search', 'billing.view', 'billing.create', 'insurance.view', 'insurance.eligibility')] },
  { key: 'accountant', name: 'Accountant', scope: 'tenant', permissions: [...P('billing.', 'insurance.view', 'finance.', 'reports.', 'sha.view', 'sha.reconciliation')] },
  { key: 'pharmacist', name: 'Pharmacist', scope: 'branch', permissions: [...clinicalCore, ...P('pharmacy.view', 'pharmacy.dispense', 'inventory.view')] },
  { key: 'pharmacy_manager', name: 'Pharmacy Manager', scope: 'branch', permissions: [...clinicalCore, ...P('pharmacy.', 'inventory.', 'procurement.view', 'reports.view')] },
  { key: 'lab_technologist', name: 'Lab Technologist', scope: 'branch', permissions: [...clinicalCore, ...P('lab.view', 'lab.sample', 'lab.result')] },
  { key: 'lab_manager', name: 'Lab Manager', scope: 'branch', permissions: [...clinicalCore, ...P('lab.', 'inventory.view', 'reports.view')] },
  { key: 'radiographer', name: 'Radiographer', scope: 'branch', permissions: [...clinicalCore, ...P('radiology.view', 'radiology.manage', 'documents.upload')] },
  { key: 'radiologist', name: 'Radiologist', scope: 'branch', permissions: [...clinicalCore, ...P('radiology.', 'documents.upload')] },
  { key: 'dentist', name: 'Dentist', scope: 'branch', permissions: [...clinicalCore, ...P('dental.', 'prescription.create', 'lab.order', 'radiology.order')] },
  { key: 'dental_assistant', name: 'Dental Assistant', scope: 'branch', permissions: [...clinicalCore, ...P('dental.view')] },
  { key: 'mch_nurse', name: 'MCH Nurse', scope: 'branch', permissions: [...clinicalCore, ...P('mch.', 'fp.', 'nursing.')] },
  { key: 'maternity_nurse', name: 'Maternity Nurse', scope: 'branch', permissions: [...clinicalCore, ...P('maternity.', 'nursing.', 'inpatient.view')] },
  { key: 'theatre_staff', name: 'Theatre Staff', scope: 'branch', permissions: [...clinicalCore, ...P('inpatient.view', 'nursing.')] },
  { key: 'mortuary_officer', name: 'Mortuary Officer', scope: 'branch', permissions: [...P('mortuary.view', 'mortuary.manage', 'documents.view'), 'billing.view'] },
  { key: 'records_officer', name: 'Records Officer', scope: 'tenant', permissions: [...P('patients.', 'documents.', 'reports.view', 'dha.registry')] },
  { key: 'insurance_officer', name: 'Insurance Officer', scope: 'tenant', permissions: [...P('patients.view', 'patients.search', 'insurance.', 'billing.view', 'sha.view', 'sha.eligibility', 'documents.view', 'documents.upload')] },
  { key: 'sha_officer', name: 'SHA Officer', scope: 'tenant', permissions: [...P('patients.view', 'patients.search', 'sha.', 'dha.view', 'dha.registry', 'billing.view', 'documents.')] },
  { key: 'procurement_officer', name: 'Procurement Officer', scope: 'tenant', permissions: P('procurement.', 'inventory.view') },
  { key: 'hr_officer', name: 'HR Officer', scope: 'tenant', permissions: P('hr.') },
  { key: 'it_admin', name: 'IT Administrator', scope: 'tenant', permissions: P('admin.users', 'admin.settings', 'admin.audit', 'admin.integrations') },
];

/** Permissions introduced after the initial release, keyed by the tenant schema version that added them. */
export const PERMISSIONS_ADDED_IN: Record<number, string[]> = {
  2: ['lab.manage', 'radiology.manage', 'inpatient.manage', 'mortuary.release'],
  3: ['insurance.eligibility', 'documents.view', 'documents.upload'],
  5: ['subscription.view', 'subscription.manage'],
};
