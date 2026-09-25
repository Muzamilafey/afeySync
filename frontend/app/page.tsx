import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/** Owner portal and facility app share one deployment; the hostname decides which one is served. */
export default async function Root() {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0].toLowerCase();
  const ownerHosts = (process.env.OWNER_HOSTS ?? 'owner.localhost').split(',').map((s) => s.trim());
  // The bare platform domain (e.g. afeysync.com) is not a facility: send visitors to registration.
  const apex = (process.env.PLATFORM_DOMAIN ?? 'localhost').toLowerCase();
  if (host === apex || host === `www.${apex}`) redirect('/get-started');
  redirect(ownerHosts.includes(host) ? '/owner' : '/dashboard');
}
