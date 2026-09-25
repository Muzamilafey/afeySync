import Link from 'next/link';
import { ArrowRight, BookOpen, LifeBuoy } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { CONTACT, pageMetadata } from '@/features/site/site';
import { GUIDE_GROUPS, GUIDE_TOPICS, guideStepCount } from '@/features/site/guide';
import { WhatsAppIcon } from '@/features/site/WhatsAppIcon';

export const metadata = pageMetadata(
  'User Guide: Learn Every AfeySync Feature Step by Step',
  'The complete AfeySync user guide: registration, sign-in, front desk, appointments, triage, consultation, prescribing, laboratory, radiology, pharmacy, inventory, wards, maternity, billing, M-Pesa, SHA claims, insurance, reports and more.',
  '/user-guide',
);

export default function UserGuideIndex() {
  const quick = ['register-your-facility', 'signing-in', 'facility-setup', 'front-desk'];
  return (
    <>
      <PageHero eyebrow="User guide" title="Learn AfeySync, step by step" intro={`${GUIDE_TOPICS.length} topics and ${guideStepCount} clear steps covering every part of AfeySync, from registering your facility to SHA claims and reports. Share any page with your team.`}>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/user-guide/register-your-facility" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-brand-600/25 hover:bg-brand-700">Start at the beginning <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          <Link href="/user-guide/troubleshooting" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">Troubleshooting</Link>
        </div>
      </PageHero>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">New to AfeySync? Start here</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quick.map((slug, i) => {
            const t = GUIDE_TOPICS.find((x) => x.slug === slug)!;
            return (
              <li key={slug}>
                <Link href={`/user-guide/${slug}`} className="flex h-full flex-col rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white shadow-lg shadow-brand-600/20 transition hover:-translate-y-0.5">
                  <span className="text-xs font-semibold text-emerald-100/80">Step {i + 1}</span>
                  <span className="mt-2 text-lg font-semibold">{t.title}</span>
                  <span className="mt-1 text-sm text-emerald-50/80">{t.summary}</span>
                </Link>
              </li>
            );
          })}
        </ol>

        <div className="mt-16 space-y-14">
          {GUIDE_GROUPS.map((group) => {
            const topics = GUIDE_TOPICS.filter((t) => t.group === group);
            if (!topics.length) return null;
            return (
              <div key={group}>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{group}</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {topics.map(({ slug, title, summary, icon: Icon, sections }) => (
                    <Link key={slug} href={`/user-guide/${slug}`} className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-lg hover:shadow-brand-600/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-slate-800 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
                      <span>
                        <span className="block font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-emerald-300">{title}</span>
                        <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{summary}</span>
                        <span className="mt-2 block text-xs text-slate-500">{sections.reduce((n, s) => n + s.steps.length, 0)} steps</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 grid gap-4 rounded-3xl bg-slate-50 p-8 sm:grid-cols-[auto_1fr_auto] sm:items-center dark:bg-slate-900">
          <LifeBuoy className="h-10 w-10 text-brand-600" aria-hidden />
          <div>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">Can’t find what you need?</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Our team will walk you through it. Call {CONTACT.phoneDisplay} or message us on WhatsApp.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe5a]"><WhatsAppIcon className="h-4 w-4" /> WhatsApp</a>
            <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"><BookOpen className="h-4 w-4" /> Contact us</Link>
          </div>
        </div>
      </section>
      <CtaBand title="Ready to try it with your team?" />
    </>
  );
}
