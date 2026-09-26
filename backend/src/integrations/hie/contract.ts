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

/** Operation whose method and path are quoted from the official HIE API reference (Consent Services, Status Callbacks). */
const documented = (key: string, group: string, description: string, method: ContractOperation['method'], path: string, page: string, extra: Partial<ContractOperation> = {}): ContractOperation => ({
  key,
  group,
  description,
  method,
  path,
  documented: true,
  verification: 'documented',
  idempotent: method === 'GET',
  requiresFacilityHeaders: true,
  documentationRef: `https://hie-docs.dha.go.ke/docs/${page}`,
  ...extra,
});

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

export const DEFAULT_HIE_CONTRACT_VERSION = '2026-09-consent-biometrics';

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

  // CONSENT SERVICES — OTP, authorizations, biometrics (Consent Services API reference)
  documented('sha.contacts', 'Consent', 'Beneficiary contacts for OTP (patient_id)', 'GET', '/patients/contacts', 'consent/process/getBeneficiaryValidContact'),
  documented('sha.otp.send', 'Consent', 'Send visit OTP (patient_id, intervention_codes, optional contact_id)', 'POST', '/claims/otp', 'consent/process/sendOTP'),
  documented('sha.otp.discharge', 'Consent', 'Send discharge OTP (consent_token, patient_id)', 'POST', '/claims/otp/discharge', 'consent/process/sendDischargeOTP'),
  documented('sha.authorization.create', 'Authorizations', 'Create authorization (OTP, biometrics or minors biometrics)', 'POST', '/claims/authorize', 'consent/process/biometricsConsent'),
  documented('sha.authorization.get', 'Authorizations', 'Get authorizations by token, patient_id or guid', 'GET', '/claims/authorizations', 'consent/process/getAuthorizations'),
  documented('sha.authorization.reject', 'Authorizations', 'Reject a pending biometrics authorization (expired capture)', 'POST', '/claims/authorizations/{consent_token}/reject', 'consent/process/rejectAuthorization'),
  documented('sha.biometrics.match.create', 'Minors Biometrics', 'Dispatch a minor fingerprint match (202, verdict by callback)', 'POST', '/biometrics/matches', 'consent/process/minorsBiometricsConsent'),
  documented('sha.biometrics.match.get', 'Minors Biometrics', 'Read a minor fingerprint match (reconciliation only)', 'GET', '/biometrics/matches/{match_id}', 'consent/process/minorsBiometricsConsent'),
  documented('sha.biometrics.enrollment.create', 'Minors Biometrics', 'Enrol a minor finger (202, outcome by callback)', 'POST', '/biometrics/enrollments', 'consent/process/minorsBiometricsEnrollment'),
  documented('sha.biometrics.verification.create', 'Minors Biometrics', 'Verify an enrolled minor finger (202, outcome by callback)', 'POST', '/biometrics/verifications', 'consent/process/minorsBiometricsEnrollment'),
  documented('sha.biometrics.enrollment.status', 'Minors Biometrics', 'Fingerprint enrollment status (beneficiary_code)', 'GET', '/biometrics/enrollment-status', 'consent/process/minorsBiometricsEnrollment'),
  documented('sha.otpWhitelist.create', 'OTP Whitelist', 'Create OTP whitelist request (multipart/form-data)', 'POST', '/patients/otp-whitelists', 'consent/process/createOTPWhitelistRequest', { contentType: 'multipart/form-data' }),
  documented('sha.otpWhitelist.list', 'OTP Whitelist', 'OTP whitelist requests by beneficiary_cr_id or guid', 'GET', '/patients/otp-whitelists/callback', 'consent/process/getOTPWhitelistRequest'),

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

  // Status callbacks (where the HIE pushes claim, preauth and authorization status changes and biometric verdicts)
  documented('callbacks.endpoints.list', 'Status Callbacks', 'List callback endpoints (tenant ID or FR code)', 'GET', '/tenants/{tenant_id}/endpoints', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.endpoints.register', 'Status Callbacks', 'Register a callback endpoint (one per entity_type)', 'POST', '/tenants/{tenant_id}/endpoints', 'claims/process/callbacks/registerCallbackEndpoint', { requiresFacilityHeaders: false }),
  documented('callbacks.endpoints.update', 'Status Callbacks', 'Update a callback endpoint (e.g. is_active)', 'PATCH', '/tenants/endpoints/{endpoint_id}', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.endpoints.delete', 'Status Callbacks', 'Delete a callback endpoint and its operations', 'DELETE', '/tenants/endpoints/{endpoint_id}', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.operations.list', 'Status Callbacks', 'List operations on an endpoint', 'GET', '/tenants/{tenant_id}/endpoints/{endpoint_id}/operations', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.operations.get', 'Status Callbacks', 'Read a callback operation (includes paused)', 'GET', '/tenants/endpoints/operations/{operation_id}', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.operations.register', 'Status Callbacks', 'Register the status_changed operation on an endpoint', 'POST', '/tenants/{tenant_id}/endpoints/{endpoint_id}/operations', 'claims/process/callbacks/registerCallbackOperation', { requiresFacilityHeaders: false }),
  documented('callbacks.operations.update', 'Status Callbacks', 'Update a callback operation', 'PATCH', '/tenants/endpoints/operations/{operation_id}', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),
  documented('callbacks.operations.delete', 'Status Callbacks', 'Delete a callback operation', 'DELETE', '/tenants/endpoints/operations/{operation_id}', 'claims/process/callbacks/manageCallbackEndpoints', { requiresFacilityHeaders: false }),

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
