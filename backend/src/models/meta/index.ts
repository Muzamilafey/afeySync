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
    purpose: { type: String, enum: ['login', 'enroll_email', 'enroll_sms', 'enroll_passkey'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    methods: [String],
    otp: { method: String, hash: String, sentAt: Date, sends: { type: Number, default: 0 }, target: String },
    /** Single-use WebAuthn challenge (base64url) for passkey registration or sign-in. */
    webauthnChallenge: String,
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
    /** DHA HIE connection status for this facility (the FR code itself lives in dhaRegistry.facilityRegistryCode). */
    hie: {
      lastSuccessfulConnectionAt: Date,
      lastError: String,
      lastErrorAt: Date,
    },
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
    /** Public look of the facility's own address (sign-in page, app header, installed app). Not sensitive. */
    branding: {
      displayName: String,
      tagline: String,
      welcomeMessage: String,
      primaryColor: String,
      logoVersion: String,
      logoMimeType: String,
      updatedAt: Date,
    },
    integrations: {
      // Per-tenant enablement switches set by the platform owner.
      sha: { type: Boolean, default: false },
      dha: { type: Boolean, default: false },
      mpesa: { type: Boolean, default: false },
      africastalking: { type: Boolean, default: false },
      talksasa: { type: Boolean, default: false },
      smtp: { type: Boolean, default: false },
      slade360: { type: Boolean, default: false },
    },
    /** Which SMS gateway this facility uses: auto = Africa's Talking, then Talksasa, whichever is set up. */
    smsGateway: { type: String, enum: ['auto', 'africastalking', 'talksasa'], default: 'auto' },
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
    /** Key of a SubscriptionPlan (owner-defined). Unknown keys keep every module available (legacy tenants). */
    plan: { type: String, default: 'trial' },
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
export const PROVIDERS = ['sha', 'dha', 'mpesa', 'africastalking', 'talksasa', 'smtp', 'storage', 'google', 'slade360', 'mpesa_billing'] as const;
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
    verification: { type: String, enum: ['documented', 'spec_unverified', 'owner_verified'] },
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

/**
 * Self-service facility registration. An application is created unverified, becomes `submitted`
 * once the applicant proves control of the administrator email, and is provisioned only on
 * approval (by a platform owner, or automatically when the owner enables it). The chosen admin
 * password is stored only as a hash; the email code only as a hash.
 */
const facilityApplicationSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ['email_pending', 'submitted', 'approved', 'rejected'], default: 'email_pending', index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    slug: { type: String, required: true, index: true },
    facility: {
      name: String, legalName: String, facilityType: String, facilityLevel: String, ownership: String, facilityCode: String, registrationNumber: String,
      county: String, subCounty: String, physicalAddress: String, phone: String, email: String, dhaFacilityRegistryCode: String, bedCapacity: Number,
    },
    branches: [{ _id: false, branchName: String, branchCode: String, county: String, subCounty: String, physicalAddress: String, phone: String }],
    admin: { name: String, email: { type: String, index: true }, phone: String, jobTitle: String, passwordHash: { type: String, select: false } },
    plan: { type: String, default: 'trial' },
    interests: [String],
    expectedUsers: Number,
    heardFrom: String,
    notes: String,
    termsAcceptedAt: Date,
    verification: { codeHash: { type: String, select: false }, sentAt: Date, sends: { type: Number, default: 0 }, attempts: { type: Number, default: 0 }, verifiedAt: Date },
    submittedAt: Date,
    reviewedBy: Schema.Types.ObjectId,
    reviewedByName: String,
    reviewedAt: Date,
    rejectionReason: String,
    autoApproved: Boolean,
    tenantId: Schema.Types.ObjectId,
    provisioningError: String,
    ip: String,
    userAgent: String,
    /** Unverified applications are removed automatically after this time. */
    expiresAt: Date,
  },
  { timestamps: true },
);
facilityApplicationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/* ---------------------------------------------------------------- Plans & platform billing */
const subscriptionPlanSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    currency: { type: String, default: 'KES' },
    /** Price per billing cycle (0 = on request). */
    prices: { monthly: { type: Number, default: 0 }, quarterly: { type: Number, default: 0 }, annual: { type: Number, default: 0 } },
    setupFee: { type: Number, default: 0 },
    maxBranches: { type: Number, default: 1 },
    maxUsers: { type: Number, default: 10 },
    trialDays: { type: Number, default: 0 },
    /** Optional module keys included in the plan (core modules are always included). */
    modules: [String],
    features: [String],
    public: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    highlight: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const docLineSchema = new Schema(
  { description: { type: String, required: true }, quantity: { type: Number, default: 1 }, unitPrice: { type: Number, default: 0 }, amount: { type: Number, default: 0 }, kind: { type: String, enum: ['subscription', 'setup', 'service', 'other'], default: 'service' }, planKey: String, billingCycle: String, periods: Number },
  { _id: false },
);

/** Quotations, invoices and contracts issued by the platform owner to facilities (or prospects). */
const billingDocumentSchema = new Schema(
  {
    type: { type: String, enum: ['quotation', 'invoice', 'contract'], required: true, index: true },
    number: { type: String, required: true, unique: true },
    status: { type: String, enum: ['draft', 'issued', 'accepted', 'declined', 'partially_paid', 'paid', 'void', 'expired'], default: 'draft', index: true },
    tenantId: { type: Schema.Types.ObjectId, index: true },
    customer: { name: String, contactName: String, email: String, phone: String, address: String, kraPin: String },
    currency: { type: String, default: 'KES' },
    lines: [docLineSchema],
    subtotal: { type: Number, default: 0 },
    vatRate: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    issueDate: Date,
    dueDate: Date,
    validUntil: Date,
    notes: String,
    terms: String,
    contract: { planKey: String, billingCycle: String, amount: Number, startDate: Date, termMonths: Number, specialTerms: String, body: String },
    sourceQuotationId: Schema.Types.ObjectId,
    convertedInvoiceId: Schema.Types.ObjectId,
    /** Frozen at issue: who signed and which stamp/signature/logo versions were applied, plus a content hash. */
    signing: { signedAt: Date, signatoryName: String, signatoryTitle: String, signatureAssetId: Schema.Types.ObjectId, stampAssetId: Schema.Types.ObjectId, logoAssetId: Schema.Types.ObjectId, business: Schema.Types.Mixed, hash: String },
    acceptance: { at: Date, byName: String, byTitle: String, byEmail: String, userId: Schema.Types.ObjectId, ip: String, userAgent: String },
    subscriptionAppliedAt: Date,
    sentAt: Date,
    sentTo: String,
    voidReason: String,
    history: [{ _id: false, at: Date, action: String, byName: String, note: String }],
    createdBy: Schema.Types.ObjectId,
  },
  { timestamps: true },
);
billingDocumentSchema.index({ tenantId: 1, type: 1, createdAt: -1 });

const platformPaymentSchema = new Schema(
  {
    /** invoice = pays a subscription invoice; sms_topup = buys SMS credits for a facility's SMS wallet. */
    purpose: { type: String, enum: ['invoice', 'sms_topup'], default: 'invoice', index: true },
    smsCredits: Number,
    /** KES per SMS credit at the time of the top-up request. */
    smsPrice: Number,
    documentId: { type: Schema.Types.ObjectId, index: true },
    tenantId: { type: Schema.Types.ObjectId, index: true },
    method: { type: String, enum: ['mpesa_stk', 'mpesa_c2b', 'bank', 'cash', 'cheque', 'other'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
    reference: String,
    mpesa: { checkoutRequestId: { type: String, index: true }, merchantRequestId: String, phone: String, receiptNumber: String, resultCode: Number, resultDesc: String, transactionDate: String, billRef: String, payerName: String },
    notes: String,
    receivedAt: Date,
    recordedBy: Schema.Types.ObjectId,
    recordedByName: String,
    initiatedBy: String,
  },
  { timestamps: true },
);
platformPaymentSchema.index({ 'mpesa.receiptNumber': 1 }, { unique: true, partialFilterExpression: { 'mpesa.receiptNumber': { $type: 'string' } } });

const platformCounterSchema = new Schema({ key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } });

/** Owner branding used on documents. Versions are never overwritten, so issued documents keep the images they were signed with. */
const brandAssetSchema = new Schema(
  {
    kind: { type: String, enum: ['logo', 'stamp', 'signature'], required: true, index: true },
    mimeType: { type: String, required: true },
    data: { type: Buffer, required: true, select: false },
    sha256: String,
    sizeBytes: Number,
    current: { type: Boolean, default: true },
    uploadedBy: Schema.Types.ObjectId,
    uploadedByName: String,
  },
  { timestamps: true },
);

/** A facility's logo, kept apart from Tenant so tenant lookups stay small. One current logo per facility. */
const tenantLogoSchema = new Schema(
  { tenantId: { type: Schema.Types.ObjectId, required: true, unique: true }, mimeType: { type: String, required: true }, data: { type: Buffer, required: true }, sha256: String, sizeBytes: Number },
  { timestamps: true },
);

/** A facility's prepaid SMS credits (1 credit = 1 SMS segment of up to 160 characters). */
const smsWalletSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, unique: true },
    balance: { type: Number, default: 0 },
    /** When the low / empty balance alerts were last sent (cleared on every credit). */
    lowAlertAt: Date,
    emptyAlertAt: Date,
  },
  { timestamps: true },
);

/** Every change to an SMS wallet. The key makes each entry happen at most once (welcome grant, a payment, a job attempt). */
const smsLedgerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ['welcome', 'topup', 'debit', 'refund', 'adjustment'], required: true },
    credits: { type: Number, required: true },
    balanceAfter: Number,
    key: { type: String, required: true, unique: true },
    note: String,
    paymentId: Schema.Types.ObjectId,
    jobId: Schema.Types.ObjectId,
    byName: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
smsLedgerSchema.index({ tenantId: 1, createdAt: -1 });

/** Which facilities have a user with this email (hashed), so sign-in on the main domain can find them. */
const userDirectorySchema = new Schema({ emailHash: { type: String, required: true }, tenantId: { type: Schema.Types.ObjectId, required: true } }, { timestamps: true });
userDirectorySchema.index({ emailHash: 1, tenantId: 1 }, { unique: true });

/** Single-use, short-lived handoff from the main-domain sign-in to a facility's own address. */
const loginHandoffSchema = new Schema(
  { tokenHash: { type: String, required: true, unique: true }, tenantId: { type: Schema.Types.ObjectId, required: true }, userId: { type: Schema.Types.ObjectId, required: true }, usedAt: Date, ip: String, uaHash: String, facilitySlug: String, purpose: { type: String, enum: ['handoff', 'select'], default: 'handoff' }, mfaDone: Boolean, amr: [String], expiresAt: { type: Date, required: true } },
  { timestamps: true },
);
loginHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** An article on the public website, written in the owner portal (Markdown; no raw HTML is ever rendered). */
const blogPostSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: String,
    content: { type: String, default: '' },
    coverImageId: Schema.Types.ObjectId,
    coverAlt: String,
    category: String,
    tags: [String],
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: Date,
    seoTitle: String,
    seoDescription: String,
    authorId: Schema.Types.ObjectId,
    authorName: String,
    updatedByName: String,
  },
  { timestamps: true },
);
blogPostSchema.index({ status: 1, publishedAt: -1 });

/** An image used in website articles. Public once uploaded; the content is checked, never trusted from the browser. */
const blogImageSchema = new Schema(
  { mimeType: { type: String, required: true }, data: { type: Buffer, required: true, select: false }, sha256: String, sizeBytes: Number, width: Number, height: Number, originalName: String, uploadedBy: Schema.Types.ObjectId, uploadedByName: String },
  { timestamps: true },
);

/** A "What's new" announcement from AfeySync to facilities (Markdown, like website articles). */
const announcementSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    category: { type: String, enum: ['feature', 'improvement', 'fix', 'maintenance', 'notice'], default: 'notice' },
    coverImageId: Schema.Types.ObjectId,
    audience: { type: String, enum: ['all', 'facilities'], default: 'all' },
    tenantIds: [Schema.Types.ObjectId],
    pinned: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: Date,
    authorName: String,
    updatedByName: String,
  },
  { timestamps: true },
);
announcementSchema.index({ status: 1, publishedAt: -1 });

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
  FacilityApplication: facilityApplicationSchema,
  SubscriptionPlan: subscriptionPlanSchema,
  BillingDocument: billingDocumentSchema,
  PlatformPayment: platformPaymentSchema,
  PlatformCounter: platformCounterSchema,
  BrandAsset: brandAssetSchema,
  UserDirectory: userDirectorySchema,
  LoginHandoff: loginHandoffSchema,
  TenantLogo: tenantLogoSchema,
  SmsWallet: smsWalletSchema,
  SmsLedger: smsLedgerSchema,
  BlogPost: blogPostSchema,
  BlogImage: blogImageSchema,
  Announcement: announcementSchema,
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
