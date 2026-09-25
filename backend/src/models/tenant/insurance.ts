import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

export const INSURANCE_PROVIDER_TYPES = ['SHA_DHA', 'SLADE360', 'DIRECT_INSURER', 'CASH', 'OTHER'] as const;

/** Payer directory (per facility). Being listed does not make a payer usable: it must be enabled and supported. */
const insurancePayerSchema = new Schema(
  {
    providerType: { type: String, enum: INSURANCE_PROVIDER_TYPES, required: true, default: 'SLADE360' },
    sladeCode: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true },
    enabled: { type: Boolean, default: false },
    supported: { type: Boolean, default: false },
    environment: { type: String, enum: ['sandbox', 'production'] },
    notes: String,
    lastActivityAt: Date,
  },
  { timestamps: true },
);
insurancePayerSchema.index({ providerType: 1, sladeCode: 1 }, { unique: true, partialFilterExpression: { sladeCode: { $type: 'string' } } });

/** A patient's insurance cover. Multiple per patient; changes are appended to history, never overwritten. */
const insuranceCoverageSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    providerType: { type: String, enum: INSURANCE_PROVIDER_TYPES, required: true },
    payerId: { type: ObjectId, ref: 'InsurancePayer' },
    payerName: { type: String, required: true },
    payerSladeCode: String,
    memberNumber: { type: String, required: true, trim: true },
    schemeName: String,
    schemeCode: String,
    policyNumber: String,
    policyEffectiveDate: String,
    principalMember: { type: Boolean, default: true },
    principalMemberName: String,
    relationship: String,
    validFrom: Date,
    validTo: Date,
    isActive: { type: Boolean, default: true, index: true },
    beneficiaryId: String,
    lastEligibilityCheck: Date,
    eligibilityStatus: { type: String, enum: ['unknown', 'eligible', 'not_eligible', 'error'], default: 'unknown' },
    benefits: Mixed,
    copay: Mixed,
    panelStatus: String,
    contacts: [{ _id: false, id: String, masked: String, kind: String }],
    restrictions: Mixed,
    rawEligibilityReference: Mixed,
    history: [{ _id: false, at: Date, action: String, by: ObjectId, byName: String, changes: Mixed }],
    createdBy: ObjectId,
  },
  { timestamps: true },
);
insuranceCoverageSchema.index({ patientId: 1, payerSladeCode: 1, memberNumber: 1 });

const INS_VISIT_STATUSES = ['AUTHENTICATING', 'AUTHORIZED', 'VISIT_STARTED', 'RESERVED', 'IN_PROGRESS', 'READY_FOR_CLAIM', 'CLAIM_CREATED', 'INVOICED', 'SUBMITTED', 'PAID', 'REJECTED', 'CLOSED'] as const;

const insuranceVisitSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    coverageId: { type: ObjectId, ref: 'InsuranceCoverage', required: true },
    localVisitId: { type: ObjectId, ref: 'Visit' },
    providerType: { type: String, enum: INSURANCE_PROVIDER_TYPES, required: true },
    payer: String,
    payerSladeCode: String,
    memberNumber: String,
    beneficiaryId: String,
    authorizationTokenReference: String,
    ediAuthGuid: String,
    authorizationId: String,
    visitNumber: String,
    visitStart: String,
    visitEnd: String,
    visitType: String,
    scheme: { name: String, code: String },
    benefit: { code: String, type: { type: String }, name: String },
    authenticationMethod: { type: String, enum: ['otp', 'fingerprint', 'guardian', 'non_slade'] },
    authorizationStatus: String,
    authorizationToken: { type: { ciphertext: String, keyId: String }, select: false },
    reservation: { reservationId: String, authorization: String, amount: Number, invoiceNumber: String, status: { type: String, enum: ['pending', 'reserved', 'failed'] }, createdAt: Date, by: ObjectId },
    claimId: { type: ObjectId, ref: 'InsuranceClaim' },
    invoiceIds: [{ type: ObjectId, ref: 'Invoice' }],
    status: { type: String, enum: INS_VISIT_STATUSES, default: 'AUTHENTICATING', index: true },
    history: [{ _id: false, at: Date, action: String, by: ObjectId, byName: String, note: String }],
    lastResponse: Mixed,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
insuranceVisitSchema.index({ createdAt: -1 });

export const INS_CLAIM_STATUSES = ['DRAFT', 'AUTHORIZED', 'READY', 'SUBMITTED', 'PROCESSING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID', 'CLOSED'] as const;

const insuranceClaimSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: ObjectId, ref: 'InsuranceVisit', required: true, index: true },
    coverageId: { type: ObjectId, ref: 'InsuranceCoverage' },
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
    providerType: { type: String, enum: INSURANCE_PROVIDER_TYPES, required: true },
    payer: { name: String, sladeCode: String },
    memberNumber: String,
    scheme: { name: String, code: String },
    diagnoses: [{ _id: false, code: String, codingSystem: String, description: String, primary: Boolean }],
    sladeClaimId: String,
    claimReference: String,
    sladeInvoiceId: String,
    invoiceNumber: String,
    amounts: { gross: Number, copay: Number, insurance: Number, patient: Number, net: Number },
    status: { type: String, enum: INS_CLAIM_STATUSES, default: 'DRAFT', index: true },
    externalStatus: String,
    submittedAt: Date,
    attachments: [{ _id: false, target: { type: String, enum: ['claim', 'invoice'] }, documentId: ObjectId, attachmentId: String, attachmentType: String, fileName: String, uploadedBy: ObjectId, uploadedAt: Date }],
    creditNotes: [{ _id: false, externalId: String, amount: Number, reason: String, authorizedBy: ObjectId, authorizedByName: String, at: Date }],
    remittances: [{ type: ObjectId, ref: 'InsuranceRemittance' }],
    reconciliation: { status: { type: String, enum: ['pending', 'matched', 'variance'] }, submitted: Number, approved: Number, paid: Number, copay: Number, variance: Number, paymentIds: [ObjectId], at: Date, by: ObjectId },
    statusHistory: [{ _id: false, status: String, at: Date, source: String, note: String }],
    lastResponse: Mixed,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
insuranceClaimSchema.index({ createdAt: -1 });

/** Remittance evidence from the payer / EDI provider. Payments are only recorded against remittances. */
const insuranceRemittanceSchema = new Schema(
  {
    providerType: { type: String, enum: INSURANCE_PROVIDER_TYPES, required: true },
    externalId: { type: String, required: true },
    payerName: String,
    sladeClaimId: { type: String, index: true },
    claimId: { type: ObjectId, ref: 'InsuranceClaim', index: true },
    invoiceNumber: String,
    amountSubmitted: Number,
    amountApproved: Number,
    amountPaid: Number,
    adjustment: Number,
    date: Date,
    externalStatus: String,
    raw: Mixed,
    reconciledAt: Date,
  },
  { timestamps: true },
);
insuranceRemittanceSchema.index({ providerType: 1, externalId: 1 }, { unique: true });

/** Documented diagnosis code mappings (e.g. ICD-11 → ICD-10 for Slade360 claims). No silent conversion. */
const diagnosisCodeMapSchema = new Schema(
  {
    sourceSystem: { type: String, required: true },
    sourceCode: { type: String, required: true },
    targetSystem: { type: String, required: true },
    targetCode: { type: String, required: true },
    description: String,
    reference: String,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
diagnosisCodeMapSchema.index({ sourceSystem: 1, sourceCode: 1, targetSystem: 1 }, { unique: true });

/** Unique-key lock for one-shot external operations (e.g. benefit reservation); survives double clicks and races. */
const operationLockSchema = new Schema({ key: { type: String, required: true, unique: true }, by: ObjectId }, { timestamps: true });

export const insuranceSchemas = {
  OperationLock: operationLockSchema,
  InsurancePayer: insurancePayerSchema,
  InsuranceCoverage: insuranceCoverageSchema,
  InsuranceVisit: insuranceVisitSchema,
  InsuranceClaim: insuranceClaimSchema,
  InsuranceRemittance: insuranceRemittanceSchema,
  DiagnosisCodeMap: diagnosisCodeMapSchema,
};
