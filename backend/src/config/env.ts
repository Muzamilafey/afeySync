import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_META_URI: z.string().default('mongodb://127.0.0.1:27017/afeysync_meta'),
  /** Base URI (no db path) used for tenant databases. Defaults to the meta URI's server. */
  MONGO_TENANT_URI: z.string().optional(),
  TENANT_DB_PREFIX: z.string().default('afeysync_tenant_'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  /** base64-encoded 32-byte key for AES-256-GCM secret encryption */
  INTEGRATION_ENCRYPTION_KEY: z.string().min(40),
  INTEGRATION_ENCRYPTION_KEY_ID: z.string().default('k1'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  OWNER_URL: z.string().default('http://owner.localhost:3000'),
  API_URL: z.string().default('http://localhost:4000'),
  /** Root platform domain: tenants live on <slug>.<PLATFORM_DOMAIN> */
  PLATFORM_DOMAIN: z.string().default('localhost'),
  OWNER_HOSTS: z.string().default('owner.localhost'),
  /**
   * Central sign-in: passwords are only accepted on the accounts address (default accounts.<PLATFORM_DOMAIN>;
   * accounts.localhost always works locally), which hands the user over to their facility's own address.
   */
  ACCOUNTS_HOST: z.string().optional(),
  CENTRAL_LOGIN: bool(true),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('loopback'),
  COOKIE_SECURE: bool(false),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(30),
  FILE_STORAGE_PATH: z.string().default('./storage'),
  REDIS_URL: z.string().optional(),
  RUN_WORKERS: bool(true),
  LOG_LEVEL: z.string().default('info'),
  // Optional bootstrap of platform-level integration credentials (imported encrypted on first boot).
  DHA_ENV: z.enum(['uat', 'production']).default('uat'),
  DHA_BASE_URL: z.string().optional(),
  DHA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  DHA_ENABLE_CALLBACKS: z.enum(['true', 'false']).default('true'),
  DHA_CLIENT_ID: z.string().optional(),
  DHA_CLIENT_SECRET: z.string().optional(),
  DHA_FACILITY_ID: z.string().optional(),
  DHA_FACILITY_ID_TYPE: z.string().optional(),
  SHA_BASE_URL: z.string().optional(),
  SHA_CLIENT_ID: z.string().optional(),
  SHA_CLIENT_SECRET: z.string().optional(),
  SHA_FACILITY_ID: z.string().optional(),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_TILL: z.string().optional(),
  MPESA_PAYBILL: z.string().optional(),
  MPESA_ENVIRONMENT: z.string().optional(),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  TALKSASA_API_TOKEN: z.string().optional(),
  TALKSASA_SENDER_ID: z.string().optional(),
  TALKSASA_BASE_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_ENCRYPTION: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** Shown in emails ("Didn't request this? Please contact …"). Optional; nothing is shown when unset. */
  SUPPORT_EMAIL: z.string().email().optional(),
  SUPPORT_PHONE: z.string().max(30).optional(),
  /** Footer links in emails: "Website|https://…,LinkedIn|https://…" (https only). */
  EMAIL_FOOTER_LINKS: z.string().max(1000).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: never boot with missing security configuration.
  console.error('Invalid environment configuration:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const ownerHosts = env.OWNER_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
export const accountsHost = (env.ACCOUNTS_HOST || `accounts.${env.PLATFORM_DOMAIN}`).trim().toLowerCase();
/** Read at request time so it can be switched in tests. */
export const authConfig = { centralLogin: env.CENTRAL_LOGIN };

