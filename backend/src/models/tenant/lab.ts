import { Schema } from 'mongoose';

const { ObjectId } = Schema.Types;

const rangeSchema = new Schema(
  {
    sex: { type: String, enum: ['any', 'male', 'female'], default: 'any' },
    ageMinDays: { type: Number, default: 0 },
    ageMaxDays: { type: Number, default: 54750 },
    low: Number,
    high: Number,
    criticalLow: Number,
    criticalHigh: Number,
    text: String,
  },
  { _id: false },
);

const labTestSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    department: { type: String, default: 'General' },
    specimen: { type: String, default: 'Blood' },
    container: String,
    turnaroundMinutes: { type: Number, default: 60 },
    serviceCode: String,
    /** Single-analyte tests have one parameter; panels have several. */
    parameters: [
      {
        _id: false,
        code: { type: String, required: true },
        name: { type: String, required: true },
        unit: String,
        type: { type: String, enum: ['numeric', 'text', 'option'], default: 'numeric' },
        options: [String],
        ranges: [rangeSchema],
      },
    ],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const resultSchema = new Schema(
  {
    parameter: String,
    name: String,
    value: String,
    numeric: Number,
    unit: String,
    referenceRange: String,
    flag: { type: String, enum: ['N', 'L', 'H', 'LL', 'HH', 'A', ''] },
    critical: { type: Boolean, default: false },
  },
  { _id: false },
);

export const LAB_ITEM_STATUSES = ['ordered', 'collected', 'received', 'processing', 'resulted', 'verified', 'approved', 'released', 'rejected', 'cancelled'] as const;

const labOrderItemSchema = new Schema({
  testCode: { type: String, required: true },
  testName: String,
  specimen: String,
  accessionNumber: { type: String, index: true },
  status: { type: String, enum: LAB_ITEM_STATUSES, default: 'ordered' },
  collectedAt: Date,
  collectedBy: ObjectId,
  receivedAt: Date,
  receivedBy: ObjectId,
  processingAt: Date,
  results: [resultSchema],
  comment: String,
  resultedAt: Date,
  resultedBy: ObjectId,
  resultedByName: String,
  verifiedAt: Date,
  verifiedBy: ObjectId,
  verifiedByName: String,
  approvedAt: Date,
  approvedBy: ObjectId,
  approvedByName: String,
  releasedAt: Date,
  rejectionReason: String,
  critical: { type: Boolean, default: false },
  criticalNotifiedAt: Date,
  /** Set when the test was ordered as part of a package (charged once for the package). */
  packageCode: String,
});

const labOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    orderedBy: ObjectId,
    orderedByName: String,
    priority: { type: String, enum: ['routine', 'urgent', 'stat'], default: 'routine' },
    clinicalNotes: String,
    /** Walk-in / external requests: who sent the patient (another clinician or facility). */
    source: { type: String, enum: ['internal', 'walk_in', 'external'], default: 'internal' },
    externalRequester: { name: String, facility: String, reference: String },
    packages: [{ _id: false, code: String, name: String }],
    items: [labOrderItemSchema],
    status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open', index: true },
  },
  { timestamps: true },
);
labOrderSchema.index({ 'items.status': 1, branchId: 1 });
labOrderSchema.index({ createdAt: -1 });

const imagingExamSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    modality: { type: String, enum: ['XR', 'US', 'CT', 'MR', 'MG', 'FL', 'ECG', 'OTHER'], required: true },
    bodyPart: String,
    serviceCode: String,
    requiresPreauth: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const radiologyRequestSchema = new Schema(
  {
    requestNumber: { type: String, required: true, unique: true },
    accessionNumber: { type: String, required: true, unique: true },
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    examCode: { type: String, required: true },
    examName: String,
    modality: String,
    clinicalIndication: String,
    priority: { type: String, enum: ['routine', 'urgent', 'stat'], default: 'routine' },
    status: { type: String, enum: ['requested', 'scheduled', 'in_progress', 'reported', 'verified', 'cancelled'], default: 'requested', index: true },
    scheduledAt: Date,
    room: String,
    performedAt: Date,
    performedBy: ObjectId,
    /** DICOM/PACS readiness: identifiers a PACS/modality worklist can use. */
    studyInstanceUid: String,
    pacsViewerUrl: String,
    report: { findings: String, impression: String, reportedBy: ObjectId, reportedByName: String, reportedAt: Date, verifiedBy: ObjectId, verifiedByName: String, verifiedAt: Date },
    attachmentIds: [ObjectId],
    requestedBy: ObjectId,
    requestedByName: String,
  },
  { timestamps: true },
);

/** A group of tests ordered and priced together (e.g. a full antenatal profile). */
const labPackageSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    description: String,
    testCodes: [{ type: String, uppercase: true }],
    serviceCode: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const labSchemas = {
  LabPackage: labPackageSchema,
  LabTest: labTestSchema,
  LabOrder: labOrderSchema,
  ImagingExam: imagingExamSchema,
  RadiologyRequest: radiologyRequestSchema,
};
