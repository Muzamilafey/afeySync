import { accountsHost, env, ownerHosts } from '../../config/env';

/**
 * Web addresses (subdomains) the platform keeps for itself. A facility can never be given one of these;
 * they are reported as "already in use", exactly like an address another facility has.
 */
export const RESERVED_SLUGS = new Set([
  // sign-in and identity
  'accounts', 'account', 'identity', 'id', 'auth', 'oauth', 'sso', 'login', 'signin', 'sign-in', 'logout', 'signup', 'sign-up', 'register', 'profile', 'profiles', 'my', 'me', 'user', 'users', 'session', 'verify', 'mfa', 'passkey', 'passkeys', 'password', 'reset',
  // the platform itself
  'app', 'apps', 'www', 'owner', 'owners', 'admin', 'administrator', 'root', 'system', 'platform', 'portal', 'console', 'dashboard', 'secure', 'security', 'internal', 'staff',
  'afey', 'afeysync', 'afey-sync', 'hmis',
  // infrastructure
  'api', 'apis', 'gateway', 'graphql', 'ws', 'socket', 'cdn', 'static', 'assets', 'media', 'files', 'uploads', 'img', 'images', 'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns', 'vpn', 'ftp', 'sftp', 'git', 'ci',
  'status', 'health', 'metrics', 'monitor', 'logs', 'backup', 'backups', 'db', 'database', 'redis', 'mongo',
  // business and support
  'billing', 'payments', 'pay', 'mpesa', 'invoice', 'invoices', 'checkout', 'support', 'help', 'helpdesk', 'docs', 'documentation', 'blog', 'news', 'about', 'contact', 'legal', 'privacy', 'terms',
  'get-started', 'onboarding', 'sales', 'marketing', 'partners', 'careers', 'jobs',
  // environments
  'test', 'testing', 'demo', 'dev', 'development', 'stage', 'staging', 'sandbox', 'preview', 'beta', 'uat', 'prod', 'production', 'localhost',
]);

export const ALREADY_IN_USE = 'This address is already in use. Please choose another.';

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.has(slug.trim().toLowerCase());

/** A hostname the platform uses (accounts/owner addresses, or <reserved>.<PLATFORM_DOMAIN>). */
export function isReservedHostname(hostname: string) {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (h === accountsHost || ownerHosts.includes(h) || h === env.PLATFORM_DOMAIN.toLowerCase()) return true;
  const apexes = [env.PLATFORM_DOMAIN.toLowerCase(), 'localhost'];
  return apexes.some((apex) => h.endsWith(`.${apex}`) && h.slice(0, -(apex.length + 1)).split('.').some((label) => RESERVED_SLUGS.has(label)));
}
