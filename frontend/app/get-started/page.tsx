import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingWizard } from '@/features/onboarding/Wizard';
import { accountsLinks, isWebsiteHost } from '@/features/site/site';

export const metadata: Metadata = { title: 'Get started · AfeySync', description: 'Register your facility on AfeySync' };

export default async function GetStartedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Registration lives on the accounts address; the website's own /get-started link forwards there (keeping ?plan=).
  if (await isWebsiteHost()) {
    const plan = (await searchParams).plan;
    const { getStarted } = await accountsLinks();
    redirect(typeof plan === 'string' && /^[a-z0-9_-]{1,40}$/i.test(plan) ? `${getStarted}?plan=${plan}` : getStarted);
  }
  return <OnboardingWizard />;
}
