/**
 * Default DHA HIE integration contract.
 *
 * Source of truth: https://hie-docs.dha.go.ke/ (Authentication, Registries, Claims & Preauths, Consent
 * Services, Terminology Service, Shared Health Record, API Catalog).
 *
 * Operations marked `documented: true` carry the method/path quoted from the official documentation
 * (as captured in AfeySync's integration specification). Every other operation is DECLARED but has
 * `path: null`: AfeySync will refuse to call it until the platform owner enters the path from the current
 * official API catalog in Owner → API Config. We never guess government endpoints.
 */
export interface ContractOperation {
  key: string;
  group: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | null;
  contentType?: string;
  idempotent?: boolean;
  requiresFacilityHeaders?: boolean;
  documented: boolean;
  documentationRef?: string;
  /**
   * 'documented': quoted from the official docs. 'spec_unverified': path taken from AfeySync's eClaims integration
   * specification (which cites hie-docs.dha.go.ke) but not yet re-verified against the live docs by the platform
   * owner — shown with a warning in Owner → API Config. Undefined for declared (path: null) operations.
   */
  verification?: 'documented' | 'spec_unverified' | 'owner_verified';
}

const doc = (section: string) => `https://hie-docs.dha.go.ke/ — ${section}`;

const declared = (key: string, group: string, description: string, method: ContractOperation['method']): ContractOperation => ({
  key,
  group,
  description,
  method,
  path: null,
  documented: false,
  idempotent: method === 'GET',
  documentationRef: doc('API Catalog'),
});

/** Operation whose path comes from the eClaims integration specification; must be verified by the owner. */
const specified = (key: string, group: string, description: string, method: ContractOperation['method'], path: string, page: string, extra: Partial<ContractOperation> = {}): ContractOperation => ({
  key,
  group,
  description,
  method,
  path,
  documented: false,
  verification: 'spec_unverified',
  idempotent: method === 'GET',
  requiresFacilityHeaders: true,
  documentationRef: `https://hie-docs.dha.go.ke/${page}`,
  ...extra,
});

export const DEFAULT_HIE_CONTRACT_VERSION = '2026-09-spec-eclaims';

export const DEFAULT_HIE_OPERATIONS: ContractOperation[] = [
  // AUTHENTICATION
  { key: 'auth.token', group: 'Authentication', description: 'OAuth 2.0 client-credentials token', method: 'POST', path: '/tenants/token', contentType: 'application/x-www-form-urlencoded', documented: true, verification: 'documented', documentationRef: doc('Authentication') },

  // REGISTRIES
  { key: 'registry.client.search', group: 'Client Registry', description: 'Search client registry by identification_number + identification_type', method: 'GET', path: '/patients', idempotent: true, documented: true, verification: 'documented', documentationRef: doc('Registries → Client Registry') },
  declared('registry.practitioner.search', 'Health Worker Registry', 'Search / verify a health worker', 'GET'),
  declared('registry.facility.search', 'Facility Registry', 'Search a facility by registry code', 'GET'),

  // eCLAIMS — eligibility & benefits
  { key: 'sha.eligibility', group: 'Eligibility', description: 'Eligibility by identification_number + identification_type (ClientRegistry ID preferred)', method: 'GET', path: '/patients/eligibility', idempotent: true, requiresFacilityHeaders: true, documented: true, verification: 'documented', documentationRef: doc('API Catalog → eClaims → Eligibility') },
  { key: 'sha.benefits', group: 'Benefits', description: 'Parent benefits for patient_id (paginated)', method: 'GET', path: '/patients/benefits', idempotent: true, requiresFacilityHeaders: true, documented: true, verification: 'documented', documentationRef: doc('API Catalog → eClaims → Benefits') },
  { key: 'sha.interventions', group: 'Benefit Interventions', description: 'Benefit interventions (preauth/doctor/member authorization flags, tariffs, limits, access point)', method: 'GET', path: '/patients/benefits/interventions', idempotent: true, requiresFacilityHeaders: true, documented: true, verification: 'documented', documentationRef: doc('API Catalog → eClaims → Benefit Interventions') },
  { key: 'sha.utilization', group: 'Utilization', description: 'Individual / household utilization balances for patient_id + intervention_code', method: 'GET', path: '/patients/benefits/utilization', idempotent: true, requiresFacilityHeaders: true, documented: true, verification: 'documented', documentationRef: doc('API Catalog → eClaims → Utilization') },
  { key: 'facility.beds.occupancy', group: 'Facility', description: 'Facility bed occupancy', method: 'GET', path: '/facilities/{facilityCode}/beds/occupancy', idempotent: true, documented: true, verification: 'documented', documentationRef: doc('API Catalog → Facility bed occupancy') },

  // eCLAIMS — coverage (paths from the eClaims integration specification; verify against the live docs)
  specified('sha.subBenefits', 'Benefits', 'Sub-benefits for patient_id', 'GET', '/patients/sub-benefits', 'eclaims/eligibility'),
  specified('sha.pomsf.balances', 'Benefits', 'POMSF balances', 'GET', '/patients/benefits/pomsf-balances', 'eclaims/eligibility'),
  specified('sha.coverage.effective', 'Billing', 'Effective POMSF coverage (consent_token, policy_number, principal_cr_id)', 'POST', '/claims/effective-coverage', 'eclaims/billing'),

  // eCLAIMS — consent & authorization
  specified('sha.contacts', 'Consent', 'Masked beneficiary contacts for OTP', 'GET', '/patients/contacts', 'eclaims/authorizations'),
  specified('sha.otp.send', 'Consent', 'Send consent OTP (optional beneficiary_contact_id)', 'POST', '/claims/otp', 'eclaims/authorizations'),
  specified('sha.authorization.create', 'Authorizations', 'Create authorization (OTP or biometric); returns consent token / GUID', 'POST', '/claims/authorize', 'eclaims/authorizations'),
  specified('sha.biometrics.match.create', 'Biometrics', 'Minor fingerprint match', 'POST', '/biometrics/matches', 'eclaims/authorizations'),
  specified('sha.biometrics.match.get', 'Biometrics', 'Fingerprint match status', 'GET', '/biometrics/matches/{match_id}', 'eclaims/authorizations'),

  // eCLAIMS — visit / virtual claim
  specified('sha.visit.consent.start', 'Visit Consent', 'Start visit / create virtual claim', 'POST', '/claims/visit', 'eclaims/start-visit-consent'),
  specified('sha.intervention.add', 'Interventions', 'Add intervention to claim', 'POST', '/claims/interventions', 'eclaims/start-visit-consent'),
  specified('sha.intervention.restore', 'Interventions', 'Restore intervention', 'POST', '/claims/interventions/restore', 'eclaims/start-visit-consent'),
  specified('sha.intervention.retire', 'Interventions', 'Retire intervention', 'POST', '/claims/interventions/retire', 'eclaims/start-visit-consent'),
  specified('sha.intervention.switch', 'Interventions', 'Switch intervention', 'POST', '/claims/interventions/switch', 'eclaims/start-visit-consent'),

  // eCLAIMS — preauthorizations
  specified('sha.preauth.create', 'Preauthorizations', 'Create preauthorization (multipart/form-data)', 'POST', '/preauths', 'eclaims/preauths', { contentType: 'multipart/form-data' }),
  specified('sha.preauth.get', 'Preauthorizations', 'Fetch preauthorization', 'GET', '/preauths', 'eclaims/preauths'),
  specified('sha.preauth.cancel', 'Preauthorizations', 'Cancel preauthorization', 'POST', '/preauths/cancel', 'eclaims/preauths'),
  specified('sha.preauth.diagnoses.delete', 'Preauthorizations', 'Remove preauth diagnoses', 'DELETE', '/preauths/diagnoses', 'eclaims/preauths'),
  specified('sha.preauth.doctors.delete', 'Preauthorizations', 'Remove preauth doctors', 'DELETE', '/preauths/doctors', 'eclaims/preauths'),

  // eCLAIMS — billing & dispatch (paths not supplied in the specification: the owner must enter them from the docs)
  declared('sha.virtualClaim.submit', 'Claim Dispatch', 'Submit outpatient / emergency claim', 'POST'),
  declared('sha.virtualClaim.close', 'Claim Dispatch', 'Close virtual claim', 'POST'),
  declared('sha.billing.lineItems', 'Billing', 'Add billable line items', 'POST'),
  declared('sha.claim.attachments.add', 'Claim Attachments', 'Add claim attachment', 'POST'),
  declared('sha.claim.diagnoses.add', 'Claim Diagnoses', 'Add claim diagnoses', 'POST'),
  declared('sha.claim.lines.edit', 'Claim Lines', 'Edit claim line', 'PATCH'),
  declared('sha.claim.lines.resubmit', 'Claim Lines', 'Resubmit claim line', 'POST'),
  declared('sha.claim.preview.provider', 'Claim Preview', 'Preview provider claim', 'GET'),
  declared('sha.claim.preview.payer', 'Claim Preview', 'Preview payer claim', 'GET'),
  declared('sha.claim.discharge', 'Claim Dispatch', 'Discharge inpatient (dispatches the inpatient claim)', 'POST'),
  declared('sha.intervention.respond', 'Interventions', 'Respond to intervention query', 'POST'),

  // Emergency (the former EMT claim endpoint was withdrawn — only the current emergency claim workflow)
  declared('sha.emergency.claim.create', 'Emergency Claims', 'Create emergency claim', 'POST'),
  declared('sha.emergency.doctor.add', 'Emergency Claims', 'Add doctor to emergency claim', 'POST'),
  declared('sha.emergency.doctor.remove', 'Emergency Claims', 'Remove doctor from emergency claim', 'DELETE'),
  declared('sha.emergency.protocols.list', 'Emergency Claims', 'Fetch emergency protocols', 'GET'),
  declared('sha.emergency.protocol.add', 'Emergency Claims', 'Add protocol to emergency claim', 'POST'),

  // ePrescription
  declared('eprescription.preview', 'ePrescription', 'Preview prescription', 'POST'),
  declared('eprescription.create', 'ePrescription', 'Create prescription', 'POST'),
  declared('eprescription.dispense', 'ePrescription', 'Create dispense', 'POST'),
  declared('eprescription.doctor.remove', 'ePrescription', 'Remove doctor from prescription', 'DELETE'),

  // Status callbacks
  declared('callbacks.endpoints.list', 'Status Callbacks', 'GET callback endpoints', 'GET'),
  declared('callbacks.endpoints.register', 'Status Callbacks', 'POST register callback endpoint', 'POST'),
  declared('callbacks.endpoints.update', 'Status Callbacks', 'PATCH callback endpoint', 'PATCH'),
  declared('callbacks.endpoints.delete', 'Status Callbacks', 'DELETE callback endpoint', 'DELETE'),
  declared('callbacks.operations.list', 'Status Callbacks', 'GET callback operations', 'GET'),
  declared('callbacks.operations.get', 'Status Callbacks', 'GET callback operation', 'GET'),
  declared('callbacks.operations.register', 'Status Callbacks', 'POST register callback operation', 'POST'),
  declared('callbacks.operations.update', 'Status Callbacks', 'PATCH callback operation', 'PATCH'),
  declared('callbacks.operations.delete', 'Status Callbacks', 'DELETE callback operation', 'DELETE'),

  // Consent services
  declared('consent.otp.send', 'Consent', 'Send consent OTP', 'POST'),
  declared('consent.otp.verify', 'Consent', 'Verify consent OTP', 'POST'),
  declared('consent.biometric', 'Consent', 'Biometric consent', 'POST'),
  declared('consent.status', 'Consent', 'Consent status', 'GET'),

  // Shared Health Record
  declared('shr.visit.open', 'Shared Health Record', 'Patient consent lifecycle / open visit', 'POST'),
  declared('shr.records.write', 'Shared Health Record', 'Write clinical records (FHIR bundle)', 'POST'),
  declared('shr.records.read', 'Shared Health Record', 'Read national clinical records', 'GET'),

  // Terminology
  declared('terminology.lookup', 'Terminology', 'Lookup concept', 'GET'),
  declared('terminology.search', 'Terminology', 'Search concepts', 'GET'),
  declared('terminology.validate', 'Terminology', 'Validate code', 'GET'),
  declared('terminology.translate', 'Terminology', 'Translate / map code', 'GET'),
];
