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
    branchId: { type: ObjectId, required: true, index: true },
    type: { type: String, enum: ['store', 'pharmacy', 'ward', 'lab', 'theatre'], default: 'pharmacy' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const batchSchema = new Schema(
  {
    itemId: { type: ObjectId, required: true, index: true },
    locationId: { type: ObjectId, required: true, index: true },
    branchId: { type: ObjectId, required: true, index: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    supplierId: ObjectId,
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
batchSchema.index({ itemId: 1, locationId: 1, expiryDate: 1 });

/** Immutable stock ledger: every change to a batch is recorded here. */
const stockMovementSchema = new Schema(
  {
    itemId: { type: ObjectId, required: true, index: true },
    batchId: ObjectId,
    locationId: ObjectId,
    branchId: { type: ObjectId, required: true, index: true },
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
    visitId: { type: ObjectId, index: true },
    admissionId: ObjectId,
    patientId: { type: ObjectId, required: true, index: true },
    branchId: { type: ObjectId, required: true, index: true },
    prescriberId: ObjectId,
    prescriberName: String,
    items: [
      {
        itemId: ObjectId,
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
    dispenses: [
      {
        _id: false,
        at: Date,
        by: ObjectId,
        byName: String,
        lines: [{ _id: false, rxItemId: ObjectId, itemId: ObjectId, batchId: ObjectId, batchNumber: String, quantity: Number }],
      },
    ],
    ePrescription: { externalId: String, status: String },
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
    supplierId: { type: ObjectId, required: true },
    branchId: { type: ObjectId, required: true, index: true },
    locationId: { type: ObjectId, required: true },
    items: [
      {
        itemId: { type: ObjectId, required: true },
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
    receipts: [{ _id: false, at: Date, by: ObjectId, deliveryNote: String, lines: [{ _id: false, itemId: ObjectId, batchNumber: String, expiryDate: Date, quantity: Number }] }],
  },
  { timestamps: true },
);

export const pharmacySchemas = {
  Item: itemSchema,
  StockLocation: locationSchema,
  Batch: batchSchema,
  StockMovement: stockMovementSchema,
  Prescription: prescriptionSchema,
  Supplier: supplierSchema,
  PurchaseOrder: purchaseOrderSchema,
};
