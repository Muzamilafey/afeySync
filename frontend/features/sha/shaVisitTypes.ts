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
  eligibility?: { whitelistedForOTP?: boolean; facilityBiometricsEnforced?: boolean; pomsf?: { code?: string; policyNumber?: string; principalCrId?: string } | null; schemes?: Array<{ code?: string; name?: string }> };
  consent?: { method?: string; status?: string; authCode?: string; authGuid?: string; expiry?: string; verificationUrl?: string; authorizedAt?: string; beneficiaryContactId?: string };
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
