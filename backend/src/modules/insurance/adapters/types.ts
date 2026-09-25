/**
 * Provider-neutral private insurance integration contract. Billing and claims code talks to this interface only;
 * each provider (Slade360 today; direct insurer APIs later) implements it. SHA uses the DHA HIE eClaims workflow.
 */
export type ProviderType = 'SHA_DHA' | 'SLADE360' | 'DIRECT_INSURER' | 'CASH' | 'OTHER';
export interface AdapterCtx { tenantId: string; userId?: string; branchId?: string; requestId?: string }
export interface FileInput { buffer: Buffer; fileName: string; mimeType: string }

export interface EligibilityResult {
  eligible: boolean | null;
  statusText?: string;
  member: { name?: string; memberNumber?: string; beneficiaryId?: string; dateOfBirth?: string; relationship?: string; principalName?: string };
  cover: { schemeName?: string; schemeCode?: string; policyNumber?: string; policyEffectiveDate?: string; validFrom?: string; validTo?: string; status?: string };
  benefits: Array<{ code?: string; name?: string; type?: string; balance?: number; copay?: number; status?: string }>;
  contacts: Array<{ id: string; masked: string; kind?: string }>;
  restrictions?: unknown;
  panelStatus?: string;
  payer: { name?: string; sladeCode?: string };
  rawReference: unknown;
}
export interface StartVisitInput { beneficiaryId: string; factors: string[]; benefitType?: string; benefitCode?: string; policyNumber?: string; policyEffectiveDate?: string; otp?: string; beneficiaryContact?: string; schemeName?: string; schemeCode?: string }
export interface StartVisitResult { authorizationId?: string; authorizationToken?: string; ediAuthGuid?: string; visitNumber?: string; visitStart?: string; status?: string; raw: unknown }
export interface ClaimInput { payerCode?: string; payerName?: string; patientName: string; memberNumber: string; schemeName?: string; schemeCode?: string; visitNumber?: string; visitStart?: string; visitEnd?: string; icd10Codes: string[]; locationCode?: string; locationName?: string }
export interface InvoiceInput { claim: string; invoiceNumber: string; invoiceDate: string; copays: number; lines: Array<{ code?: string; description: string; quantity: number; unitPrice: number; amount: number }> }
export interface RemittanceRecord { externalId: string; claimExternalId?: string; invoiceNumber?: string; payerName?: string; amountSubmitted?: number; amountApproved?: number; amountPaid?: number; adjustment?: number; date?: string; status?: string; raw: unknown }

export interface InsuranceIntegrationAdapter {
  providerType: ProviderType;
  label: string;
  checkEligibility(ctx: AdapterCtx, input: { payerCode: string; memberNumber: string }): Promise<EligibilityResult>;
  authenticateMember?(ctx: AdapterCtx, input: Record<string, unknown>): Promise<unknown>;
  requestOtp(ctx: AdapterCtx, input: { contactId: string }): Promise<unknown>;
  startVisit(ctx: AdapterCtx, input: StartVisitInput): Promise<StartVisitResult>;
  validateAuthorization(ctx: AdapterCtx, input: Record<string, string | undefined>): Promise<unknown>;
  reserveBenefit(ctx: AdapterCtx, input: { authorization: string; invoiceNumber: string; amount: number }): Promise<{ reservationId?: string; raw: unknown }>;
  createClaim(ctx: AdapterCtx, input: ClaimInput): Promise<{ claimId?: string; reference?: string; status?: string; raw: unknown }>;
  createInvoice(ctx: AdapterCtx, input: InvoiceInput): Promise<{ invoiceId?: string; raw: unknown }>;
  uploadClaimAttachment(ctx: AdapterCtx, input: { claimId: string; attachmentType: string; file: FileInput }): Promise<{ attachmentId?: string; raw: unknown }>;
  uploadInvoiceAttachment(ctx: AdapterCtx, input: { invoiceId: string; attachmentType: string; file: FileInput }): Promise<{ attachmentId?: string; raw: unknown }>;
  createCreditNote(ctx: AdapterCtx, input: { invoiceId: string; amount: number; reason: string }): Promise<{ id?: string; raw: unknown }>;
  getClaimStatus(ctx: AdapterCtx, claimId: string): Promise<{ externalStatus?: string; raw: unknown }>;
  getRemittances(ctx: AdapterCtx, query: Record<string, string | undefined>): Promise<RemittanceRecord[]>;
  getClaimRemittance(ctx: AdapterCtx, claimId: string): Promise<RemittanceRecord[]>;
}
