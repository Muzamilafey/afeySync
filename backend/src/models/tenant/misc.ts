import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

const dentalChartSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, unique: true },
    /** FDI tooth number → condition */
    teeth: { type: Map, of: new Schema({ status: String, surfaces: [String], notes: String, updatedAt: Date }, { _id: false }), default: {} },
    updatedBy: ObjectId,
  },
  { timestamps: true },
);

const dentalVisitSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: ObjectId, ref: 'Visit' },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    examination: String,
    diagnosis: String,
    treatmentPlan: [{ tooth: String, procedure: String, serviceCode: String, status: { type: String, enum: ['planned', 'done', 'cancelled'], default: 'planned' }, doneAt: Date }],
    notes: String,
    dentistId: ObjectId,
    dentistName: String,
  },
  { timestamps: true },
);

const mortuaryCaseSchema = new Schema(
  {
    mortuaryNumber: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient' },
    deceased: { name: { type: String, required: true }, sex: String, age: String, idType: String, idNumber: String },
    dateOfDeath: { type: Date, required: true },
    placeOfDeath: { type: String, enum: ['in_facility', 'brought_in_dead', 'other'], default: 'in_facility' },
    causeOfDeath: String,
    certifiedBy: String,
    broughtBy: { name: String, phone: String, relationship: String },
    policeCase: { obNumber: String, station: String },
    storage: { chamber: String, tray: String },
    admittedAt: { type: Date, default: Date.now },
    nextOfKin: [{ _id: false, name: String, relationship: String, phone: String, idNumber: String }],
    status: { type: String, enum: ['admitted', 'release_authorized', 'released'], default: 'admitted', index: true },
    releaseAuthorization: { by: ObjectId, byName: String, at: Date, releaseTo: String, releaseToIdNumber: String, burialPermitNumber: String, invoiceCleared: Boolean },
    releasedAt: Date,
    releasedBy: ObjectId,
    storageDaysCharged: { type: Number, default: 0 },
    createdBy: ObjectId,
  },
  { timestamps: true },
);

const documentSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', index: true },
    branchId: { type: ObjectId, ref: 'Branch', index: true },
    category: { type: String, enum: ['identification', 'lab_report', 'radiology_report', 'discharge_summary', 'consent', 'insurance', 'sha', 'dha', 'referral', 'other'], required: true },
    title: { type: String, required: true },
    fileName: String,
    mimeType: String,
    sizeBytes: Number,
    sha256: String,
    storageKey: { type: String, required: true, select: false },
    relatedTo: { resource: String, id: String },
    uploadedBy: ObjectId,
    uploadedByName: String,
    deletedAt: Date,
  },
  { timestamps: true },
);

const staffProfileSchema = new Schema(
  {
    userId: { type: ObjectId, unique: true, sparse: true },
    employeeNumber: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    branchId: { type: ObjectId, ref: 'Branch' },
    department: String,
    cadre: String,
    jobTitle: String,
    employmentType: { type: String, enum: ['permanent', 'contract', 'locum', 'intern', 'volunteer'], default: 'permanent' },
    hireDate: Date,
    licenseNumber: String,
    licenseBody: String,
    licenseExpiry: Date,
    registryId: String,
    phone: String,
    email: String,
    nationalId: String,
    kraPin: String,
    status: { type: String, enum: ['active', 'on_leave', 'terminated'], default: 'active' },
  },
  { timestamps: true },
);

const leaveRequestSchema = new Schema(
  {
    staffId: { type: ObjectId, ref: 'StaffProfile', required: true, index: true },
    type: { type: String, enum: ['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid'], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: Number,
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedBy: ObjectId,
    decidedAt: Date,
  },
  { timestamps: true },
);

const shiftSchema = new Schema(
  {
    staffId: { type: ObjectId, ref: 'StaffProfile', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    department: String,
    date: { type: Date, required: true, index: true },
    shift: { type: String, enum: ['day', 'night', 'morning', 'afternoon', 'on_call'], required: true },
    notes: String,
  },
  { timestamps: true },
);

/** Transactional outbox for FHIR/SHR synchronisation (idempotent per resource version). */
const fhirOutboxSchema = new Schema(
  {
    resourceType: { type: String, required: true },
    localResource: { type: String, required: true },
    localId: { type: String, required: true },
    version: { type: Number, default: 1 },
    idempotencyKey: { type: String, required: true, unique: true },
    payload: Mixed,
    validation: { valid: Boolean, errors: [String] },
    status: { type: String, enum: ['pending', 'queued', 'sent', 'failed', 'blocked'], default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    lastError: String,
    externalId: String,
    sentAt: Date,
  },
  { timestamps: true },
);

const passwordResetSchema = new Schema(
  {
    userId: { type: ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    /** reset = "forgot password"; welcome = new account; admin_reset = password reset by an administrator. */
    purpose: { type: String, enum: ['reset', 'welcome', 'admin_reset'], default: 'reset' },
  },
  { timestamps: true },
);

/**
 * One-time codes sent to a patient's phone to confirm it at admission. Only a hash of the code is
 * stored; a successful check issues a short-lived, single-use verification token (also hashed).
 */
const patientPhoneOtpSchema = new Schema(
  {
    patientId: { type: ObjectId, required: true, index: true },
    purpose: { type: String, enum: ['admission'], default: 'admission' },
    phone: { type: String, required: true },
    target: { type: String, enum: ['patient', 'next_of_kin', 'other'], required: true },
    savePhone: { type: Boolean, default: false },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    sends: { type: Number, default: 1 },
    lastSentAt: Date,
    verifiedAt: Date,
    tokenHash: { type: String, index: true },
    tokenExpiresAt: Date,
    usedAt: Date,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
patientPhoneOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 86_400 });

/** The facility's diagnosis / disease catalog used for suggestions (admission, consultation). */
const diagnosisSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, unique: true },
    code: { type: String, trim: true },
    system: { type: String, enum: ['ICD-11', 'ICD-10', 'local'], default: 'ICD-11' },
    category: { type: String, trim: true },
    synonyms: [String],
    /** Offered first when admitting a patient. */
    admission: { type: Boolean, default: false },
    notifiable: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, enum: ['default', 'custom', 'import'], default: 'custom' },
    createdBy: ObjectId,
  },
  { timestamps: true },
);
diagnosisSchema.index({ code: 1 });

/** A bulk SMS to patients (or a typed list of numbers). Each recipient is its own queued SMS job. */
const smsCampaignSchema = new Schema(
  {
    campaignNumber: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    audience: {
      kind: { type: String, enum: ['patients', 'numbers'], required: true },
      branchId: ObjectId,
      visitedFrom: Date,
      visitedTo: Date,
      gender: String,
      ageMin: Number,
      ageMax: Number,
      payerType: String,
      schemeId: ObjectId,
    },
    status: { type: String, enum: ['scheduled', 'sending', 'cancelled'], default: 'sending', index: true },
    scheduledAt: Date,
    recipientCount: Number,
    excluded: { noConsent: Number, noPhone: Number, duplicate: Number },
    segments: Number,
    credits: Number,
    recipients: [{ _id: false, phone: String, patientId: ObjectId, jobId: ObjectId }],
    createdBy: ObjectId,
    createdByName: String,
    cancelledByName: String,
    cancelledAt: Date,
  },
  { timestamps: true },
);
smsCampaignSchema.index({ createdAt: -1 });

export const miscSchemas = {
  SmsCampaign: smsCampaignSchema,
  DentalChart: dentalChartSchema,
  DentalVisit: dentalVisitSchema,
  MortuaryCase: mortuaryCaseSchema,
  Document: documentSchema,
  StaffProfile: staffProfileSchema,
  LeaveRequest: leaveRequestSchema,
  Shift: shiftSchema,
  FhirOutbox: fhirOutboxSchema,
  PasswordReset: passwordResetSchema,
  PatientPhoneOtp: patientPhoneOtpSchema,
  Diagnosis: diagnosisSchema,
};
