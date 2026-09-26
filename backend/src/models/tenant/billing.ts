import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

export const SERVICE_CATEGORIES = ['consultation', 'laboratory', 'radiology', 'pharmacy', 'procedure', 'bed', 'nursing', 'maternity', 'dental', 'mortuary', 'registration', 'other'] as const;
export const PAYMENT_METHODS = ['cash', 'mpesa', 'card', 'bank', 'insurance', 'sha', 'waiver'] as const;

/** Billable service catalog with per price-list prices (cash / sha / insurance / custom schemes). */
const serviceItemSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: SERVICE_CATEGORIES, required: true, index: true },
    department: String,
    prices: [{ _id: false, priceList: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } }],
    shaInterventionCode: String,
    taxable: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const invoiceLineSchema = new Schema(
  {
    serviceCode: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, enum: SERVICE_CATEGORIES, default: 'other' },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true },
    /** Origin of the charge (lab order item, dispense, bed day…) — used for idempotent posting. */
    source: String,
    sourceId: String,
    addedBy: ObjectId,
    addedAt: { type: Date, default: Date.now },
    voided: { type: Boolean, default: false },
    voidReason: String,
    voidedBy: ObjectId,
  },
  { _id: true },
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    payer: {
      type: { type: String, enum: ['cash', 'sha', 'insurance', 'corporate'], default: 'cash' },
      priceList: { type: String, default: 'cash' },
      scheme: String,
      memberNumber: String,
      /** Snapshot of the scheme's terms when the invoice was opened, so later edits to the scheme do not change old bills. */
      schemeId: { type: ObjectId, ref: 'PayerScheme' },
      coverage: { type: String, enum: ['fee_for_service', 'capitation'] },
      copay: { type: { type: String, enum: ['none', 'fixed', 'percent'] }, value: Number },
    },
    status: { type: String, enum: ['open', 'issued', 'partially_paid', 'paid', 'void'], default: 'open', index: true },
    lines: [invoiceLineSchema],
    adjustments: [
      {
        type: { type: String, enum: ['discount', 'waiver'], required: true },
        amount: { type: Number, required: true, min: 0 },
        reason: { type: String, required: true },
        approvedBy: ObjectId,
        approvedByName: String,
        at: { type: Date, default: Date.now },
      },
    ],
    totals: {
      gross: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      waiver: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      credited: { type: Number, default: 0 },
      balance: { type: Number, default: 0 },
      /** Scheme split: what the patient pays (copay) and what the insurer or employer covers. */
      patientShare: Number,
      payerShare: Number,
      /** Capitation: covered by the scheme's fixed monthly fee, so it is not billed to anyone per visit. */
      capitation: { type: Number, default: 0 },
    },
    issuedAt: Date,
    shaTransactionId: ObjectId,
    createdBy: ObjectId,
  },
  { timestamps: true },
);
invoiceSchema.index({ createdAt: -1 });
invoiceSchema.index({ 'lines.source': 1, 'lines.sourceId': 1 });

const paymentSchema = new Schema(
  {
    receiptNumber: { type: String, unique: true, sparse: true },
    invoiceId: { type: ObjectId, ref: 'Invoice', index: true },
    patientId: { type: ObjectId, ref: 'Patient', index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0 },
    reference: { type: String, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded', 'unallocated'], default: 'completed', index: true },
    refundedAmount: { type: Number, default: 0 },
    mpesa: {
      /** Which service sent the prompt: Safaricom Daraja directly, or Pay Hero. */
      gateway: String,
      /** Pay Hero's own transaction reference (used to look the payment up with Pay Hero). */
      gatewayReference: { type: String, index: true, sparse: true },
      checkoutRequestId: { type: String, index: true, sparse: true },
      merchantRequestId: String,
      receiptNumber: { type: String, index: true, sparse: true },
      phone: String,
      resultCode: Number,
      resultDesc: String,
      transactionDate: String,
      billRefNumber: String,
      payerName: String,
    },
    receivedBy: ObjectId,
    receivedByName: String,
    notes: String,
    completedAt: Date,
  },
  { timestamps: true },
);
paymentSchema.index({ createdAt: -1 });

const creditNoteSchema = new Schema(
  {
    creditNoteNumber: { type: String, required: true, unique: true },
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true, index: true },
    paymentId: { type: ObjectId, ref: 'Payment' },
    patientId: { type: ObjectId, ref: 'Patient' },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    type: { type: String, enum: ['refund', 'credit'], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: PAYMENT_METHODS },
    reason: { type: String, required: true },
    approvedBy: ObjectId,
    approvedByName: String,
    /** M-Pesa B2C payout of an approved refund. 'timeout' means the outcome is unknown and must be checked, never retried blindly. */
    payout: {
      status: { type: String, enum: ['submitted', 'completed', 'failed', 'timeout'] },
      phone: String,
      originatorConversationId: { type: String, index: true, sparse: true },
      conversationId: String,
      transactionId: String,
      resultCode: Number,
      resultDesc: String,
      receiverName: String,
      requestedBy: ObjectId,
      requestedByName: String,
      requestedAt: Date,
      completedAt: Date,
    },
  },
  { timestamps: true },
);

const expenseSchema = new Schema(
  {
    expenseNumber: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    category: { type: String, required: true },
    description: String,
    amount: { type: Number, required: true, min: 0 },
    paidTo: String,
    method: String,
    reference: String,
    date: { type: Date, default: Date.now, index: true },
    recordedBy: ObjectId,
    approvedBy: ObjectId,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
);

/**
 * A corporate (employer) or insurance scheme the facility serves. The scheme decides the price list,
 * the patient's copay, and whether services are billed per visit (fee for service) or covered by a
 * fixed monthly fee per member (capitation), in which case only the copay is collected.
 */
const payerSchemeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['insurance', 'corporate'], required: true },
    payerId: { type: ObjectId, ref: 'InsurancePayer' },
    /** Price list used for this scheme's patients: 'insurance', 'cash' or a scheme list such as 'aar-gold'. */
    priceList: { type: String, required: true, default: 'insurance' },
    coverage: { type: String, enum: ['fee_for_service', 'capitation'], default: 'fee_for_service' },
    copay: { type: { type: String, enum: ['none', 'fixed', 'percent'], default: 'none' }, value: { type: Number, default: 0, min: 0 } },
    /** Capitation: agreed monthly amount per member, for reconciliation of the scheme's payments. */
    capitationRate: Number,
    contactPerson: String,
    phone: String,
    email: String,
    notes: String,
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const billingSchemas = {
  PayerScheme: payerSchemeSchema,
  ServiceItem: serviceItemSchema,
  Invoice: invoiceSchema,
  Payment: paymentSchema,
  CreditNote: creditNoteSchema,
  Expense: expenseSchema,
};

export type InvoiceLine = { _id?: unknown; serviceCode: string; description: string; category: string; quantity: number; unitPrice: number; discount?: number; amount: number; source?: string; sourceId?: string; voided?: boolean };
export { Mixed };
