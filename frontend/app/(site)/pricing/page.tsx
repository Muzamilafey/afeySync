import Link from 'next/link';
import { Check } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { accountsLinks, CONTACT, pageMetadata } from '@/features/site/site';
import { cn } from '@/lib/utils';

export const metadata = pageMetadata('Pricing & Plans', 'AfeySync plans for Kenyan clinics, medical centres and hospitals. Choose a plan and register your facility online.', '/pricing');

interface Plan { key: string; name: string; description?: string; currency?: string; prices: { monthly: number; quarterly: number; annual: number }; setupFee: number; maxBranches: number; maxUsers: number; trialDays: number; features: string[]; highlight?: boolean }

/** The live, public plan catalogue as the owner has set it up (never hard-coded prices). */
async function loadPlans(): Promise<Plan[]> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/onboarding/config`, { headers: { Accept: 'application/json' }, next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { plans?: Plan[] } };
    return body.data?.plans ?? [];
  } catch {
    return [];
  }
}

/** "Up to 3 branches, 60 users", unless the plan's own feature list already says it. */
const limitsLine = (p: Plan, features: string[]) => (features.some((f) => /branch/i.test(f)) ? null : `Up to ${p.maxBranches} branch${p.maxBranches === 1 ? '' : 'es'}, ${p.maxUsers} users`);

const money = (currency: string | undefined, n: number) => `${currency ?? 'KES'} ${n.toLocaleString('en-KE')}`;

export default async function PricingPage() {
  const [plans, links] = await Promise.all([loadPlans(), accountsLinks()]);
  return (
    <>
      <PageHero eyebrow="Pricing" title="Simple plans that grow with your facility" intro="Pick the plan that fits today. You can move up as you add branches, staff and modules." />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {plans.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 p-10 text-center dark:border-slate-800">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Pricing tailored to your facility</h2>
            <p className="mt-3 text-slate-600 dark:text-slate-400">Tell us about your facility and we will recommend the right plan. Call <a className="font-semibold text-brand-700 dark:text-emerald-300" href={`tel:${CONTACT.phoneTel}`}>{CONTACT.phoneDisplay}</a> or email <a className="font-semibold text-brand-700 dark:text-emerald-300" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.</p>
            <div className="mt-6 flex justify-center gap-3">
              <a href={links.getStarted} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Get started</a>
              <Link href="/contact" className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">Contact us</Link>
            </div>
          </div>
        ) : (
          <div className={cn('grid gap-6', plans.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : plans.length >= 3 ? 'lg:grid-cols-3' : 'mx-auto max-w-4xl md:grid-cols-2')}>
            {plans.map((p) => (
              <div key={p.key} className={cn('relative flex flex-col rounded-3xl border bg-white p-7 dark:bg-slate-900', p.highlight ? 'border-brand-500 shadow-xl shadow-brand-600/10 ring-1 ring-brand-500' : 'border-slate-200 dark:border-slate-800')}>
                {p.highlight && <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{p.name}</h2>
                {p.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{p.description}</p>}
                <p className="mt-6">
                  {p.prices.monthly > 0 ? (
                    <span className="whitespace-nowrap"><span className="text-2xl font-bold text-slate-900 xl:text-[26px] dark:text-white">{money(p.currency, p.prices.monthly)}</span><span className="text-sm text-slate-500"> / month</span></span>
                  ) : p.key === 'trial' && p.trialDays > 0 ? (
                    <span className="text-2xl font-bold text-slate-900 dark:text-white">Free for {p.trialDays} days</span>
                  ) : (
                    <span className="text-xl font-semibold text-slate-700 dark:text-slate-200">Pricing on request</span>
                  )}
                </p>
                {p.prices.annual > 0 && <p className="mt-1 text-xs text-slate-500">or {money(p.currency, p.prices.annual)} a year</p>}
                {p.setupFee > 0 && <p className="mt-1 text-xs text-slate-500">One-time setup: {money(p.currency, p.setupFee)}</p>}
                <ul className="mt-6 flex-1 space-y-2.5 text-sm text-slate-600 dark:text-slate-400">
                  {limitsLine(p, p.features) && <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />{limitsLine(p, p.features)}</li>}
                  {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />{f}</li>)}
                </ul>
                <a href={`${links.getStarted}?plan=${encodeURIComponent(p.key)}`} className={cn('mt-8 rounded-xl px-5 py-3 text-center text-sm font-semibold', p.highlight ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 dark:text-emerald-300 dark:ring-slate-700 dark:hover:bg-slate-800')}>
                  Choose {p.name}
                </a>
              </div>
            ))}
          </div>
        )}
        <p className="mt-10 text-center text-sm text-slate-500">Running a larger hospital or a group of facilities? <Link href="/contact" className="font-semibold text-brand-700 hover:underline dark:text-emerald-300">Talk to us</Link> about a plan for you.</p>
      </section>
      <CtaBand />
    </>
  );
}
