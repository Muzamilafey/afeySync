import { Schema, type Connection, type InferSchemaType, type Model } from 'mongoose';
import { billingSchemas } from './billing';
import { clinicalSchemas } from './clinical';
import { labSchemas } from './lab';
import { pharmacySchemas } from './pharmacy';
import { inpatientSchemas } from './inpatient';
import { maternitySchemas } from './maternity';
import { miscSchemas } from './misc';
import { shaSchemas } from './sha';
import { insuranceSchemas } from './insurance';

const { ObjectId, Mixed } = Schema.Types;

/* ---------------------------------------------------------------- Organization */
const branchSchema = new Schema(
  {
    branchName: { type: String, required: true, trim: true },
    branchCode: { type: String, required: true, uppercase: true, trim: true, unique: true },
    isMain: { type: Boolean, default: false },
    facilityCode: String,
    registrationNumber: String,
    facilityLevel: String,
    facilityType: String,
    county: String,
    subCounty: String,
    ward: String,
    physicalAddress: String,
    phone: String,
    email: String,
    latitude: Number,
    longitude: Number,
    logo: String,
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    bedCapacity: { type: Number, default: 0 },
    services: {
      opd: { type: Boolean, default: true },
      inpatient: { type: Boolean, default: false },
      maternity: { type: Boolean, default: false },
      laboratory: { type: Boolean, default: false },
      radiology: { type: Boolean, default: false },
      pharmacy: { type: Boolean, default: true },
      dental: { type: Boolean, default: false },
      mortuary: { type: Boolean, default: false },
      billing: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

const departmentSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, uppercase: true },
    type: { type: String, enum: ['clinical', 'support', 'administrative'], default: 'clinical' },
    branchIds: [{ type: ObjectId, index: true }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
departmentSchema.index({ code: 1 }, { unique: true });

/* ---------------------------------------------------------------- Identity & access */
const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    permissions: [{ type: String }],
    scope: { type: String, enum: ['tenant', 'branch'], default: 'branch' },
    system: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const permissionSchema = new Schema({
  key: { type: String, required: true, unique: true },
  group: String,
  description: String,
});

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    passwordHash: { type: String, required: true, select: false },
    roleIds: [{ type: ObjectId, ref: 'Role' }],
    branchAccess: { type: String, enum: ['all', 'specific'], default: 'specific' },
    branchIds: [{ type: ObjectId, ref: 'Branch', index: true }],
    defaultBranchId: { type: ObjectId, ref: 'Branch' },
    departmentIds: [{ type: ObjectId, ref: 'Department' }],
    status: { type: String, enum: ['active', 'suspended', 'invited'], default: 'active', index: true },
    mustChangePassword: { type: Boolean, default: false },
    practitioner: {
      cadre: String,
      licenseNumber: String,
      registryId: String,
      registryVerifiedAt: Date,
      registrySnapshot: Mixed,
    },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
    /** When the user last opened “What's new”; later announcements count as unread. */
    announcementsSeenAt: Date,
    /** Two-factor authentication. Secrets are AES-256-GCM encrypted; recovery codes are stored hashed. */
    mfa: {
      totp: {
        secret: { type: { ciphertext: String, keyId: String }, select: false },
        pendingSecret: { type: { ciphertext: String, keyId: String }, select: false },
        confirmedAt: Date,
        lastStep: { type: Number, default: -1 },
      },
      email: { enabledAt: Date },
      sms: { enabledAt: Date, phone: String },
      /** WebAuthn passkeys. Only the public key is stored; the private key never leaves the user's device. */
      passkeys: [{ _id: false, credentialId: String, publicKey: String, counter: { type: Number, default: 0 }, transports: [String], deviceType: String, backedUp: Boolean, name: String, rpId: String, createdAt: Date, lastUsedAt: Date }],
      recoveryCodes: { type: [{ _id: false, hash: String, usedAt: Date }], select: false },
      preferred: { type: String, enum: ['totp', 'email', 'sms', 'passkey'] },
    },
    /** Linked Google account (OpenID Connect subject). Sign-in with Google works only for linked accounts. */
    google: { sub: String, email: String, linkedAt: Date },
  },
  { timestamps: true },
);
userSchema.index({ 'google.sub': 1 }, { unique: true, partialFilterExpression: { 'google.sub': { $type: 'string' } } });

/* ---------------------------------------------------------------- Patients */
export const IDENTIFICATION_TYPES = [
  'National ID',
  'ClientRegistry ID',
  'Birth Notification',
  'Birth Certificate',
  'Alien ID',
  'Refugee ID',
  'Mandate Number',
  'Passport',
  'SHA Number',
  'Insurance Number',
  'Other',
] as const;

const identifierSchema = new Schema(
  {
    type: { type: String, enum: IDENTIFICATION_TYPES, required: true },
    value: { type: String, required: true, trim: true },
    system: String,
    source: { type: String, enum: ['local', 'dha'], default: 'local' },
  },
  { _id: false },
);

const patientSchema = new Schema(
  {
    patientNumber: { type: String, required: true, unique: true },
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, required: true, trim: true },
    searchName: { type: String, index: true },
    gender: { type: String, enum: ['male', 'female', 'other', 'unknown'], required: true },
    dateOfBirth: Date,
    dobEstimated: { type: Boolean, default: false },
    maritalStatus: String,
    occupation: String,
    nationality: { type: String, default: 'Kenyan' },
    phone: { type: String, index: true },
    altPhone: String,
    email: String,
    nationalId: { type: String, index: true, sparse: true },
    clientRegistryId: { type: String, index: true, sparse: true },
    shaNumber: { type: String, index: true, sparse: true },
    identifiers: [identifierSchema],
    address: { county: String, subCounty: String, ward: String, village: String, physicalAddress: String },
    nextOfKin: [{ _id: false, name: String, relationship: String, phone: String, idNumber: String }],
    insurance: [
      {
        _id: false,
        provider: String,
        scheme: String,
        memberNumber: { type: String, index: true },
        principalName: String,
        relationship: String,
        validTo: Date,
      },
    ],
    sha: {
      status: { type: String, enum: ['unknown', 'eligible', 'not_eligible', 'error'], default: 'unknown' },
      lastCheckedAt: Date,
      lastCheckId: ObjectId,
      /** From SHA eligibility (isAlive). false blocks every SHA transaction for this patient. */
      isAlive: Boolean,
      whitelistedForOTP: Boolean,
      facilityBiometricsEnforced: Boolean,
      /** Payer's biometric_status.use_sil_biometrics: true means this child consents by their own enrolled fingerprint. */
      useSilBiometrics: Boolean,
      schemes: Mixed,
      pomsf: Mixed,
    },
    consent: {
      dataSharing: { type: Boolean, default: false },
      sms: { type: Boolean, default: true },
      capturedAt: Date,
      capturedBy: ObjectId,
    },
    allergies: [{ _id: false, substance: String, reaction: String, severity: String, recordedAt: Date }],
    registeredBranchId: { type: ObjectId, required: true },
    /** The shared “walk-in customer” account each branch uses for counter sales; hidden from patient lists. */
    walkInAccount: { type: Boolean, default: false },
    /** Mother–baby linkage for newborns registered at delivery. */
    motherId: { type: ObjectId, ref: 'Patient', index: true, sparse: true },
    deceasedAt: Date,
    branchIds: [{ type: ObjectId, index: true }],
    dha: {
      source: { type: String, enum: ['local', 'client_registry'], default: 'local' },
      importedAt: Date,
      lastSyncedAt: Date,
      snapshotHash: String,
    },
    status: { type: String, enum: ['active', 'deceased', 'merged', 'inactive'], default: 'active' },
    mergedInto: ObjectId,
    createdBy: ObjectId,
    updatedBy: ObjectId,
  },
  { timestamps: true },
);
patientSchema.index({ 'identifiers.type': 1, 'identifiers.value': 1 });
patientSchema.index({ createdAt: -1 });
patientSchema.pre('save', function () {
  this.searchName = [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ').toLowerCase();
});

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });

/* ---------------------------------------------------------------- SHA / DHA tracking */
const shaEligibilitySchema = new Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', index: true },
    branchId: { type: ObjectId, ref: 'Branch', index: true },
    identificationType: String,
    identificationNumberMasked: String,
    eligible: Boolean,
    status: { type: String, enum: ['eligible', 'not_eligible', 'error'] },
    summary: Mixed,
    raw: Mixed,
    errorCode: String,
    checkedBy: ObjectId,
  },
  { timestamps: true },
);
shaEligibilitySchema.index({ createdAt: -1 });

/** Authorizations, visit consents, preauthorizations and claims submitted to SHA via the HIE. */
const shaTransactionSchema = new Schema(
  {
    kind: { type: String, enum: ['authorization', 'visit_consent', 'preauthorization', 'claim', 'emergency_claim'], required: true, index: true },
    reference: { type: String, required: true, unique: true },
    externalReference: { type: String, index: true, sparse: true },
    idempotencyKey: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    visitId: { type: ObjectId, ref: 'Visit' },
    invoiceId: { type: ObjectId, ref: 'Invoice', index: true },
    shaVisitId: { type: ObjectId, ref: 'ShaVisit', index: true },
    /** For claims raised under a preauthorization / authorization. */
    parentId: { type: ObjectId, ref: 'ShaTransaction' },
    benefitCode: String,
    interventionCode: String,
    accessPoint: String,
    diagnoses: [{ _id: false, code: String, display: String, system: String }],
    lines: [{ _id: false, serviceCode: String, description: String, quantity: Number, unitPrice: Number, amount: Number }],
    clinicalJustification: String,
    amounts: { claimed: Number, approved: Number, paid: Number },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'pending', 'approved', 'rejected', 'intervention_required', 'cancelled', 'paid', 'failed'],
      default: 'draft',
      index: true,
    },
    statusHistory: [{ _id: false, status: String, at: Date, source: String, note: String }],
    requestPayload: Mixed,
    lastResponse: Mixed,
    submissions: { type: Number, default: 0 },
    submittedAt: Date,
    submittedBy: ObjectId,
    decisionNote: String,
    attachmentIds: [{ type: ObjectId, ref: 'Document' }],
    /** SHA remittances recorded against this claim (each posts a Payment with method 'sha'). */
    remittances: [{ _id: false, amount: Number, reference: String, paymentId: ObjectId, at: Date, by: ObjectId }],
    /** Emergency claims: protocols applied and attending doctors, as registered with SHA. */
    emergency: {
      protocols: [{ _id: false, code: String, name: String, notes: String, addedAt: Date, by: ObjectId }],
      doctors: [{ _id: false, userId: ObjectId, name: String, registrationNumber: String, addedAt: Date }],
    },
    createdBy: ObjectId,
  },
  { timestamps: true },
);

/* ---------------------------------------------------------------- Audit & notifications */
const auditLogSchema = new Schema(
  {
    userId: ObjectId,
    userName: String,
    actorType: { type: String, enum: ['user', 'support', 'system', 'integration'], default: 'user' },
    branchId: { type: ObjectId, ref: 'Branch' },
    action: { type: String, required: true, index: true },
    resource: { type: String, index: true },
    resourceId: { type: String, index: true },
    oldValue: Mixed,
    newValue: Mixed,
    result: { type: String, enum: ['success', 'failure', 'denied'], default: 'success' },
    ip: String,
    device: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) {
  auditLogSchema.pre(op, function () {
    throw new Error('Audit records are append-only');
  });
}

const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, index: true },
    branchId: { type: ObjectId, ref: 'Branch' },
    event: String,
    title: String,
    body: String,
    link: String,
    readAt: Date,
  },
  { timestamps: true },
);

const facilitySettingsSchema = new Schema(
  { key: { type: String, required: true, unique: true }, value: Mixed },
  { timestamps: true },
);

const coreSchemas = {
  Branch: branchSchema,
  Department: departmentSchema,
  Role: roleSchema,
  Permission: permissionSchema,
  User: userSchema,
  Patient: patientSchema,
  Counter: counterSchema,
  ShaEligibilityCheck: shaEligibilitySchema,
  ShaTransaction: shaTransactionSchema,
  AuditLog: auditLogSchema,
  Notification: notificationSchema,
  FacilitySetting: facilitySettingsSchema,
};

const schemas = { ...coreSchemas, ...billingSchemas, ...clinicalSchemas, ...labSchemas, ...pharmacySchemas, ...inpatientSchemas, ...maternitySchemas, ...miscSchemas, ...shaSchemas, ...insuranceSchemas };

type Schemas = typeof schemas;
export type TenantModels = { [K in keyof Schemas]: Model<InferSchemaType<Schemas[K]>> };

const cache = new WeakMap<Connection, TenantModels>();

export function tenantModels(conn: Connection): TenantModels {
  let m = cache.get(conn);
  if (!m) {
    const out = {} as Record<string, Model<unknown>>;
    for (const [name, schema] of Object.entries(schemas)) {
      out[name] = conn.models[name] ?? conn.model(name, schema as Schema);
    }
    m = out as unknown as TenantModels;
    cache.set(conn, m);
  }
  return m;
}

export async function ensureTenantIndexes(conn: Connection) {
  const m = tenantModels(conn);
  await Promise.all(
    Object.values(m).map((model) =>
      (model as Model<unknown>).createIndexes().catch((err: { message?: string }) => {
        // Some MongoDB-compatible engines lack optional index features (e.g. TTL). Expiry is also enforced in code.
        if (!/not implemented/i.test(err.message ?? '')) throw err;
      }),
    ),
  );
}

export async function nextSequence(m: TenantModels, key: string): Promise<number> {
  const bump = () => m.Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  try {
    return (await bump())!.seq;
  } catch (err) {
    // Two first-ever increments race to insert the counter; the loser retries against the now-existing one.
    if ((err as { code?: number }).code === 11000) return (await bump())!.seq;
    throw err;
  }
}
