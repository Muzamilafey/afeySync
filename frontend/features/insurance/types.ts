export interface Payer { _id: string; providerType: string; sladeCode?: string; name: string; displayName?: string; enabled: boolean; supported: boolean; environment?: string; notes?: string; lastActivityAt?: string }
export interface Benefit { code?: string; name?: string; type?: string; balance?: number; copay?: number; status?: string }
export interface Coverage {
  _id: string; patientId: string; providerType: string; payerId?: string; payerName: string; payerSladeCode?: string; memberNumber: string; schemeName?: string; schemeCode?: string; policyNumber?: string;
  principalMember?: boolean; principalMemberName?: string; relationship?: string; validFrom?: string; validTo?: string; isActive: boolean; beneficiaryId?: string;
  lastEligibilityCheck?: string; eligibilityStatus: 'unknown' | 'eligible' | 'not_eligible' | 'error'; benefits?: Benefit[]; panelStatus?: string; contacts?: Array<{ id: string; masked: string; kind?: string }>;
  history?: Array<{ at: string; action: string; byName?: string; changes?: unknown }>;
}
export interface InsVisit {
  _id: string; reference: string; status: string; patientId: { _id: string; patientNumber: string; firstName: string; lastName: string } | string; coverageId: Coverage | string; payer?: string; payerSladeCode?: string; memberNumber?: string;
  visitNumber?: string; visitStart?: string; ediAuthGuid?: string; authorizationId?: string; authorizationStatus?: string; authorizationTokenReference?: string; authenticationMethod?: string;
  scheme?: { name?: string; code?: string }; benefit?: { code?: string; type?: string };
  reservation?: { reservationId?: string; amount?: number; invoiceNumber?: string; status?: string; createdAt?: string };
  claimId?: string; history: Array<{ at: string; action: string; byName?: string; note?: string }>; createdAt: string;
}
export interface Remittance { _id: string; externalId: string; payerName?: string; sladeClaimId?: string; claimId?: { _id: string; reference: string; invoiceNumber?: string; status: string } | string; invoiceNumber?: string; amountSubmitted?: number; amountApproved?: number; amountPaid?: number; adjustment?: number; date?: string; externalStatus?: string; reconciledAt?: string }
export interface InsClaim {
  _id: string; reference: string; status: string; externalStatus?: string; patientId: { _id: string; patientNumber: string; firstName: string; lastName: string }; visitId: InsVisit | { _id: string; reference: string; visitNumber?: string };
  invoiceId: string; payer?: { name?: string; sladeCode?: string }; memberNumber?: string; scheme?: { name?: string; code?: string };
  diagnoses: Array<{ code: string; codingSystem: string; description?: string; primary?: boolean }>; sladeClaimId?: string; claimReference?: string; sladeInvoiceId?: string; invoiceNumber?: string;
  amounts?: { gross: number; copay: number; insurance: number; patient: number; net: number }; submittedAt?: string;
  attachments: Array<{ target: string; attachmentType: string; fileName?: string; attachmentId?: string; uploadedAt: string }>;
  creditNotes: Array<{ amount: number; reason: string; authorizedByName?: string; at: string }>;
  remittances?: Remittance[]; reconciliation?: { status: string; submitted: number; approved: number; paid: number; copay: number; variance: number; at: string };
  statusHistory: Array<{ status: string; at: string; source: string; note?: string }>; updatedAt: string; createdAt: string;
}
export const CLAIM_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple'> = { DRAFT: 'gray', AUTHORIZED: 'blue', READY: 'blue', SUBMITTED: 'blue', PROCESSING: 'amber', APPROVED: 'green', PARTIALLY_APPROVED: 'amber', REJECTED: 'red', PAID: 'green', CLOSED: 'gray' };
export const maskMember = (m: string) => (m.length > 4 ? `****${m.slice(-4)}` : m);
