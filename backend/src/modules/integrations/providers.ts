import type { Provider } from '../../models/meta';

export interface ProviderDefinition {
  label: string;
  settings: Array<{ key: string; label: string; required?: boolean; default?: string }>;
  secrets: Array<{ key: string; label: string; required?: boolean }>;
  environments: Array<'sandbox' | 'uat' | 'production'>;
  defaultBaseUrls?: Partial<Record<'sandbox' | 'uat' | 'production', string>>;
}

/**
 * The only default URL shipped is the DHA HIE development/UAT middleware documented at
 * https://hie-docs.dha.go.ke/ (Authentication). Production URLs must be entered by the platform owner
 * from the official go-live communication — they are intentionally not guessed here.
 */
const HIE_UAT = 'https://ilm-dev.dha.go.ke/uat-middleware/api/v1';

export const PROVIDER_DEFINITIONS: Record<Provider, ProviderDefinition> = {
  dha: {
    label: 'DHA HIE',
    environments: ['uat', 'production'],
    defaultBaseUrls: { uat: HIE_UAT },
    settings: [
      { key: 'baseUrl', label: 'Base URL', required: true },
      { key: 'facilityRegistryCode', label: 'Facility Registry Code' },
      { key: 'facilityIdType', label: 'Facility ID Type', default: 'fr-code' },
      { key: 'callbackUrl', label: 'Callback URL' },
    ],
    secrets: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', required: true },
    ],
  },
  sha: {
    label: 'SHA (via DHA HIE eClaims)',
    environments: ['uat', 'production'],
    defaultBaseUrls: { uat: HIE_UAT },
    settings: [
      { key: 'baseUrl', label: 'Base URL', required: true },
      { key: 'facilityRegistryCode', label: 'Facility Registry Code' },
      { key: 'facilityIdType', label: 'Facility ID Type', default: 'fr-code' },
      { key: 'callbackUrl', label: 'Callback URL' },
    ],
    secrets: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', required: true },
    ],
  },
  mpesa: {
    label: 'M-Pesa (Daraja)',
    environments: ['sandbox', 'production'],
    defaultBaseUrls: { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' },
    settings: [
      { key: 'shortcode', label: 'Shortcode', required: true },
      { key: 'till', label: 'Till Number' },
      { key: 'paybill', label: 'Paybill Number' },
      { key: 'transactionType', label: 'STK Transaction Type', default: 'CustomerPayBillOnline' },
      { key: 'callbackUrl', label: 'Callback URL' },
    ],
    secrets: [
      { key: 'consumerKey', label: 'Consumer Key', required: true },
      { key: 'consumerSecret', label: 'Consumer Secret', required: true },
      { key: 'passkey', label: 'Passkey', required: true },
    ],
  },
  africastalking: {
    label: "Africa's Talking SMS",
    environments: ['sandbox', 'production'],
    defaultBaseUrls: { sandbox: 'https://api.sandbox.africastalking.com', production: 'https://api.africastalking.com' },
    settings: [
      { key: 'username', label: 'Username', required: true },
      { key: 'senderId', label: 'Sender ID' },
    ],
    secrets: [{ key: 'apiKey', label: 'API Key', required: true }],
  },
  smtp: {
    label: 'SMTP Email',
    environments: ['production'],
    settings: [
      { key: 'host', label: 'Host', required: true },
      { key: 'port', label: 'Port', required: true, default: '587' },
      { key: 'encryption', label: 'Encryption (none|starttls|ssl)', default: 'starttls' },
      { key: 'fromName', label: 'From Name', default: 'AfeySync' },
      { key: 'fromEmail', label: 'From Email', required: true },
    ],
    secrets: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password' },
    ],
  },
  storage: {
    label: 'Document Storage',
    environments: ['production'],
    settings: [{ key: 'driver', label: 'Driver', default: 'local' }],
    secrets: [],
  },
};
