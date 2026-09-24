import { Schema } from 'mongoose';

const { ObjectId } = Schema.Types;

const pregnancySchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    ancNumber: { type: String, required: true, unique: true },
    lmp: Date,
    edd: Date,
    eddByUltrasound: Date,
    gravida: { type: Number, min: 1 },
    para: { type: Number, min: 0 },
    abortions: { type: Number, default: 0 },
    livingChildren: { type: Number, default: 0 },
    obstetricHistory: [{ _id: false, year: Number, outcome: String, mode: String, gestationWeeks: Number, birthWeightKg: Number, complications: String }],
    riskFactors: [String],
    riskLevel: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
    bloodGroup: String,
    hivStatus: String,
    status: { type: String, enum: ['active', 'in_labour', 'delivered', 'closed'], default: 'active', index: true },
    createdBy: ObjectId,
  },
  { timestamps: true },
);

const ancVisitSchema = new Schema(
  {
    pregnancyId: { type: ObjectId, ref: 'Pregnancy', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    visitId: { type: ObjectId, ref: 'Visit' },
    contactNumber: Number,
    gestationWeeks: Number,
    weightKg: Number,
    systolic: Number,
    diastolic: Number,
    fundalHeightCm: Number,
    fetalHeartRate: Number,
    presentation: String,
    fetalMovement: String,
    haemoglobin: Number,
    urineProtein: String,
    interventions: [String],
    notes: String,
    nextVisit: Date,
    by: ObjectId,
    byName: String,
  },
  { timestamps: true },
);

const labourSchema = new Schema(
  {
    pregnancyId: { type: ObjectId, ref: 'Pregnancy', required: true, index: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    startedAt: { type: Date, default: Date.now },
    activePhaseAt: Date,
    membranesRupturedAt: Date,
    partograph: [
      {
        _id: false,
        at: { type: Date, required: true },
        cervicalDilationCm: Number,
        descentFifths: Number,
        contractionsPer10: Number,
        contractionDurationSec: Number,
        fetalHeartRate: Number,
        liquor: String,
        moulding: String,
        maternalPulse: Number,
        systolic: Number,
        diastolic: Number,
        temperatureC: Number,
        oxytocin: String,
        drugs: String,
        urine: String,
        alerts: [String],
        by: ObjectId,
      },
    ],
    status: { type: String, enum: ['in_progress', 'delivered', 'referred'], default: 'in_progress' },
  },
  { timestamps: true },
);

const deliverySchema = new Schema(
  {
    pregnancyId: { type: ObjectId, ref: 'Pregnancy', required: true, index: true },
    motherId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    deliveredAt: { type: Date, required: true },
    mode: { type: String, enum: ['SVD', 'assisted_vacuum', 'assisted_forceps', 'breech', 'c_section'], required: true },
    cSection: { indication: String, type: { type: String, enum: ['elective', 'emergency'] }, surgeon: String, anaesthesia: String },
    gestationWeeks: Number,
    bloodLossMl: Number,
    placenta: String,
    perineum: String,
    complications: [String],
    maternalOutcome: { type: String, enum: ['alive', 'referred', 'deceased'], default: 'alive' },
    attendantName: String,
    babies: [
      {
        _id: false,
        newbornPatientId: { type: ObjectId, ref: 'Patient' },
        sex: { type: String, enum: ['male', 'female', 'unknown'] },
        birthWeightGrams: Number,
        apgar1: Number,
        apgar5: Number,
        apgar10: Number,
        outcome: { type: String, enum: ['live_birth', 'fresh_stillbirth', 'macerated_stillbirth', 'neonatal_death'], default: 'live_birth' },
        resuscitation: Boolean,
        notes: String,
      },
    ],
    recordedBy: ObjectId,
  },
  { timestamps: true },
);

const pncVisitSchema = new Schema(
  {
    motherId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    deliveryId: { type: ObjectId, ref: 'Delivery' },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    daysPostpartum: Number,
    motherFindings: String,
    babyFindings: String,
    breastfeeding: String,
    fpCounselled: Boolean,
    notes: String,
    by: ObjectId,
  },
  { timestamps: true },
);

const immunizationSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    vaccine: { type: String, required: true },
    dose: { type: Number, default: 1 },
    givenAt: { type: Date, default: Date.now },
    batchNumber: String,
    site: String,
    nextDue: Date,
    by: ObjectId,
    byName: String,
  },
  { timestamps: true },
);

const growthSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    measuredAt: { type: Date, default: Date.now },
    ageMonths: Number,
    weightKg: Number,
    heightCm: Number,
    muacCm: Number,
    headCircumferenceCm: Number,
    nutritionStatus: String,
    notes: String,
    by: ObjectId,
  },
  { timestamps: true },
);

const fpVisitSchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true },
    visitType: { type: String, enum: ['new', 'revisit', 'removal', 'switch'], default: 'new' },
    method: { type: String, enum: ['coc_pills', 'pop_pills', 'injectable_dmpa', 'implant', 'iucd', 'condoms', 'emergency_pill', 'btl', 'vasectomy', 'lam', 'natural', 'counselling_only'], required: true },
    counselling: String,
    sideEffects: String,
    quantity: Number,
    batchNumber: String,
    nextDue: Date,
    by: ObjectId,
    byName: String,
  },
  { timestamps: true },
);

export const maternitySchemas = {
  Pregnancy: pregnancySchema,
  AncVisit: ancVisitSchema,
  Labour: labourSchema,
  Delivery: deliverySchema,
  PncVisit: pncVisitSchema,
  Immunization: immunizationSchema,
  GrowthRecord: growthSchema,
  FpVisit: fpVisitSchema,
};
