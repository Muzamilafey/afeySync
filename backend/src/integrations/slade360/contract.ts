import type { ContractOperation } from '../hie/contract';

/**
 * Slade360 / HealthCloud provider EDI operations. Paths are those named in AfeySync's private-insurance
 * integration specification (citing https://web.healthcloud.sh/api-reference) and are flagged for the platform
 * owner to verify against the live documentation. Operations whose path was not supplied stay unconfigured.
 */
const doc = 'https://web.healthcloud.sh/api-reference';
const op = (key: string, group: string, description: string, method: ContractOperation['method'], path: string | null, extra: Partial<ContractOperation> = {}): ContractOperation => ({
  key, group, description, method, path, documented: false, verification: path ? 'spec_unverified' : undefined, idempotent: method === 'GET', documentationRef: doc, ...extra,
});

export const SLADE_CONTRACT_VERSION = '2026-09-spec-slade360';

export const DEFAULT_SLADE_OPERATIONS: ContractOperation[] = [
  op('auth.token', 'Authentication', 'OAuth 2.0 token (token URL comes from the integration settings)', 'POST', '/oauth2/token/', { contentType: 'application/x-www-form-urlencoded' }),
  op('eligibility.member', 'Eligibility', 'Member eligibility (member_number, payer_slade_code)', 'GET', '/beneficiaries/member_eligibility/'),
  op('contacts.sendOtp', 'Authentication', 'Send OTP to a beneficiary contact', 'POST', '/beneficiaries/beneficiary_contacts/{contact_id}/send_otp/'),
  op('visit.start', 'Visits', 'Start visit (authorization)', 'POST', '/authorizations/start_visit/'),
  op('authorization.validate', 'Visits', 'Validate authorization token', 'POST', '/authorizations/validate_authorization_token/'),
  op('reservation.create', 'Balances', 'Reserve benefit from authorization', 'POST', '/balances/reservations/reserve_from_authorization/'),
  op('claim.create', 'Claims', 'Create claim', 'POST', '/claims/'),
  op('claim.retrieve', 'Claims', 'Retrieve claim status', 'GET', null),
  op('invoice.create', 'Invoices', 'Create invoice', 'POST', '/invoices/'),
  op('claim.attachment.upload', 'Attachments', 'Upload claim attachment', 'POST', '/claim_attachments/upload_attachment/', { contentType: 'multipart/form-data' }),
  op('invoice.attachment.upload', 'Attachments', 'Upload invoice attachment', 'POST', '/invoice_attachments/upload_attachment/', { contentType: 'multipart/form-data' }),
  op('creditNote.create', 'Credit notes', 'Create credit note', 'POST', null),
  op('remittances.list', 'Remittances', 'List remittances', 'GET', '/remittances/'),
  op('remittance.claim', 'Remittances', 'Remittance for a claim (claim_id)', 'GET', '/remittances/claim_remittance/'),
];
