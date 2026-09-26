import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

/**
 * SHA visit / virtual claim (DHA eClaims). Keeps every DHA identifier and a trail of DHA responses for
 * audit and reconciliation. The consent token is encrypted and hidden by default; OTPs are never stored.
 */
const shaVisitSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    patientCrId: { type: String, required: true },
    serviceType: { type: String, enum: ['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CAPITATION'], required: true },
    interventions: [
      {
        _id: false,
        code: String,
        name: String,
        subBenefitCode: String,
        paymentMechanism: String,
        accessPoint: String,
        fund: String,
        needsPreauth: Boolean,
        needsManualPreauthApproval: Boolean,
        needsDoctorAuthorization: Boolean,
        needsMemberAuthorization: Boolean,
        needApprovalBeforeClaimSubmission: Boolean,
        specialPreauth: [String],
        requiredPreauthDocumentTypes: [String],
        applicableDocumentTypes: [String],
        state: { type: String, enum: ['active', 'retired'], default: 'active' },
        raw: Mixed,
      },
    ],
    decision: Mixed,
    eligibility: { checkId: ObjectId, schemes: Mixed, whitelistedForOTP: Boolean, facilityBiometricsEnforced: Boolean, useSilBiometrics: Boolean, pomsf: Mixed },
    consent: {
      method: { type: String, enum: ['otp', 'biometric', 'minor_biometric'] },
      beneficiaryContactId: String,
      status: String,
      authCode: String,
      authGuid: String,
      shaGuid: String,
      expiry: Date,
      verificationRequestId: String,
      verificationUrl: String,
      /** When the biometric capture iframe stops accepting a finger (from shaVerificationRequest.embedExpiry). */
      verificationExpiresAt: Date,
      workstationId: String,
      authorizedAt: Date,
      authorizedBy: ObjectId,
      /** Biometric authorizations rejected because their capture window expired (kept for audit). */
      rejected: [{ _id: false, authGuid: String, at: Date, byName: String, reason: String }],
      /** Minors biometrics: the fingerprint match presented as match_id when the visit starts. */
      match: { matchId: String, jobId: ObjectId, status: String, expiresAt: Date, errorCode: String, usedAt: Date },
    },
    consentToken: { type: { ciphertext: String, keyId: String }, select: false },
    /** Fingerprint discharge authorization (inpatient), kept apart from the visit's own consent and token. */
    dischargeAuth: { status: String, authCode: String, authGuid: String, verificationUrl: String, verificationExpiresAt: Date, authorizedAt: Date, rejectedAt: Date },
    dischargeToken: { type: { ciphertext: String, keyId: String }, select: false },
    dha: {
      claimId: String,
      ediClaimGuid: String,
      authorizationCode: String,
      authorizationGuid: String,
      beneficiaryGuid: String,
      invoiceId: String,
      invoiceNumber: String,
      patientNumber: String,
      memberNumber: String,
      payerCode: String,
      payerName: String,
      payerSladeCode: String,
      providerName: String,
      providerSladeCode: String,
      providerFid: String,
      schemeCode: String,
      schemeName: String,
      visitNumber: String,
      visitStart: String,
      workflowState: String,
      totalClaimAmount: Number,
      totalClaimNetAmount: Number,
      totalClaimCopay: Number,
    },
    practitioner: { identificationType: String, identificationNumber: String, regulationBody: String, userId: ObjectId, name: String },
    preauths: [
      {
        _id: false,
        interventionCode: String,
        status: String,
        preauthType: String,
        totalEstimated: Number,
        interimApproved: Number,
        finalApproved: Number,
        doctorApproved: Mixed,
        doctorReviewStatus: String,
        documentIds: [ObjectId],
        submittedAt: Date,
        submittedBy: ObjectId,
        lastFetchedAt: Date,
        cancelledAt: Date,
        cancelledBy: ObjectId,
        cancelReason: String,
        lastResponse: Mixed,
      },
    ],
    effectiveCoverage: { policyNumber: String, principalCrId: String, response: Mixed, at: Date },
    claimTransactionId: { type: ObjectId, ref: 'ShaTransaction' },
    claimSteps: [{ _id: false, step: String, at: Date, by: ObjectId, ok: Boolean, error: String }],
    status: {
      type: String,
      enum: ['consent_pending', 'biometric_pending', 'authorized', 'visit_started', 'preauth_pending', 'in_progress', 'submitted', 'discharged', 'closed', 'cancelled'],
      default: 'consent_pending',
      index: true,
    },
    history: [{ _id: false, at: Date, action: String, by: ObjectId, byName: String, note: String }],
    /** Recent DHA exchanges (operation, HTTP outcome and body) kept for audit/reconciliation. */
    responses: [{ _id: false, at: Date, operation: String, ok: Boolean, code: String, data: Mixed }],
    lastDhaError: String,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
shaVisitSchema.index({ 'dha.claimId': 1 }, { sparse: true });
shaVisitSchema.index({ createdAt: -1 });

/**
 * A minors-biometrics capture dispatched to a HealthID workstation: fingerprint enrollment, verification or
 * match. The HIE answers 202 and later delivers the outcome to the facility's registered callback endpoint,
 * which updates this record; the screen watches this record rather than polling the HIE.
 */
const shaBiometricJobSchema = new Schema(
  {
    kind: { type: String, enum: ['enrollment', 'verification', 'match'], required: true },
    /** job_id (enrollment / verification) or match_id (match) returned by the HIE. */
    externalId: { type: String, required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', index: true },
    shaVisitId: { type: ObjectId, ref: 'ShaVisit' },
    beneficiaryCode: { type: String, required: true },
    position: Number,
    workstationId: String,
    deviceId: String,
    status: { type: String, enum: ['dispatched', 'pending', 'succeeded', 'failed'], default: 'dispatched', index: true },
    /** Outcome as reported: matched / no_match / failed, verified / not_verified / max_attempts_exceeded, enrolled. */
    outcome: String,
    errorCode: String,
    errorDetail: String,
    attemptsRemaining: Number,
    requiresReenroll: Boolean,
    expiresAt: Date,
    resolvedAt: Date,
    resolvedBy: { type: String, enum: ['callback', 'reconciliation'] },
    requestedBy: ObjectId,
    requestedByName: String,
  },
  { timestamps: true },
);
shaBiometricJobSchema.index({ createdAt: -1 });

/** A request to SHA to let a beneficiary consent by OTP (e.g. a child who cannot match, an amputee). */
const shaOtpWhitelistSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    beneficiaryCrId: { type: String, required: true },
    guid: { type: String, index: true },
    reasonType: String,
    reason: String,
    biometricAttempts: Number,
    documentIds: [ObjectId],
    status: String,
    reviewerNotes: [String],
    reviewedBy: String,
    lastSyncedAt: Date,
    requestedBy: ObjectId,
    requestedByName: String,
  },
  { timestamps: true },
);

export const shaSchemas = { ShaVisit: shaVisitSchema, ShaBiometricJob: shaBiometricJobSchema, ShaOtpWhitelist: shaOtpWhitelistSchema };
