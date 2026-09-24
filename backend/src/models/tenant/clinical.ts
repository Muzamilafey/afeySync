import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

export const VISIT_TYPES = ['opd', 'emergency', 'inpatient', 'maternity', 'mch', 'dental', 'family_planning', 'walk_in_pharmacy', 'walk_in_lab'] as const;
export const QUEUE_STAGES = ['triage', 'consultation', 'laboratory', 'radiology', 'pharmacy', 'billing', 'nursing', 'dental', 'mch', 'maternity'] as const;

const appointmentSchema = new Schema(
  {
    appointmentNumber: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    department: String,
    providerId: ObjectId,
    providerName: String,
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 15 },
    reason: String,
    status: { type: String, enum: ['booked', 'checked_in', 'completed', 'cancelled', 'no_show'], default: 'booked', index: true },
    visitId: { type: ObjectId, ref: 'Visit' },
    cancelReason: String,
    reminderSent: { type: Boolean, default: false },
    createdBy: ObjectId,
  },
  { timestamps: true },
);

const visitSchema = new Schema(
  {
    visitNumber: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    type: { type: String, enum: VISIT_TYPES, default: 'opd' },
    status: { type: String, enum: ['open', 'in_progress', 'admitted', 'closed', 'cancelled'], default: 'open', index: true },
    priority: { type: String, enum: ['normal', 'urgent', 'emergency'], default: 'normal' },
    payer: {
      type: { type: String, enum: ['cash', 'sha', 'insurance', 'corporate'], default: 'cash' },
      scheme: String,
      memberNumber: String,
      shaEligibilityCheckId: ObjectId,
      shaVisitConsentId: ObjectId,
    },
    department: String,
    attendingProviderId: ObjectId,
    appointmentId: ObjectId,
    referralIn: { from: String, facilityCode: String, reason: String, referenceNumber: String },
    complaint: String,
    arrivedAt: { type: Date, default: Date.now },
    closedAt: Date,
    invoiceId: { type: ObjectId, ref: 'Invoice' },
    createdBy: ObjectId,
  },
  { timestamps: true },
);
visitSchema.index({ createdAt: -1 });

const queueEntrySchema = new Schema(
  {
    visitId: { type: ObjectId, ref: 'Visit', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    stage: { type: String, enum: QUEUE_STAGES, required: true, index: true },
    ticket: { type: String, required: true },
    priority: { type: String, enum: ['normal', 'urgent', 'emergency'], default: 'normal' },
    status: { type: String, enum: ['waiting', 'called', 'in_service', 'done', 'skipped', 'cancelled'], default: 'waiting', index: true },
    assignedTo: ObjectId,
    room: String,
    notes: String,
    calledAt: Date,
    calledBy: ObjectId,
    startedAt: Date,
    doneAt: Date,
    servedBy: ObjectId,
  },
  { timestamps: true },
);
queueEntrySchema.index({ branchId: 1, stage: 1, status: 1, createdAt: 1 });

const vitalsSchema = new Schema(
  {
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission', index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    temperatureC: Number,
    pulse: Number,
    respiratoryRate: Number,
    systolic: Number,
    diastolic: Number,
    spo2: Number,
    weightKg: Number,
    heightCm: Number,
    bmi: Number,
    muacCm: Number,
    painScore: Number,
    bloodGlucose: Number,
    triageCategory: { type: String, enum: ['emergency', 'priority', 'queue', null] },
    flags: [String],
    notes: String,
    recordedBy: ObjectId,
    recordedByName: String,
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

const diagnosisSchema = new Schema(
  { code: String, display: { type: String, required: true }, system: { type: String, default: 'ICD-11' }, type: { type: String, enum: ['primary', 'secondary', 'provisional'], default: 'primary' } },
  { _id: false },
);

/**
 * Consultation (clinical encounter note). Once finalized the record is immutable; corrections are
 * captured as signed addenda, never by silently overwriting clinical content.
 */
const consultationSchema = new Schema(
  {
    visitId: { type: ObjectId, ref: 'Visit', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    providerId: { type: ObjectId, required: true },
    providerName: String,
    chiefComplaint: String,
    historyOfPresentingIllness: String,
    reviewOfSystems: String,
    pastHistory: String,
    examination: String,
    assessment: String,
    diagnoses: [diagnosisSchema],
    plan: String,
    followUpDate: Date,
    followUpNotes: String,
    status: { type: String, enum: ['draft', 'final'], default: 'draft', index: true },
    finalizedAt: Date,
    finalizedBy: ObjectId,
    addenda: [{ _id: false, text: String, reason: String, by: ObjectId, byName: String, at: Date }],
  },
  { timestamps: true },
);

const procedureSchema = new Schema(
  {
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    serviceCode: String,
    name: { type: String, required: true },
    status: { type: String, enum: ['ordered', 'done', 'cancelled'], default: 'ordered' },
    notes: String,
    performedBy: ObjectId,
    performedAt: Date,
    orderedBy: ObjectId,
  },
  { timestamps: true },
);

const referralSchema = new Schema(
  {
    referralNumber: { type: String, required: true, unique: true },
    visitId: { type: ObjectId, ref: 'Visit' },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    direction: { type: String, enum: ['out', 'in', 'internal'], required: true },
    toFacility: String,
    toFacilityCode: String,
    toDepartment: String,
    reason: { type: String, required: true },
    clinicalSummary: String,
    urgency: { type: String, enum: ['routine', 'urgent', 'emergency'], default: 'routine' },
    status: { type: String, enum: ['created', 'sent', 'accepted', 'completed', 'cancelled'], default: 'created' },
    createdBy: ObjectId,
  },
  { timestamps: true },
);

export const clinicalSchemas = {
  Appointment: appointmentSchema,
  Visit: visitSchema,
  QueueEntry: queueEntrySchema,
  Vitals: vitalsSchema,
  Consultation: consultationSchema,
  Procedure: procedureSchema,
  Referral: referralSchema,
};
export { Mixed };
