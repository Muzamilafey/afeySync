import Link from 'next/link';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { FEATURE_GROUPS } from '@/features/site/content';
import { pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata(
  'Features: OPD, Lab, Pharmacy, Wards, Billing, M-Pesa & SHA',
  'Everything AfeySync does for your facility: patient registration, appointments, triage, consultation, laboratory, radiology, pharmacy, inventory, wards, maternity, billing, M-Pesa, SHA and insurance claims, and reports.',
  '/features',
);

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="Features" title="Everything your facility needs, in one place" intro="AfeySync covers the whole patient journey and the back office behind it. Turn on the modules you use and add more as you grow.">
        <nav aria-label="Feature sections" className="mt-8 flex flex-wrap gap-2">
          {FEATURE_GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:ring-brand-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">{g.title}</a>
          ))}
        </nav>
      </PageHero>
      <div className="mx-auto max-w-6xl space-y-20 px-4 py-20 sm:px-6 lg:px-8">
        {FEATURE_GROUPS.map((g) => (
          <section key={g.id} id={g.id} className="scroll-mt-24 grid gap-10 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{g.title}</h2>
              <p className="mt-3 text-slate-600 dark:text-slate-400">{g.summary}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.items.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
                    <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="text-center text-sm text-slate-500">Want to see a module in action? <Link href="/contact" className="font-semibold text-brand-700 hover:underline dark:text-emerald-300">Ask us for a demo</Link>.</p>
      </div>
      <CtaBand />
    </>
  );
}
