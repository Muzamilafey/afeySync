import { Schema } from 'mongoose';

const { ObjectId } = Schema.Types;

export const BED_CATEGORIES = ['normal', 'icu', 'hdu', 'newborn', 'dialysis', 'maternity', 'isolation'] as const;

const wardSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, uppercase: true },
    branchId: { type: ObjectId, required: true, index: true },
    type: { type: String, enum: ['general', 'maternity', 'pediatric', 'surgical', 'icu', 'hdu', 'newborn', 'dialysis', 'isolation'], default: 'general' },
    gender: { type: String, enum: ['any', 'male', 'female'], default: 'any' },
    bedChargeServiceCode: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
wardSchema.index({ branchId: 1, code: 1 }, { unique: true });

const bedSchema = new Schema(
  {
    wardId: { type: ObjectId, required: true, index: true },
    branchId: { type: ObjectId, required: true, index: true },
    number: { type: String, required: true },
    category: { type: String, enum: BED_CATEGORIES, default: 'normal' },
    status: { type: String, enum: ['available', 'occupied', 'cleaning', 'maintenance'], default: 'available', index: true },
    admissionId: ObjectId,
  },
  { timestamps: true },
);
bedSchema.index({ wardId: 1, number: 1 }, { unique: true });

const admissionSchema = new Schema(
  {
    admissionNumber: { type: String, required: true, unique: true },
    visitId: { type: ObjectId, index: true },
    patientId: { type: ObjectId, required: true, index: true },
    branchId: { type: ObjectId, required: true, index: true },
    wardId: { type: ObjectId, required: true },
    bedId: { type: ObjectId, required: true },
    admittingDoctorId: ObjectId,
    admittingDoctorName: String,
    admissionDiagnosis: String,
    admissionType: { type: String, enum: ['elective', 'emergency', 'maternity', 'transfer_in'], default: 'emergency' },
    status: { type: String, enum: ['admitted', 'discharged', 'deceased', 'absconded', 'referred'], default: 'admitted', index: true },
    admittedAt: { type: Date, default: Date.now },
    transfers: [{ _id: false, fromWardId: ObjectId, fromBedId: ObjectId, toWardId: ObjectId, toBedId: ObjectId, at: Date, by: ObjectId, reason: String }],
    discharge: {
      at: Date,
      by: ObjectId,
      byName: String,
      outcome: { type: String, enum: ['recovered', 'improved', 'referred', 'against_advice', 'absconded', 'deceased'] },
      summary: String,
      finalDiagnosis: String,
      dischargeMedications: String,
      followUp: String,
    },
    bedDaysCharged: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/** Nursing notes, doctor rounds and progress notes share one append-only structure. */
const clinicalNoteSchema = new Schema(
  {
    admissionId: { type: ObjectId, required: true, index: true },
    patientId: { type: ObjectId, required: true },
    branchId: { type: ObjectId, required: true },
    kind: { type: String, enum: ['nursing', 'doctor_round', 'progress', 'handover'], required: true },
    text: { type: String, required: true },
    by: ObjectId,
    byName: String,
  },
  { timestamps: true },
);

const medicationAdministrationSchema = new Schema(
  {
    admissionId: { type: ObjectId, required: true, index: true },
    patientId: { type: ObjectId, required: true },
    branchId: { type: ObjectId, required: true },
    prescriptionId: ObjectId,
    drugName: { type: String, required: true },
    dose: String,
    route: String,
    scheduledAt: Date,
    status: { type: String, enum: ['given', 'held', 'refused', 'missed'], required: true },
    givenAt: { type: Date, default: Date.now },
    by: ObjectId,
    byName: String,
    notes: String,
  },
  { timestamps: true },
);

const fluidEntrySchema = new Schema(
  {
    admissionId: { type: ObjectId, required: true, index: true },
    branchId: { type: ObjectId, required: true },
    direction: { type: String, enum: ['intake', 'output'], required: true },
    route: { type: String, required: true },
    volumeMl: { type: Number, required: true, min: 0 },
    at: { type: Date, default: Date.now },
    by: ObjectId,
  },
  { timestamps: true },
);

export const inpatientSchemas = {
  Ward: wardSchema,
  Bed: bedSchema,
  Admission: admissionSchema,
  ClinicalNote: clinicalNoteSchema,
  MedicationAdministration: medicationAdministrationSchema,
  FluidEntry: fluidEntrySchema,
};
