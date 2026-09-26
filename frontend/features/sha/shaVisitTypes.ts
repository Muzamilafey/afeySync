export interface InterventionFlags {
  code: string;
  name?: string;
  paymentMechanism?: string;
  accessPoint?: string;
  fund?: string;
  needsPreauth?: boolean;
  needsManualPreauthApproval?: boolean;
  needsDoctorAuthorization?: boolean;
  needsMemberAuthorization?: boolean;
  needApprovalBeforeClaimSubmission?: boolean;
  specialPreauth: string[];
  requiredPreauthDocumentTypes: string[];
  applicableDocumentTypes: string[];
  state?: 'active' | 'retired';
}
export interface Decision { serviceType: string; needsPreauth: boolean; manualApproval: boolean; preauthInterventions: string[]; specialPreauth: string[]; requiredDocuments: string[]; paymentMechanisms: string[]; accessPoints: string[]; funds: string[]; steps: string[]; warnings: string[] }
export interface Preauth { interventionCode: string; status?: string; preauthType?: string; totalEstimated?: number; interimApproved?: number; finalApproved?: number; doctorReviewStatus?: string; submittedAt?: string; cancelledAt?: string; cancelReason?: string }
export interface ShaVisit {
  _id: string;
  reference: string;
  status: string;
  serviceType: string;
  patientCrId: string;
  patientId: { _id: string; patientNumber: string; firstName: string; lastName: string; clientRegistryId?: string; gender?: string; dateOfBirth?: string; phone?: string };
  interventions: InterventionFlags[];
  decision?: Decision;
  eligibility?: { whitelistedForOTP?: boolean; facilityBiometricsEnforced?: boolean; useSilBiometrics?: boolean; pomsf?: { code?: string; policyNumber?: string; principalCrId?: string } | null; schemes?: Array<{ code?: string; name?: string }> };
  consent?: {
    method?: string; status?: string; authCode?: string; authGuid?: string; expiry?: string; verificationUrl?: string; verificationExpiresAt?: string; workstationId?: string;
    authorizedAt?: string; beneficiaryContactId?: string; rejected?: Array<{ at: string; byName?: string; reason?: string }>;
    match?: { matchId?: string; jobId?: string; status?: string; expiresAt?: string; errorCode?: string; usedAt?: string };
  };
  dischargeAuth?: { status?: string; authCode?: string; authGuid?: string; verificationUrl?: string; verificationExpiresAt?: string; authorizedAt?: string; rejectedAt?: string };
  dha?: Record<string, string | number | undefined>;
  practitioner?: { identificationType?: string; identificationNumber?: string; regulationBody?: string; name?: string };
  preauths: Preauth[];
  claimTransactionId?: string;
  claimSteps: Array<{ step: string; at: string; ok: boolean }>;
  history: Array<{ at: string; action: string; byName?: string; note?: string }>;
  responses?: Array<{ at: string; operation: string; ok: boolean; code: string; data: unknown }>;
  effectiveCoverage?: { policyNumber?: string; principalCrId?: string; response?: unknown; at?: string };
  lastDhaError?: string;
  createdAt: string;
}
export const VISIT_STATUS_LABEL: Record<string, string> = {
  consent_pending: 'Consent pending', biometric_pending: 'Biometric verification pending', authorized: 'Consent obtained', visit_started: 'Visit started', preauth_pending: 'Preauthorization required',
  in_progress: 'In progress', submitted: 'Claim submitted', discharged: 'Discharged (claim dispatched)', closed: 'Closed', cancelled: 'Cancelled',
};

/** A minors-biometrics capture (enrollment, verification or match), updated when SHA's callback arrives. */
export interface BiometricJob {
  _id: string; kind: 'enrollment' | 'verification' | 'match'; externalId: string; position?: number; status: 'dispatched' | 'pending' | 'succeeded' | 'failed';
  outcome?: string; errorCode?: string; errorDetail?: string; attemptsRemaining?: number; requiresReenroll?: boolean; expiresAt?: string; resolvedAt?: string;
  requestedByName?: string; createdAt: string;
}
export const JOB_OUTCOME_LABEL: Record<string, string> = {
  matched: 'Fingerprint matched', no_match: 'Fingerprint did not match', failed: 'No result', deadline_exceeded: 'The capture window closed before a finger was placed',
  enrolled: 'Finger enrolled – verify it next', verified: 'Finger verified', not_verified: 'Did not match the enrolled print', max_attempts_exceeded: 'Out of attempts – enrol this finger again',
};
