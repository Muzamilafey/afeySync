import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/** Owner portal and facility app share one deployment; the hostname decides which one is served. */
export default async function Root() {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0].toLowerCase();
  const ownerHosts = (process.env.OWNER_HOSTS ?? 'owner.localhost').split(',').map((s) => s.trim());
  redirect(ownerHosts.includes(host) ? '/owner' : '/dashboard');
}
