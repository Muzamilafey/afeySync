import { Schema } from 'mongoose';

const { ObjectId } = Schema.Types;

const itemSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    genericName: String,
    form: String,
    strength: String,
    unit: { type: String, default: 'unit' },
    /** Brand / trade name and maker, e.g. Panadol by GSK (the generic is in genericName). */
    brand: String,
    manufacturer: String,
    /** How the item is bought: a pack of `packSize` units (e.g. box of 100 tablets). Stock is always kept in units. */
    packUnit: String,
    packSize: { type: Number, min: 1, default: 1 },
    barcode: { type: String, index: true, sparse: true },
    category: { type: String, enum: ['drug', 'consumable', 'reagent', 'equipment', 'other'], default: 'drug', index: true },
    isDrug: { type: Boolean, default: true },
    controlled: { type: Boolean, default: false },
    reorderLevel: { type: Number, default: 0 },
    serviceCode: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
itemSchema.index({ name: 1 });

const locationSchema = new Schema(
  {
    name: { type: String, required: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    type: { type: String, enum: ['store', 'pharmacy', 'ward', 'lab', 'theatre'], default: 'pharmacy' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const batchSchema = new Schema(
  {
    itemId: { type: ObjectId, ref: 'Item', required: true, index: true },
    locationId: { type: ObjectId, ref: 'StockLocation', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    supplierId: { type: ObjectId, ref: 'Supplier' },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
batchSchema.index({ itemId: 1, locationId: 1, expiryDate: 1 });

/** Immutable stock ledger: every change to a batch is recorded here. */
const stockMovementSchema = new Schema(
  {
    itemId: { type: ObjectId, ref: 'Item', required: true, index: true },
    batchId: ObjectId,
    locationId: { type: ObjectId, ref: 'StockLocation' },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    type: { type: String, enum: ['receipt', 'dispense', 'return', 'transfer_out', 'transfer_in', 'adjustment', 'expiry_writeoff'], required: true },
    quantity: { type: Number, required: true },
    reference: String,
    reason: String,
    by: ObjectId,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
stockMovementSchema.index({ createdAt: -1 });

const prescriptionSchema = new Schema(
  {
    rxNumber: { type: String, required: true, unique: true },
    visitId: { type: ObjectId, ref: 'Visit', index: true },
    admissionId: { type: ObjectId, ref: 'Admission' },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    prescriberId: ObjectId,
    prescriberName: String,
    items: [
      {
        itemId: { type: ObjectId, ref: 'Item' },
        drugName: { type: String, required: true },
        dose: String,
        frequency: String,
        route: String,
        durationDays: Number,
        quantity: { type: Number, required: true, min: 0 },
        instructions: String,
        dispensedQuantity: { type: Number, default: 0 },
        returnedQuantity: { type: Number, default: 0 },
        status: { type: String, enum: ['pending', 'partial', 'dispensed', 'cancelled'], default: 'pending' },
      },
    ],
    status: { type: String, enum: ['pending', 'partially_dispensed', 'dispensed', 'cancelled'], default: 'pending', index: true },
    /** Ward (inpatient) requests: how soon pharmacy should supply, and where to. */
    urgency: { type: String, enum: ['routine', 'urgent', 'stat'], default: 'routine' },
    /** 'discharge': take-home drugs prescribed when the patient leaves the ward. */
    purpose: { type: String, enum: ['treatment', 'discharge'], default: 'treatment' },
    ward: { wardId: ObjectId, name: String, bedNumber: String },
    /** Ward confirms it received what pharmacy dispensed (one entry per receipt). */
    receipts: [{ _id: false, at: Date, by: ObjectId, byName: String, dispenseCount: Number, note: String }],
    dispenses: [
      {
        _id: false,
        at: Date,
        by: ObjectId,
        byName: String,
        lines: [{ _id: false, rxItemId: ObjectId, itemId: { type: ObjectId, ref: 'Item' }, batchId: ObjectId, batchNumber: String, quantity: Number }],
      },
    ],
    /** National ePrescription (DHA HIE) exchange state. */
    ePrescription: { externalId: String, status: { type: String, enum: ['sent', 'failed', 'dispense_reported'] }, sentAt: Date, dispenseReportedAt: Date, lastError: String, attempts: { type: Number, default: 0 } },
  },
  { timestamps: true },
);
prescriptionSchema.index({ createdAt: -1 });

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    contactPerson: String,
    phone: String,
    email: String,
    kraPin: String,
    address: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const purchaseOrderSchema = new Schema(
  {
    poNumber: { type: String, required: true, unique: true },
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    locationId: { type: ObjectId, ref: 'StockLocation', required: true },
    items: [
      {
        itemId: { type: ObjectId, ref: 'Item', required: true },
        itemName: String,
        quantity: { type: Number, required: true, min: 1 },
        unitCost: { type: Number, required: true, min: 0 },
        receivedQuantity: { type: Number, default: 0 },
      },
    ],
    status: { type: String, enum: ['draft', 'approved', 'partially_received', 'received', 'cancelled'], default: 'draft', index: true },
    total: Number,
    notes: String,
    createdBy: ObjectId,
    approvedBy: ObjectId,
    approvedAt: Date,
    receipts: [{ _id: false, at: Date, by: ObjectId, deliveryNote: String, lines: [{ _id: false, itemId: { type: ObjectId, ref: 'Item' }, batchNumber: String, expiryDate: Date, quantity: Number }] }],
  },
  { timestamps: true },
);

/** A counter (over-the-counter) sale in the pharmacy: walk-in customers and external prescriptions. */
const pharmacySaleSchema = new Schema(
  {
    saleNumber: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    locationId: { type: ObjectId, ref: 'StockLocation', required: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    walkIn: { type: Boolean, default: false },
    customerName: String,
    customerPhone: String,
    externalPrescription: { prescriber: String, facility: String, reference: String },
    lines: [
      {
        itemId: { type: ObjectId, ref: 'Item', required: true },
        name: String,
        quantity: { type: Number, required: true, min: 1 },
        unitPrice: Number,
        amount: Number,
        returnedQuantity: { type: Number, default: 0 },
        batches: [{ _id: false, batchId: ObjectId, batchNumber: String, expiryDate: Date, quantity: Number }],
      },
    ],
    total: Number,
    invoiceId: { type: ObjectId, ref: 'Invoice' },
    invoiceNumber: String,
    paymentMethod: String,
    status: { type: String, enum: ['awaiting_payment', 'paid', 'returned'], default: 'awaiting_payment', index: true },
    returns: [{ _id: false, at: Date, byName: String, reason: String, lines: [{ _id: false, lineId: ObjectId, quantity: Number, amount: Number }] }],
    soldBy: ObjectId,
    soldByName: String,
  },
  { timestamps: true },
);
pharmacySaleSchema.index({ createdAt: -1 });

/** A department (ward, lab, theatre, pharmacy) asks the store for items; a manager approves; the store issues. */
const requisitionSchema = new Schema(
  {
    reqNumber: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    fromLocationId: { type: ObjectId, ref: 'StockLocation', required: true },
    toLocationId: { type: ObjectId, ref: 'StockLocation', required: true },
    items: [{ itemId: { type: ObjectId, ref: 'Item', required: true }, name: String, unit: String, quantity: { type: Number, required: true, min: 1 }, approvedQuantity: Number, issuedQuantity: { type: Number, default: 0 } }],
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'partially_issued', 'issued', 'received', 'cancelled'], default: 'pending', index: true },
    urgency: { type: String, enum: ['routine', 'urgent'], default: 'routine' },
    notes: String,
    requestedBy: ObjectId,
    requestedByName: String,
    decidedBy: ObjectId,
    decidedByName: String,
    decidedAt: Date,
    rejectionReason: String,
    issues: [{ _id: false, at: Date, byName: String, reference: String, lines: [{ _id: false, itemId: ObjectId, batchNumber: String, quantity: Number }] }],
    receivedByName: String,
    receivedAt: Date,
  },
  { timestamps: true },
);
requisitionSchema.index({ createdAt: -1 });

/** Stock take: the system quantity of every batch at a location is frozen on a sheet, counted, then approved. */
const stockTakeSchema = new Schema(
  {
    takeNumber: { type: String, required: true, unique: true },
    branchId: { type: ObjectId, ref: 'Branch', required: true, index: true },
    locationId: { type: ObjectId, ref: 'StockLocation', required: true },
    category: String,
    status: { type: String, enum: ['counting', 'submitted', 'approved', 'cancelled'], default: 'counting', index: true },
    lines: [{ itemId: { type: ObjectId, ref: 'Item' }, code: String, name: String, unit: String, batchId: ObjectId, batchNumber: String, expiryDate: Date, systemQuantity: Number, countedQuantity: Number, unitCost: Number, note: String }],
    notes: String,
    createdBy: ObjectId,
    createdByName: String,
    submittedBy: ObjectId,
    submittedByName: String,
    submittedAt: Date,
    approvedBy: ObjectId,
    approvedByName: String,
    approvedAt: Date,
  },
  { timestamps: true },
);
stockTakeSchema.index({ createdAt: -1 });

export const pharmacySchemas = {
  Item: itemSchema,
  StockLocation: locationSchema,
  Batch: batchSchema,
  StockMovement: stockMovementSchema,
  Prescription: prescriptionSchema,
  Supplier: supplierSchema,
  PurchaseOrder: purchaseOrderSchema,
  PharmacySale: pharmacySaleSchema,
  StockRequisition: requisitionSchema,
  StockTake: stockTakeSchema,
};
