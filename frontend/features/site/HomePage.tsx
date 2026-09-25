import Link from 'next/link';
import { ArrowRight, CheckCircle2, ChevronDown, Phone } from 'lucide-react';
import { CtaBand } from './SiteShell';
import { CONTACT, accountsLinks, siteUrl } from './site';
import { FAQ, FEATURE_GROUPS, HIGHLIGHTS } from './content';
import { fetchPosts } from '@/features/blog/server';
import { PostCard } from '@/features/blog/PostCard';
import { GUIDE_TOPICS } from './guide';

/** A drawn, illustrative preview of the product (no real patient data). */
function ProductPreview() {
  const queue = [
    { n: 'Triage', c: 4, w: 'w-2/5' },
    { n: 'Consultation', c: 7, w: 'w-4/5' },
    { n: 'Laboratory', c: 3, w: 'w-1/3' },
    { n: 'Pharmacy', c: 5, w: 'w-3/5' },
  ];
  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-brand-200/60 via-emerald-100/40 to-sky-100/50 blur-2xl dark:from-brand-900/40 dark:via-slate-900 dark:to-slate-900" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 rounded-md bg-white px-3 py-0.5 text-[11px] text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">yourfacility.afey.co.ke/dashboard</span>
        </div>
        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[150px_1fr]">
          <div className="space-y-1.5 border-r border-slate-100 bg-[#062f29] p-3 dark:border-slate-800">
            {['Dashboard', 'Front Desk', 'Appointments', 'Patients', 'Laboratory', 'Pharmacy', 'Billing', 'SHA Claims', 'Reports'].map((m, i) => (
              <div key={m} className={`rounded-md px-2 py-1.5 text-[11px] ${i === 0 ? 'bg-white/15 font-semibold text-white' : 'text-emerald-50/70'}`}>{m}</div>
            ))}
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-3 gap-2.5">
              {[['Visits today', '48'], ['In queue', '19'], ['Admitted', '12']].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-100 p-2.5 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400">{l}</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Live queues</p>
              <div className="mt-2.5 space-y-2">
                {queue.map((q) => (
                  <div key={q.n} className="flex items-center gap-2">
                    <span className="w-20 text-[10px] text-slate-500">{q.n}</span>
                    <span className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800"><span className={`block h-2 rounded-full bg-brand-500 ${q.w}`} /></span>
                    <span className="w-4 text-right text-[10px] font-semibold text-slate-700 dark:text-slate-300">{q.c}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-brand-50 p-2.5 dark:bg-slate-800"><p className="text-[10px] text-brand-700 dark:text-emerald-300">M-Pesa confirmed</p><p className="text-sm font-bold text-slate-900 dark:text-white">Receipt printed</p></div>
              <div className="rounded-xl bg-sky-50 p-2.5 dark:bg-slate-800"><p className="text-[10px] text-sky-700 dark:text-sky-300">Lab result</p><p className="text-sm font-bold text-slate-900 dark:text-white">Verified</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function HomePage() {
  const [links, latest] = await Promise.all([accountsLinks(), fetchPosts({ limit: 3 })]);
  const url = siteUrl();
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'AfeySync',
      url,
      logo: `${url}/icons/icon-512.png`,
      email: CONTACT.email,
      telephone: CONTACT.phoneTel,
      areaServed: 'KE',
      contactPoint: [{ '@type': 'ContactPoint', telephone: CONTACT.phoneTel, email: CONTACT.email, contactType: 'sales', areaServed: 'KE', availableLanguage: ['English', 'Swahili'] }],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'AfeySync HMIS',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Hospital Management Information System',
      operatingSystem: 'Web browser',
      url,
      description: 'Cloud hospital management system for Kenyan hospitals and clinics: patient registration, OPD, lab, pharmacy, wards, maternity, billing, M-Pesa and SHA claims.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      {/* Hero */}
      <section className="relative -mt-16 overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white pt-16 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="pointer-events-none absolute -top-40 -right-40 h-[32rem] w-[32rem] rounded-full bg-brand-200/50 blur-3xl dark:bg-brand-900/30" aria-hidden />
        <div className="pointer-events-none absolute top-40 -left-40 h-80 w-80 rounded-full bg-sky-100/60 blur-3xl dark:bg-sky-900/20" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:pt-20 lg:pb-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100 dark:bg-slate-900 dark:text-emerald-300 dark:ring-slate-800">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Hospital management system built for Kenya
            </p>
            <h1 className="mt-6 text-4xl leading-[1.08] font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
              Run your whole facility <span className="bg-gradient-to-r from-brand-600 to-emerald-500 bg-clip-text text-transparent">in one secure system.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              AfeySync connects reception, triage, doctors, the lab, pharmacy, wards, maternity and the cashier, with M-Pesa payments and SHA claims built in. No installation, no paper chasing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={links.getStarted} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700">
                Get started <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={`tel:${CONTACT.phoneTel}`} className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800">
                <Phone className="h-4 w-4 text-brand-600" aria-hidden /> Call {CONTACT.phoneDisplay}
              </a>
            </div>
            <ul className="mt-8 grid max-w-lg gap-2.5 text-sm text-slate-600 sm:grid-cols-2 dark:text-slate-400">
              {['Your own private database', 'Cash, SHA, insurance & M-Pesa', 'Works on phone, tablet & PC', 'Two-step verification'].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* Module strip */}
      <section className="border-y border-slate-100 bg-slate-50/60 dark:border-slate-900 dark:bg-slate-900/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm font-medium text-slate-500 sm:px-6 lg:px-8 dark:text-slate-400">
          {['Front desk', 'OPD', 'Laboratory', 'Radiology', 'Pharmacy', 'Inpatient', 'Maternity', 'Dental', 'Billing', 'M-Pesa', 'SHA', 'Insurance', 'Reports'].map((m) => <span key={m}>{m}</span>)}
        </div>
      </section>

      {/* Highlights */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">Why AfeySync</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">Built around how Kenyan facilities actually work</h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">From a single clinic to a multi-branch hospital, AfeySync keeps every department on the same page and your data safe.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-slate-800 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-5 text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Departments */}
      <section className="bg-slate-50 py-20 dark:bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">Every department</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">One patient record, from arrival to discharge</h2>
            </div>
            <Link href="/features" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300">See all features <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.slice(0, 6).map((g) => {
              const Icon = g.items[0].icon;
              return (
                <Link key={g.id} href={`/features#${g.id}`} className="group rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:shadow-lg hover:ring-brand-200 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-brand-700">
                  <Icon className="h-6 w-6 text-brand-600 dark:text-emerald-300" aria-hidden />
                  <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{g.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{g.summary}</p>
                  <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{g.items.map((i) => i.title).join(' · ')}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">Getting started</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">Up and running in three steps</h2>
        </div>
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            { t: 'Register online', d: 'Fill in your facility details, choose your web address and verify your email. It takes about five minutes.' },
            { t: 'Set up your facility', d: 'Add your logo, staff and roles, price lists and stock. Import your drug list from Excel.' },
            { t: 'Start seeing patients', d: 'Your team signs in securely and every department works from the same patient record.' },
          ].map((s, i) => (
            <li key={s.t} className="relative rounded-2xl border border-slate-200 p-7 dark:border-slate-800">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-white">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{s.d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-center text-sm text-slate-600 dark:text-slate-400">
          Need a hand? Read the <Link href="/user-guide" className="font-semibold text-brand-700 hover:underline dark:text-emerald-300">user guide</Link> or <Link href="/contact" className="font-semibold text-brand-700 hover:underline dark:text-emerald-300">talk to us</Link>.
        </p>
      </section>


      {/* Latest articles */}
      {latest.posts.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">From our blog</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">News and guides for your facility</h2>
            </div>
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300">All articles <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">{latest.posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
        </section>
      )}

      {/* User guide */}
      <section className="bg-gradient-to-br from-[#062f29] to-[#0a6e5c] py-20 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold tracking-wide text-emerald-300 uppercase">User guide</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Every feature, taught step by step</h2>
            <p className="mt-4 text-emerald-50/80">{GUIDE_TOPICS.length} easy guides for every role: reception, nurses, clinicians, lab, pharmacy, cashiers and managers.</p>
            <Link href="/user-guide" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#062f29] hover:bg-emerald-50">Open the user guide <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {GUIDE_TOPICS.filter((t) => ['front-desk', 'consultation', 'laboratory', 'pharmacy', 'billing-and-cashier', 'sha-claims', 'inpatient', 'reports'].includes(t.slug)).map(({ slug, title, icon: Icon }) => (
              <Link key={slug} href={`/user-guide/${slug}`} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3.5 ring-1 ring-white/15 transition hover:bg-white/15">
                <Icon className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
                <span className="text-sm font-medium">{title}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50 py-20 dark:bg-slate-900/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 open:ring-brand-200 dark:bg-slate-900 dark:ring-slate-800">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
