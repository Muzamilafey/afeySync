import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteShell } from '@/features/site/SiteShell';
import { isWebsiteHost } from '@/features/site/site';

/** Website pages exist only on afey.co.ke; a facility, accounts or owner address goes to its own start page. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  if (!(await isWebsiteHost())) redirect('/');
  return <SiteShell>{children}</SiteShell>;
}
