import { AppError } from '../../../utils/errors';
import { SHAEligibilityService } from '../../../integrations/hie/services';
import { slade360Adapter } from './slade360Adapter';
import type { InsuranceIntegrationAdapter, ProviderType } from './types';

const notHere = (what: string) => async (): Promise<never> => {
  throw new AppError(409, 'USE_SHA_WORKFLOW', `${what} for SHA runs through the DHA HIE eClaims workflow (SHA → Visits).`);
};

/**
 * SHA via DHA HIE. Only eligibility is exposed through the generic interface; consent, visits, preauthorizations
 * and claims use the dedicated SHA eClaims workflow because DHA's model (consent tokens, virtual claims) differs.
 */
const shaDhaAdapter: InsuranceIntegrationAdapter = {
  providerType: 'SHA_DHA',
  label: 'SHA (DHA HIE)',
  async checkEligibility(ctx, input) {
    const r = await SHAEligibilityService.check({ tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId }, 'ClientRegistry ID', input.memberNumber);
    return { eligible: r.eligible, statusText: r.statusText, member: { name: r.memberName, memberNumber: r.clientRegistryId }, cover: { schemeName: r.scheme }, benefits: [], contacts: [], payer: { name: 'SHA' }, rawReference: r.raw };
  },
  requestOtp: notHere('Consent OTP'),
  startVisit: notHere('Starting a visit'),
  validateAuthorization: notHere('Authorization'),
  reserveBenefit: notHere('Benefit reservation'),
  createClaim: notHere('Claims'),
  createInvoice: notHere('Invoices'),
  uploadClaimAttachment: notHere('Attachments'),
  uploadInvoiceAttachment: notHere('Attachments'),
  createCreditNote: notHere('Credit notes'),
  getClaimStatus: notHere('Claim status'),
  getRemittances: notHere('Remittances'),
  getClaimRemittance: notHere('Remittances'),
};

const ADAPTERS: Partial<Record<ProviderType, InsuranceIntegrationAdapter>> = { SLADE360: slade360Adapter, SHA_DHA: shaDhaAdapter };

export function getAdapter(providerType: string): InsuranceIntegrationAdapter {
  const a = ADAPTERS[providerType as ProviderType];
  if (!a) throw new AppError(422, 'INSURANCE_PROVIDER_UNSUPPORTED', `No integration is available for ${providerType}. Record the cover manually and bill the insurer directly.`);
  return a;
}

export const registeredProviders = () => Object.values(ADAPTERS).map((a) => ({ providerType: a!.providerType, label: a!.label }));
