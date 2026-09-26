import type { Provider } from '../../models/meta';

export interface ProviderDefinition {
  label: string;
  settings: Array<{
    key: string;
    label: string;
    required?: boolean;
    default?: string;
    /** Shown as a drop-down instead of a text box. */
    options?: Array<{ value: string; label: string }>;
    /** A line of guidance under the field. */
    help?: string;
    /** Only shown while another setting has this value (e.g. the till number only for a till). */
    showWhen?: { key: string; value: string };
    /** Kept so older saved values still load and save, but no longer shown. */
    hidden?: boolean;
  }>;
  secrets: Array<{ key: string; label: string; required?: boolean }>;
  environments: Array<'sandbox' | 'uat' | 'production'>;
  defaultBaseUrls?: Partial<Record<'sandbox' | 'uat' | 'production', string>>;
  /** Credentials always belong to the facility (e.g. its own Slade360 account); the platform record is only an on/off switch. */
  facilityCredentialsOnly?: boolean;
  /** Belongs to the platform owner only: never enabled, configured or shown for facilities. */
  platformOnly?: boolean;
  /**
   * Every facility sets this up for itself with its own account (e.g. its own M-Pesa till). The owner neither
   * configures nor switches it on; there is no platform record and no platform fallback.
   */
  facilitySelfService?: boolean;
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
      { key: 'tenantCode', label: 'HIE tenant ID or tenant code (for status callbacks; normally the client ID)' },
    ],
    secrets: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', required: true },
    ],
  },
  mpesa: {
    label: 'M-Pesa (Daraja)',
    facilitySelfService: true,
    environments: ['sandbox', 'production'],
    defaultBaseUrls: { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' },
    settings: [
      {
        key: 'accountType',
        label: 'Customers pay into',
        required: true,
        options: [{ value: 'paybill', label: 'Paybill (the invoice number is the account number)' }, { value: 'till', label: 'Till number (Buy Goods)' }],
      },
      { key: 'shortcode', label: 'Paybill number', required: true, showWhen: { key: 'accountType', value: 'paybill' }, help: 'The paybill your Daraja Go-Live app was approved for. The passkey below must belong to this paybill.' },
      { key: 'shortcode', label: 'Store number (head office number)', required: true, showWhen: { key: 'accountType', value: 'till' }, help: 'For a till, Safaricom issues the passkey against the store (head office) number, not the till. It is on your Go-Live approval email. If you only have the till, enter the till here too.' },
      { key: 'till', label: 'Till number', showWhen: { key: 'accountType', value: 'till' }, help: 'The Buy Goods till customers pay into; its name appears on the customer\'s prompt.' },
      { key: 'paybill', label: 'Paybill number', hidden: true },
      { key: 'transactionType', label: 'STK transaction type', hidden: true },
      { key: 'baseUrl', label: 'API base URL', help: 'Filled in for the environment you choose (sandbox.safaricom.co.ke or api.safaricom.co.ke). Change it only if Safaricom gives you a different address.' },
      { key: 'b2cEnabled', label: 'B2C refund payouts enabled (true/false)', default: 'false' },
      { key: 'b2cShortcode', label: 'B2C shortcode (disbursement account)' },
      { key: 'b2cInitiatorName', label: 'B2C initiator username' },
    ],
    secrets: [
      { key: 'consumerKey', label: 'Consumer Key', required: true },
      { key: 'consumerSecret', label: 'Consumer Secret', required: true },
      { key: 'passkey', label: 'Passkey', required: true },
      { key: 'b2cInitiatorPassword', label: 'B2C initiator password' },
      { key: 'b2cCertificate', label: 'Safaricom public certificate (PEM) for the environment' },
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
  talksasa: {
    label: 'Talksasa SMS',
    environments: ['production'],
    // The API host published in the Talksasa Bulk SMS API documentation (API v3).
    defaultBaseUrls: { production: 'https://bulksms.talksasa.com/api/v3' },
    settings: [
      { key: 'baseUrl', label: 'API base URL', required: true, default: 'https://bulksms.talksasa.com/api/v3' },
      { key: 'senderId', label: 'Sender ID (approved by Talksasa; up to 11 characters)', required: true },
    ],
    secrets: [{ key: 'apiToken', label: 'API token (Bearer)', required: true }],
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
  slade360: {
    label: 'Slade360 / HealthCloud (private insurance EDI)',
    environments: ['sandbox', 'production'],
    facilityCredentialsOnly: true,
    // Sandbox hosts as given in the Slade360 provider API documentation; production hosts must be entered.
    defaultBaseUrls: { sandbox: 'https://provider-edi-api.multitenant.slade360.co.ke/v1' },
    settings: [
      { key: 'baseUrl', label: 'Provider EDI API base URL', required: true },
      { key: 'authUrl', label: 'OAuth 2.0 token URL (…/oauth2/token/)', required: true },
      { key: 'grantType', label: 'OAuth grant type exactly as documented for your account (e.g. password or client_credentials)', required: true },
      { key: 'providerCode', label: 'Provider / facility code at Slade360' },
      { key: 'locationCode', label: 'Location code (claims)' },
      { key: 'locationName', label: 'Location name (claims)' },
      { key: 'factorOtp', label: 'start_visit factor value for OTP (per documentation)' },
      { key: 'factorFingerprint', label: 'start_visit factor value for fingerprint (only with Slade biometric devices)' },
      { key: 'factorGuardian', label: 'start_visit factor value for guardian authentication' },
    ],
    secrets: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client secret', required: true },
      { key: 'username', label: 'Username (only if your grant type requires it)' },
      { key: 'password', label: 'Password (only if your grant type requires it)' },
    ],
  },
  google: {
    label: 'Google Sign-In (OpenID Connect)',
    environments: ['production'],
    settings: [
      { key: 'clientId', label: 'OAuth client ID', required: true },
      { key: 'discoveryUrl', label: 'OpenID discovery URL', default: 'https://accounts.google.com/.well-known/openid-configuration' },
      { key: 'redirectUri', label: 'Authorized redirect URI (register this exact URL in Google Cloud Console)' },
      { key: 'hostedDomain', label: 'Restrict to a Google Workspace domain (optional)' },
    ],
    secrets: [{ key: 'clientSecret', label: 'OAuth client secret', required: true }],
  },
  mpesa_billing: {
    label: 'M-Pesa collections (AfeySync subscription payments)',
    platformOnly: true,
    environments: ['sandbox', 'production'],
    defaultBaseUrls: { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' },
    settings: [
      { key: 'shortcode', label: 'Business shortcode (paybill, or head office number for a till)', required: true },
      { key: 'transactionType', label: 'STK transaction type: CustomerPayBillOnline (paybill) or CustomerBuyGoodsOnline (till)', default: 'CustomerPayBillOnline' },
      { key: 'till', label: 'Till number (only for Buy Goods)' },
      { key: 'paybill', label: 'Paybill number shown on invoices' },
      { key: 'accountLabel', label: 'Account number instruction shown on invoices', default: 'Use the invoice number as the account number' },
      { key: 'baseUrl', label: 'API base URL (defaults per environment)' },
    ],
    secrets: [
      { key: 'consumerKey', label: 'Consumer Key', required: true },
      { key: 'consumerSecret', label: 'Consumer Secret', required: true },
      { key: 'passkey', label: 'Lipa na M-Pesa Online passkey', required: true },
    ],
  },
  payhero: {
    label: 'Pay Hero (M-Pesa)',
    facilitySelfService: true,
    environments: ['production'],
    defaultBaseUrls: { production: 'https://backend.payhero.co.ke' },
    settings: [
      { key: 'channelId', label: 'Payment channel ID', required: true, help: 'In Pay Hero: Payment Channels → My Payment Channels. The channel is the paybill, till or bank account the money goes to.' },
      {
        key: 'role',
        label: 'Use Pay Hero for M-Pesa prompts',
        required: true,
        default: 'primary',
        options: [{ value: 'primary', label: 'Always (Pay Hero sends every prompt)' }, { value: 'backup', label: 'Only when M-Pesa (Daraja) is not set up' }],
      },
      { key: 'credentialId', label: 'Pay Hero credential ID (optional)', help: 'Only if you registered your own Daraja keys inside Pay Hero. Leave blank otherwise.' },
      { key: 'baseUrl', label: 'API base URL', help: 'Filled in (backend.payhero.co.ke). Change it only if Pay Hero gives you a different address.' },
    ],
    // Pay Hero → Developers → API Keys → Generate key shows a username, a password and a secret.
    // Prompts sign in with HTTP Basic (username + password); the secret is optional.
    secrets: [
      { key: 'apiUsername', label: 'API key username', required: true },
      { key: 'apiPassword', label: 'API key password', required: true },
      { key: 'apiSecret', label: 'API secret (optional)' },
    ],
  },
  payhero_billing: {
    label: 'Pay Hero (AfeySync subscription and SMS payments)',
    platformOnly: true,
    environments: ['production'],
    defaultBaseUrls: { production: 'https://backend.payhero.co.ke' },
    settings: [
      { key: 'channelId', label: 'Payment channel ID', required: true, help: 'In Pay Hero: Payment Channels → My Payment Channels. The channel is the paybill, till or bank account the money goes to.' },
      {
        key: 'role',
        label: 'Use Pay Hero for M-Pesa prompts',
        required: true,
        default: 'primary',
        options: [{ value: 'primary', label: 'Always (Pay Hero sends every prompt)' }, { value: 'backup', label: 'Only when M-Pesa collections (Daraja) is not set up' }],
      },
      { key: 'credentialId', label: 'Pay Hero credential ID (optional)', help: 'Only if you registered your own Daraja keys inside Pay Hero. Leave blank otherwise.' },
      { key: 'baseUrl', label: 'API base URL', help: 'Filled in (backend.payhero.co.ke). Change it only if Pay Hero gives you a different address.' },
    ],
    // Pay Hero → Developers → API Keys → Generate key shows a username, a password and a secret.
    // Prompts sign in with HTTP Basic (username + password); the secret is optional.
    secrets: [
      { key: 'apiUsername', label: 'API key username', required: true },
      { key: 'apiPassword', label: 'API key password', required: true },
      { key: 'apiSecret', label: 'API secret (optional)' },
    ],
  },
  storage: {
    label: 'Document Storage',
    environments: ['production'],
    settings: [{ key: 'driver', label: 'Driver', default: 'local' }],
    secrets: [],
  },
};
