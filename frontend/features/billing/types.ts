export interface InvoiceLine { _id: string; serviceCode: string; description: string; category: string; quantity: number; unitPrice: number; amount: number; voided?: boolean; voidReason?: string; source?: string }
export interface Totals { gross: number; discount: number; waiver: number; net: number; paid: number; credited: number; balance: number }
export interface Payment { _id: string; receiptNumber?: string; method: string; amount: number; reference?: string; status: string; refundedAmount?: number; receivedByName?: string; createdAt: string; mpesa?: { checkoutRequestId?: string; receiptNumber?: string; phone?: string; resultDesc?: string; billRefNumber?: string; payerName?: string }; patientId?: { patientNumber: string; firstName: string; lastName: string } }
export interface Invoice {
  _id: string;
  invoiceNumber: string;
  status: string;
  payer: { type: string; priceList: string; scheme?: string };
  lines: InvoiceLine[];
  adjustments: Array<{ type: string; amount: number; reason: string; approvedByName?: string; at: string }>;
  totals: Totals;
  createdAt: string;
  visitId?: string;
  patientId: string | { _id: string; patientNumber: string; firstName: string; lastName: string; phone?: string };
  patient?: { _id: string; patientNumber: string; firstName: string; middleName?: string; lastName: string; phone?: string; clientRegistryId?: string };
  payments?: Payment[];
  creditNotes?: CreditNote[];
}
export interface ServiceItem { _id: string; code: string; name: string; category: string; department?: string; prices: Array<{ priceList: string; amount: number }>; shaInterventionCode?: string; active: boolean }
export const CATEGORIES = ['consultation', 'laboratory', 'radiology', 'pharmacy', 'procedure', 'bed', 'nursing', 'maternity', 'dental', 'mortuary', 'registration', 'other'];

export interface CreditNote {
  _id: string;
  creditNoteNumber: string;
  type: string;
  amount: number;
  reason: string;
  method?: string;
  approvedByName?: string;
  createdAt: string;
  payout?: { status?: 'submitted' | 'completed' | 'failed' | 'timeout'; phone?: string; transactionId?: string; resultDesc?: string; receiverName?: string; requestedByName?: string };
}
