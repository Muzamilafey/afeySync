import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { GUIDE } from '@/features/site/content';
import { CONTACT, pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata(
  'User Guide: Getting Started with AfeySync',
  'Step-by-step guide to AfeySync: register your facility, sign in securely, set up users, prices and stock, run a patient visit, admissions, maternity, reports and claims.',
  '/user-guide',
);

export default function UserGuidePage() {
  const howTo = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to register a facility on AfeySync',
    step: GUIDE[0].steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: s.text })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo).replace(/</g, '\\u003c') }} />
      <PageHero eyebrow="User guide" title="Learn AfeySync step by step" intro="From registering your facility to your first patient visit and your monthly reports. Share this page with your team." />
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[240px_1fr] lg:px-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">On this page</p>
          <nav aria-label="User guide sections" className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            {GUIDE.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-brand-700 lg:ring-0 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-900">{s.title}</a>
            ))}
          </nav>
          <div className="mt-8 hidden rounded-2xl bg-brand-50 p-4 text-sm lg:block dark:bg-slate-900">
            <LifeBuoy className="h-5 w-5 text-brand-700 dark:text-emerald-300" aria-hidden />
            <p className="mt-2 font-semibold text-slate-900 dark:text-white">Stuck?</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">Call <a className="font-semibold text-brand-700 dark:text-emerald-300" href={`tel:${CONTACT.phoneTel}`}>{CONTACT.phoneDisplay}</a> or <Link className="font-semibold text-brand-700 dark:text-emerald-300" href="/contact">send us a message</Link>.</p>
          </div>
        </aside>
        <div className="space-y-16">
          {GUIDE.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{section.title}</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">{section.intro}</p>
              <ol className="mt-6 space-y-3">
                {section.steps.map((step, i) => (
                  <li key={step.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
      <CtaBand title="Ready to try it with your team?" />
    </>
  );
}
