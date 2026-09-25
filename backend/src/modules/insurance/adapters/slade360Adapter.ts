import { pick, unwrapList } from '../../../integrations/hie/normalize';
import { sladeConfig, sladeRequest } from '../../../integrations/slade360/sladeClient';
import type { AdapterCtx, EligibilityResult, FileInput, InsuranceIntegrationAdapter, RemittanceRecord } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const n = (v: string | undefined) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 2)}${'*'.repeat(Math.max(0, p.length - 4))}${p.slice(-2)}` : '****');
const list = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).filter(isObj);
  return [];
};
const first = (d: unknown): Obj => {
  if (isObj(d) && isObj(d.data)) return d.data as Obj;
  return unwrapList(d)[0] ?? (isObj(d) ? d : {});
};

/** Strip full phone numbers from payloads we keep for reference (contacts are shown masked). */
function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8) return '[…]';
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /phone|msisdn|mobile|otp|token/i.test(k) && typeof x === 'string' ? (/otp|token/i.test(k) ? '[REDACTED]' : maskPhone(x)) : scrub(x, depth + 1)]));
  return v;
}

async function fileForm(fields: Record<string, string>, file: FileInput) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.fileName);
  return form;
}

function remittance(o: Obj): RemittanceRecord {
  return {
    externalId: pick(o, 'id', 'remittance_id', 'guid') ?? '',
    claimExternalId: pick(o, 'claim', 'claim_id', 'claim.id'),
    invoiceNumber: pick(o, 'invoice_number', 'invoice.invoice_number'),
    payerName: pick(o, 'payer_name', 'payer.name'),
    amountSubmitted: n(pick(o, 'amount_submitted', 'submitted_amount', 'invoiced_amount', 'total_amount')),
    amountApproved: n(pick(o, 'amount_approved', 'approved_amount')),
    amountPaid: n(pick(o, 'amount_paid', 'paid_amount', 'amount')),
    adjustment: n(pick(o, 'adjustment', 'adjustment_amount')),
    date: pick(o, 'date', 'payment_date', 'remittance_date', 'created'),
    status: pick(o, 'status'),
    raw: scrub(o),
  };
}

/**
 * Slade360 / HealthCloud adapter. Request field names follow AfeySync's integration specification (which cites the
 * official API reference); responses are read defensively and kept (scrubbed) for audit.
 */
export const slade360Adapter: InsuranceIntegrationAdapter = {
  providerType: 'SLADE360',
  label: 'Slade360',

  async checkEligibility(ctx, input) {
    const d = await sladeRequest(ctx, { operation: 'eligibility.member', query: { member_number: input.memberNumber, payer_slade_code: input.payerCode } });
    const o = first(d);
    const flag = o.is_eligible ?? o.eligible ?? o.isEligible;
    const statusText = pick(o, 'status', 'eligibility_status', 'member_status');
    let eligible: boolean | null = typeof flag === 'boolean' ? flag : null;
    if (eligible === null && statusText) eligible = /not|inactive|suspend|expired|ineligible/i.test(statusText) ? false : /active|eligible/i.test(statusText) ? true : null;
    const name = pick(o, 'beneficiary_name', 'member_name', 'name', 'full_name') ?? ([pick(o, 'first_name'), pick(o, 'other_names'), pick(o, 'last_name')].filter(Boolean).join(' ') || undefined);
    const contacts = list(o, 'beneficiary_contacts', 'contacts').map((c) => ({ id: pick(c, 'id', 'contact_id') ?? '', masked: maskPhone(pick(c, 'phone_number', 'contact', 'value', 'phone') ?? ''), kind: pick(c, 'contact_type', 'type') })).filter((c) => c.id);
    const benefits = list(o, 'benefits', 'member_benefits').map((b) => ({ code: pick(b, 'benefit_code', 'code'), name: pick(b, 'benefit_name', 'name', 'benefit_type'), type: pick(b, 'benefit_type', 'type'), balance: n(pick(b, 'available_balance', 'balance', 'benefit_balance')), copay: n(pick(b, 'copay', 'copay_amount')), status: pick(b, 'status') }));
    const res: EligibilityResult = {
      eligible,
      statusText,
      member: { name, memberNumber: pick(o, 'member_number') ?? input.memberNumber, beneficiaryId: pick(o, 'beneficiary_id', 'beneficiary', 'id'), dateOfBirth: pick(o, 'date_of_birth', 'dob'), relationship: pick(o, 'relationship', 'beneficiary_type'), principalName: pick(o, 'principal_name', 'principal_member_name') },
      cover: { schemeName: pick(o, 'scheme_name', 'scheme.name'), schemeCode: pick(o, 'scheme_code', 'scheme.code'), policyNumber: pick(o, 'policy_number', 'policy.policy_number'), policyEffectiveDate: pick(o, 'policy_effective_date', 'policy.effective_date'), validFrom: pick(o, 'valid_from', 'cover_start_date', 'policy_start_date'), validTo: pick(o, 'valid_to', 'cover_end_date', 'policy_end_date'), status: statusText },
      benefits,
      contacts,
      restrictions: o.restrictions ?? o.exclusions,
      panelStatus: pick(o, 'panel_status', 'in_panel'),
      payer: { name: pick(o, 'payer_name', 'payer.name'), sladeCode: input.payerCode },
      rawReference: scrub(o),
    };
    return res;
  },

  requestOtp: (ctx, input) => sladeRequest(ctx, { operation: 'contacts.sendOtp', pathParams: { contact_id: input.contactId }, body: {} }),

  async startVisit(ctx, i) {
    const d = await sladeRequest(ctx, {
      operation: 'visit.start',
      body: { beneficiary_id: i.beneficiaryId, factors: i.factors, benefit_type: i.benefitType, benefit_code: i.benefitCode, policy_number: i.policyNumber, policy_effective_date: i.policyEffectiveDate, otp: i.otp, beneficiary_contact: i.beneficiaryContact, scheme_name: i.schemeName, scheme_code: i.schemeCode },
    });
    const o = first(d);
    return { authorizationId: pick(o, 'id', 'authorization', 'authorization_id'), authorizationToken: pick(o, 'auth_token', 'authorization_token', 'token'), ediAuthGuid: pick(o, 'edi_auth_guid', 'edi_authorization_guid'), visitNumber: pick(o, 'visit_number'), visitStart: pick(o, 'visit_start', 'start_date'), status: pick(o, 'status', 'authorization_status'), raw: scrub(o) };
  },

  validateAuthorization: (ctx, input) => sladeRequest(ctx, { operation: 'authorization.validate', body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) }),

  async reserveBenefit(ctx, input) {
    const d = await sladeRequest(ctx, { operation: 'reservation.create', body: { authorization: input.authorization, invoice_number: input.invoiceNumber, amount: input.amount }, idempotencyKey: `reserve:${input.authorization}:${input.invoiceNumber}` });
    const o = first(d);
    return { reservationId: pick(o, 'id', 'reservation_id', 'guid'), raw: scrub(o) };
  },

  async createClaim(ctx, c) {
    const cfg = await sladeConfig(ctx.tenantId);
    const d = await sladeRequest(ctx, {
      operation: 'claim.create',
      body: { payer_code: c.payerCode, payer_name: c.payerName, patient_name: c.patientName, member_number: c.memberNumber, scheme_name: c.schemeName, visit_number: c.visitNumber, visit_start: c.visitStart, visit_end: c.visitEnd, icd10_codes: c.icd10Codes, location_code: c.locationCode ?? cfg.settings.locationCode, location_name: c.locationName ?? cfg.settings.locationName, scheme_code: c.schemeCode },
    }, cfg);
    const o = first(d);
    return { claimId: pick(o, 'id', 'claim_id', 'guid'), reference: pick(o, 'claim_number', 'reference', 'claim_reference'), status: pick(o, 'status'), raw: scrub(o) };
  },

  async createInvoice(ctx, i) {
    const d = await sladeRequest(ctx, { operation: 'invoice.create', body: { claim: i.claim, invoice_number: i.invoiceNumber, invoice_date: i.invoiceDate, copays: i.copays, lines: i.lines.map((l) => ({ code: l.code, description: l.description, quantity: l.quantity, unit_price: l.unitPrice, amount: l.amount })) }, idempotencyKey: `invoice:${i.claim}:${i.invoiceNumber}` });
    const o = first(d);
    return { invoiceId: pick(o, 'id', 'invoice_id', 'guid'), raw: scrub(o) };
  },

  async uploadClaimAttachment(ctx, i) {
    const d = await sladeRequest(ctx, { operation: 'claim.attachment.upload', body: await fileForm({ claim: i.claimId, attachment_type: i.attachmentType }, i.file) });
    return { attachmentId: pick(first(d), 'id', 'attachment_id'), raw: scrub(d) };
  },

  async uploadInvoiceAttachment(ctx, i) {
    const d = await sladeRequest(ctx, { operation: 'invoice.attachment.upload', body: await fileForm({ invoice: i.invoiceId, attachment_type: i.attachmentType }, i.file) });
    return { attachmentId: pick(first(d), 'id', 'attachment_id'), raw: scrub(d) };
  },

  async createCreditNote(ctx, i) {
    const d = await sladeRequest(ctx, { operation: 'creditNote.create', body: { invoice: i.invoiceId, amount: i.amount, reason: i.reason } });
    return { id: pick(first(d), 'id'), raw: scrub(d) };
  },

  async getClaimStatus(ctx, claimId) {
    const d = await sladeRequest(ctx, { operation: 'claim.retrieve', query: { id: claimId } });
    return { externalStatus: pick(first(d), 'status', 'claim_status'), raw: scrub(d) };
  },

  async getRemittances(ctx, query) {
    const d = await sladeRequest(ctx, { operation: 'remittances.list', query });
    return unwrapList(d).map(remittance).filter((r) => r.externalId);
  },

  async getClaimRemittance(ctx, claimId) {
    const d = await sladeRequest(ctx, { operation: 'remittance.claim', query: { claim_id: claimId } });
    return (Array.isArray(d) || (isObj(d) && (Array.isArray(d.results) || Array.isArray(d.data))) ? unwrapList(d) : [first(d)]).map(remittance).filter((r) => r.externalId);
  },
};

export type { AdapterCtx };
