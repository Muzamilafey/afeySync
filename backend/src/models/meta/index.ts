import { Schema, type Connection, type InferSchemaType, type Model, Types } from 'mongoose';
import { getMetaConn } from '../../db/connections';

const encrypted = new Schema(
  { ciphertext: String, keyId: String, last4: String, updatedAt: Date },
  { _id: false },
);

/* ---------------------------------------------------------------- Platform users */
const platformUserSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['super_owner', 'platform_admin', 'platform_support'], default: 'platform_support' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    mfaEnabled: { type: Boolean, default: false },
    lastLoginAt: Date,
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    passwordChangedAt: Date,
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
      recoveryCodes: { type: [{ _id: false, hash: String, usedAt: Date }], select: false },
      preferred: { type: String, enum: ['totp', 'email', 'sms'] },
    },
    /** Linked Google account (OpenID Connect subject). Sign-in with Google works only for linked accounts. */
    google: { sub: String, email: String, linkedAt: Date },
  },
  { timestamps: true },
);
platformUserSchema.index({ 'google.sub': 1 }, { unique: true, partialFilterExpression: { 'google.sub': { $type: 'string' } } });

/** OpenID Connect (Google) sign-in / linking state. Only hashes of state and completion code are stored. */
const oauthStateSchema = new Schema(
  {
    provider: { type: String, enum: ['google'], required: true },
    portal: { type: String, enum: ['tenant', 'platform'], required: true },
    mode: { type: String, enum: ['login', 'link'], required: true },
    tenantId: Schema.Types.ObjectId,
    userId: Schema.Types.ObjectId,
    stateHash: { type: String, required: true, unique: true },
    nonce: { type: String, required: true },
    codeVerifier: { ciphertext: String, keyId: String },
    returnOrigin: { type: String, required: true },
    next: String,
    result: { sub: String, email: String, name: String },
    completionHash: { type: String, index: true, sparse: true },
    completedAt: Date,
    consumedAt: Date,
    error: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Short-lived second-factor challenge (login or enrollment). Only a hash of the token and code is stored. */
const mfaChallengeSchema = new Schema(
  {
    subjectType: { type: String, enum: ['tenant', 'platform'], required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true, index: true },
    tenantId: Schema.Types.ObjectId,
    purpose: { type: String, enum: ['login', 'enroll_email', 'enroll_sms'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    methods: [String],
    otp: { method: String, hash: String, sentAt: Date, sends: { type: Number, default: 0 }, target: String },
    attempts: { type: Number, default: 0 },
    consumedAt: Date,
    ip: String,
    userAgent: String,
    via: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
mfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/* ---------------------------------------------------------------- Tenants */
const tenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9][a-z0-9-]{1,40}$/ },
    name: { type: String, required: true, trim: true },
    legalName: String,
    facilityCode: { type: String, trim: true, index: true },
    registrationNumber: String,
    facilityLevel: String,
    facilityType: String,
    ownership: String,
    county: String,
    subCounty: String,
    phone: String,
    email: String,
    physicalAddress: String,
    dhaRegistry: {
      facilityRegistryCode: String,
      verifiedAt: Date,
      source: Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ['provisioning', 'active', 'suspended', 'provisioning_failed'],
      default: 'provisioning',
      index: true,
    },
    suspendedReason: String,
    provisioningError: String,
    integrations: {
      // Per-tenant enablement switches set by the platform owner.
      sha: { type: Boolean, default: false },
      dha: { type: Boolean, default: false },
      mpesa: { type: Boolean, default: false },
      africastalking: { type: Boolean, default: false },
      smtp: { type: Boolean, default: false },
    },
    stats: {
      branches: { type: Number, default: 0 },
      users: { type: Number, default: 0 },
      patients: { type: Number, default: 0 },
      lastActivityAt: Date,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'PlatformUser' },
  },
  { timestamps: true },
);

const tenantDomainSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hostname: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: ['platform_subdomain', 'custom', 'branch'], default: 'platform_subdomain' },
    branchId: Schema.Types.ObjectId,
    verified: { type: Boolean, default: false },
    verificationToken: String,
    primary: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const tenantDatabaseSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    dbName: { type: String, required: true, unique: true },
    status: { type: String, enum: ['provisioning', 'ready', 'failed'], default: 'provisioning' },
    schemaVersion: { type: Number, default: 1 },
    lastHealthCheckAt: Date,
    lastBackupAt: Date,
  },
  { timestamps: true },
);

/** Written by deploy/backup.sh after each dump (success or failure). */
const backupRunSchema = new Schema(
  {
    dbName: { type: String, required: true, index: true },
    status: { type: String, enum: ['success', 'failure'], required: true },
    file: String,
    sizeBytes: Number,
    sha256: String,
    host: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
backupRunSchema.index({ createdAt: -1 });

const tenantSubscriptionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    plan: { type: String, enum: ['trial', 'basic', 'standard', 'premium', 'enterprise'], default: 'trial' },
    status: { type: String, enum: ['trialing', 'active', 'past_due', 'cancelled'], default: 'trialing' },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'annual'], default: 'monthly' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    maxBranches: { type: Number, default: 1 },
    maxUsers: { type: Number, default: 10 },
    startsAt: { type: Date, default: Date.now },
    endsAt: Date,
    notes: String,
  },
  { timestamps: true },
);

/* ---------------------------------------------------------------- Integrations */
export const PROVIDERS = ['sha', 'dha', 'mpesa', 'africastalking', 'smtp', 'storage', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

const integrationConfigSchema = new Schema(
  {
    scope: { type: String, enum: ['platform', 'tenant'], required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    provider: { type: String, enum: PROVIDERS, required: true },
    enabled: { type: Boolean, default: false },
    environment: { type: String, enum: ['sandbox', 'uat', 'production'], default: 'uat' },
    /** Non-secret settings (base URL, facility code, sender ID, host, port ...) */
    settings: { type: Schema.Types.Mixed, default: {} },
    /** Secret fields, each AES-256-GCM encrypted by IntegrationSecretService */
    secrets: { type: Map, of: encrypted, default: {} },
    /** Platform scope only: whether tenants may supply their own credentials for this provider */
    allowTenantCredentials: { type: Boolean, default: false },
    /** Tenant scope only: prefer the facility configuration over the platform one */
    useTenantConfig: { type: Boolean, default: false },
    health: {
      status: { type: String, enum: ['unknown', 'connected', 'degraded', 'failed'], default: 'unknown' },
      lastTestAt: Date,
      lastSuccessAt: Date,
      lastFailureAt: Date,
      lastError: String,
      lastLatencyMs: Number,
    },
    updatedBy: Schema.Types.ObjectId,
  },
  { timestamps: true },
);
integrationConfigSchema.index({ scope: 1, tenantId: 1, provider: 1 }, { unique: true });

/**
 * IntegrationContract — the external API contract for a provider, editable by the platform owner so that
 * provider documentation changes do not require HMIS code changes. Operations with no `path` are declared
 * but not yet configured and will refuse to execute.
 */
const contractOperationSchema = new Schema(
  {
    key: { type: String, required: true },
    group: String,
    description: String,
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    path: { type: String, default: null },
    contentType: { type: String, default: 'application/json' },
    idempotent: { type: Boolean, default: false },
    requiresFacilityHeaders: { type: Boolean, default: false },
    documented: { type: Boolean, default: false },
    documentationRef: String,
  },
  { _id: false },
);

const integrationContractSchema = new Schema(
  {
    provider: { type: String, enum: PROVIDERS, required: true },
    environment: { type: String, default: 'uat' },
    contractVersion: { type: String, required: true },
    documentationURL: String,
    lastVerified: Date,
    verifiedBy: String,
    supportedOperations: [contractOperationSchema],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
integrationContractSchema.index({ provider: 1, environment: 1, active: 1 });

const integrationLogSchema = new Schema(
  {
    requestId: { type: String, index: true },
    tenantId: { type: Schema.Types.ObjectId, index: true },
    branchId: Schema.Types.ObjectId,
    userId: Schema.Types.ObjectId,
    provider: { type: String, index: true },
    operation: { type: String, index: true },
    method: String,
    path: String,
    status: { type: String, enum: ['success', 'failure'], index: true },
    httpStatus: Number,
    latencyMs: Number,
    externalReference: String,
    errorCode: String,
    errorMessage: String,
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
integrationLogSchema.index({ createdAt: -1 });

/* ---------------------------------------------------------------- Callbacks */
const callbackEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    tenantId: { type: Schema.Types.ObjectId, index: true },
    endpointId: Schema.Types.ObjectId,
    dedupeKey: { type: String, required: true, unique: true },
    eventType: String,
    resourceType: String,
    externalReference: { type: String, index: true },
    status: String,
    verified: { type: Boolean, default: false },
    verificationMethod: String,
    processing: {
      state: { type: String, enum: ['received', 'processed', 'unmatched', 'rejected', 'failed'], default: 'received' },
      processedAt: Date,
      error: String,
      matchedResource: String,
      matchedId: Schema.Types.ObjectId,
    },
    payload: Schema.Types.Mixed,
    sourceIp: String,
  },
  { timestamps: true },
);

const callbackEndpointSchema = new Schema(
  {
    provider: { type: String, required: true },
    tenantId: { type: Schema.Types.ObjectId, index: true, default: null },
    tokenHash: { type: String, required: true, unique: true },
    /** Only for providers that need the URL rebuilt server-side (e.g. M-Pesa CallBackURL per request). */
    tokenEncrypted: encrypted,
    hmacSecret: encrypted,
    hmacHeader: String,
    active: { type: Boolean, default: true },
    externalEndpointId: String,
    registeredOperations: [String],
    lastEventAt: Date,
  },
  { timestamps: true },
);

/* ---------------------------------------------------------------- Audit, sessions, settings, jobs */
const platformAuditSchema = new Schema(
  {
    actorId: Schema.Types.ObjectId,
    actorEmail: String,
    actorType: { type: String, enum: ['platform_user', 'system'], default: 'platform_user' },
    tenantId: Schema.Types.ObjectId,
    action: { type: String, required: true, index: true },
    resource: String,
    resourceId: String,
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    result: { type: String, enum: ['success', 'failure', 'denied'], default: 'success' },
    ip: String,
    device: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
platformAuditSchema.index({ createdAt: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  platformAuditSchema.pre(op, function () {
    throw new Error('Audit records are append-only');
  });
}

const sessionSchema = new Schema(
  {
    subjectType: { type: String, enum: ['platform', 'tenant', 'support'], required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true, index: true },
    tenantId: Schema.Types.ObjectId,
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    replacedBy: String,
    revokedAt: Date,
    revokedReason: String,
    ip: String,
    userAgent: String,
    lastUsedAt: Date,
    /** 'mfa_enroll': the user must enroll a second factor before anything else is allowed. */
    restricted: String,
    /** How the session was established (password, password+totp, google, …). */
    amr: [String],
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const platformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: Schema.Types.Mixed,
  },
  { timestamps: true },
);

const supportAccessSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    requestedByEmail: String,
    reason: { type: String, required: true },
    permissions: [String],
    durationMinutes: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'revoked'], default: 'pending' },
    approvedBy: Schema.Types.ObjectId,
    approvedByName: String,
    approvedAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

const jobSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['SMS', 'EMAIL', 'DHA_SYNC', 'SHA_CALLBACK', 'FHIR_SYNC', 'REPORT_GENERATION', 'CLAIM_PROCESSING'],
      required: true,
    },
    tenantId: Schema.Types.ObjectId,
    idempotencyKey: { type: String, required: true, unique: true },
    payload: Schema.Types.Mixed,
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed', 'dead'], default: 'queued', index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    lastError: String,
    result: Schema.Types.Mixed,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });

const schemas = {
  PlatformUser: platformUserSchema,
  Tenant: tenantSchema,
  TenantDomain: tenantDomainSchema,
  TenantDatabase: tenantDatabaseSchema,
  TenantSubscription: tenantSubscriptionSchema,
  IntegrationConfig: integrationConfigSchema,
  IntegrationContract: integrationContractSchema,
  IntegrationLog: integrationLogSchema,
  CallbackEvent: callbackEventSchema,
  CallbackEndpoint: callbackEndpointSchema,
  PlatformAuditLog: platformAuditSchema,
  Session: sessionSchema,
  PlatformSettings: platformSettingsSchema,
  SupportAccessGrant: supportAccessSchema,
  Job: jobSchema,
  BackupRun: backupRunSchema,
  MfaChallenge: mfaChallengeSchema,
  OAuthState: oauthStateSchema,
};

type Schemas = typeof schemas;
export type MetaModels = { [K in keyof Schemas]: Model<InferSchemaType<Schemas[K]>> };

function register(conn: Connection): MetaModels {
  const out = {} as Record<string, Model<unknown>>;
  for (const [name, schema] of Object.entries(schemas)) {
    out[name] = conn.models[name] ?? conn.model(name, schema as Schema);
  }
  return out as unknown as MetaModels;
}

let cached: { conn: Connection; models: MetaModels } | null = null;
export function meta(): MetaModels {
  const conn = getMetaConn();
  if (!cached || cached.conn !== conn) cached = { conn, models: register(conn) };
  return cached.models;
}

export async function ensureMetaIndexes() {
  const m = meta();
  await Promise.all(
    Object.values(m).map((model) =>
      (model as Model<unknown>).createIndexes().catch((err: { message?: string }) => {
        // Some MongoDB-compatible engines lack optional index features (e.g. TTL). Expiry is also enforced in code.
        if (!/not implemented/i.test(err.message ?? '')) throw err;
      }),
    ),
  );
}

export { Types };
