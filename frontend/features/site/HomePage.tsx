import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { CtaBand } from './SiteShell';
import { BRAND_NAMES, CONTACT, accountsLinks, siteUrl } from './site';
import { FAQ, FEATURE_GROUPS, HIGHLIGHTS } from './content';
import { fetchPosts } from '@/features/blog/server';
import { formatDate, type PostSummary } from '@/features/blog/shared';
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
    <figure className="overflow-hidden rounded-lg border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900" aria-hidden>
      <div className="border-b border-stone-200 px-4 py-2 text-[11px] text-stone-400 dark:border-stone-800">yourfacility.afey.co.ke/home</div>
      <div className="grid grid-cols-[112px_1fr] sm:grid-cols-[140px_1fr]">
        <div className="space-y-0.5 border-r border-stone-200 bg-stone-50 p-2.5 dark:border-stone-800 dark:bg-stone-950">
          {['Home', 'Front desk', 'Patients', 'Consultation', 'Laboratory', 'Pharmacy', 'Billing', 'SHA claims', 'Reports'].map((m, i) => (
            <div key={m} className={`rounded px-2 py-1.5 text-[11px] ${i === 0 ? 'bg-white font-medium text-stone-900 ring-1 ring-stone-200 dark:bg-stone-800 dark:text-white dark:ring-stone-700' : 'text-stone-500'}`}>{m}</div>
          ))}
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 divide-x divide-stone-200 rounded border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {[['Visits today', '48'], ['Waiting', '19'], ['Admitted', '12']].map(([l, v]) => (
              <div key={l} className="p-2.5">
                <p className="text-[10px] text-stone-500">{l}</p>
                <p className="text-lg font-semibold text-stone-900 tabular-nums dark:text-white">{v}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[11px] font-medium text-stone-700 dark:text-stone-200">Queues right now</p>
            <div className="mt-2 space-y-2">
              {queue.map((q) => (
                <div key={q.n} className="flex items-center gap-2">
                  <span className="w-20 text-[10px] text-stone-500">{q.n}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-stone-100 dark:bg-stone-800"><span className={`block h-1.5 rounded-full bg-brand-600 ${q.w}`} /></span>
                  <span className="w-4 text-right text-[10px] font-medium text-stone-700 tabular-nums dark:text-stone-300">{q.c}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="divide-y divide-stone-100 rounded border border-stone-200 text-[10px] dark:divide-stone-800 dark:border-stone-800">
            {[['M-Pesa QJK4...  KES 1,500', 'Confirmed'], ['Full haemogram', 'Verified'], ['SHA visit authorised', 'OTP']].map(([a, b]) => (
              <div key={a} className="flex items-center justify-between px-2.5 py-1.5"><span className="text-stone-600 dark:text-stone-300">{a}</span><span className="font-medium text-brand-700 dark:text-emerald-300">{b}</span></div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** What happens to one patient, in the order it happens. */
const JOURNEY = [
  { t: 'Reception', d: 'Search or register the patient once, pick the payer (cash, SHA, insurance or a corporate scheme) and open the visit.' },
  { t: 'Triage', d: 'Vitals with normal ranges, BMI and flags. The patient drops into the doctor\u2019s queue.' },
  { t: 'Consultation', d: 'History, examination, ICD-coded diagnoses, lab and imaging orders and prescriptions in one note that locks when finalised.' },
  { t: 'Lab & imaging', d: 'Samples, results against normal ranges, verification. Results appear on the patient record for the clinician.' },
  { t: 'Pharmacy', d: 'The prescription arrives on its own. Stock is dispensed earliest-expiry first and deducted from the right store.' },
  { t: 'Cashier', d: 'Every item is priced by the server from your price list. Cash, card or M-Pesa, with a printed receipt.' },
  { t: 'Claim', d: 'SHA and insurance claims are prepared from what actually happened in the visit, then tracked to payment.' },
];

/** A compact article row for the side column of the home page's blog section. */
function PostRow({ post }: { post: PostSummary }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group grid grid-cols-[1fr_96px] gap-4 py-5 first:pt-0">
      <div>
        <p className="text-xs text-stone-500">{post.category ? <><span className="font-medium text-brand-700 dark:text-emerald-300">{post.category}</span> · </> : null}{formatDate(post.publishedAt)}</p>
        <h3 className="font-display mt-1.5 text-lg leading-snug text-stone-900 group-hover:underline group-hover:decoration-stone-300 group-hover:underline-offset-4 dark:text-white">{post.title}</h3>
        <p className="mt-1 text-xs text-stone-500">{post.readingMinutes} min read</p>
      </div>
      {post.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.coverImageUrl} alt="" loading="lazy" className="aspect-square w-24 rounded-md object-cover" />
      ) : <span className="aspect-square w-24 rounded-md bg-[#f7f6f2] dark:bg-stone-800" aria-hidden />}
    </Link>
  );
}

const eyebrow = 'text-sm font-medium text-brand-700 dark:text-emerald-300';
const h2 = 'font-display mt-3 text-3xl leading-tight text-stone-900 sm:text-[2.5rem] dark:text-white';

export async function HomePage() {
  const [links, latest] = await Promise.all([accountsLinks(), fetchPosts({ limit: 4 })]);
  const url = siteUrl();
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${url}/#organization`,
      name: 'AfeySync',
      alternateName: BRAND_NAMES,
      description: 'AfeySync (Afey HMIS) builds a cloud hospital management information system for Kenyan health facilities.',
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
      alternateName: BRAND_NAMES,
      publisher: { '@id': `${url}/#organization` },
      countriesSupported: 'KE',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Hospital Management Information System',
      operatingSystem: 'Web browser',
      url,
      description: 'Cloud hospital management system for Kenyan hospitals and clinics: patient registration, OPD, lab, pharmacy, wards, maternity, billing, M-Pesa and SHA claims.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${url}/#website`,
      name: 'AfeySync',
      alternateName: BRAND_NAMES,
      url: `${url}/`,
      inLanguage: 'en-KE',
      publisher: { '@id': `${url}/#organization` },
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${url}/blog?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  const [lead, ...others] = latest.posts;
  const featureCount = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const guideLinks = GUIDE_TOPICS.filter((t) => ['register-your-facility', 'front-desk', 'consultation', 'laboratory', 'pharmacy', 'billing-and-cashier', 'sha-claims', 'reports'].includes(t.slug));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      {/* Hero */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8 lg:pt-20 lg:pb-24">
          <div>
            <p className="text-sm text-stone-500 dark:text-stone-400">Hospital management system for Kenyan facilities</p>
            <h1 className="font-display mt-4 text-[2.6rem] leading-[1.05] text-stone-900 sm:text-6xl dark:text-white">
              Your whole facility, on one patient record.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600 dark:text-stone-400">
              AfeySync connects reception, the doctor, the lab, pharmacy, wards and the cashier, so a patient is registered once and every department sees the same visit. M-Pesa, SHA and insurance are part of it, not add-ons.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href={links.getStarted} className="rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200">Register your facility</a>
              <a href={`tel:${CONTACT.phoneTel}`} className="text-sm font-medium text-stone-800 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-800 dark:text-stone-100">or call {CONTACT.phoneDisplay}</a>
            </div>
            <p className="mt-8 max-w-md text-sm leading-relaxed text-stone-500">Runs in the browser on a PC, tablet or phone. Each facility gets its own web address and its own private database.</p>
          </div>
          <ProductPreview />
        </div>
        <div className="border-t border-stone-200 dark:border-stone-800">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
            {[
              [String(featureCount), `features across ${FEATURE_GROUPS.length} areas of the facility`],
              ['4', 'price lists per service: cash, SHA, insurance and foreigner'],
              [String(GUIDE_TOPICS.length), 'step-by-step guides for every role'],
              ['1', 'private database per facility, never shared'],
            ].map(([v, l], i) => (
              <div key={l} className={`py-6 pr-4 ${i % 2 ? 'pl-4 md:pl-6' : ''} ${i > 1 ? 'border-t border-stone-200 md:border-t-0 dark:border-stone-800' : ''} ${i > 0 ? 'md:border-l md:border-stone-200 md:pl-6 md:dark:border-stone-800' : ''}`}>
                <dt className="sr-only">{l}</dt>
                <dd className="font-display text-3xl text-stone-900 tabular-nums dark:text-white">{v}</dd>
                <dd className="mt-1 text-sm leading-snug text-stone-500">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* A patient's visit */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className={eyebrow}>How it fits together</p>
          <h2 className={h2}>One visit, followed from the front desk to the claim</h2>
          <p className="mt-4 text-stone-600 dark:text-stone-400">Nobody re-types the patient&rsquo;s details, and nothing is lost between rooms. This is what a normal outpatient visit looks like in AfeySync.</p>
        </div>
        <ol className="mt-12 grid gap-x-8 border-t border-stone-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-800">
          {JOURNEY.map((s, i) => (
            <li key={s.t} className="border-b border-stone-200 py-6 dark:border-stone-800">
              <p className="text-xs font-medium text-stone-400 tabular-nums">{String(i + 1).padStart(2, '0')}</p>
              <h3 className="mt-2 font-semibold text-stone-900 dark:text-white">{s.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{s.d}</p>
            </li>
          ))}
          <li className="border-b border-stone-200 py-6 dark:border-stone-800">
            <p className="text-xs font-medium text-stone-400">Also</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">Admissions, ward rounds, maternity, dental and mortuary use the same record. <Link href="/features" className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 dark:text-white">See every feature</Link>.</p>
          </li>
        </ol>
      </section>

      {/* Modules */}
      <section className="border-y border-stone-200 bg-[#f7f6f2] py-20 dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className={eyebrow}>What&rsquo;s included</p>
              <h2 className={h2}>Every department, in the same system</h2>
            </div>
            <Link href="/features" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-900 hover:underline dark:text-white">Full feature list <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <div className="mt-12 divide-y divide-stone-300/70 border-y border-stone-300/70 dark:divide-stone-700 dark:border-stone-700">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.id} className="grid gap-4 py-7 md:grid-cols-[1fr_1.6fr] md:gap-10">
                <div>
                  <h3 className="font-display text-xl text-stone-900 dark:text-white"><Link href={`/features#${g.id}`} className="hover:underline hover:decoration-stone-400 hover:underline-offset-4">{g.title}</Link></h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{g.summary}</p>
                </div>
                <ul className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  {g.items.map((it) => (
                    <li key={it.title}>
                      <span className="font-medium text-stone-900 dark:text-stone-100">{it.title}</span>
                      <span className="mt-0.5 block leading-relaxed text-stone-500 dark:text-stone-400">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Payments and claims */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div>
            <p className={eyebrow}>Money in</p>
            <h2 className={h2}>Payments and claims, done the careful way</h2>
            <p className="mt-4 text-stone-600 dark:text-stone-400">Prices come from your own price lists on the server. The screen at the cashier can&rsquo;t change what a patient owes, and nothing is marked paid until the money is confirmed.</p>
          </div>
          <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {[
              { t: 'M-Pesa', d: 'The cashier sends a payment prompt to the patient\u2019s phone. The receipt is only issued after Safaricom confirms the payment back to AfeySync.' },
              { t: 'SHA', d: 'Eligibility checks, patient consent by OTP or fingerprint, visit authorisation and claims through the official DHA/SHA integration, once your facility has been onboarded by SHA.' },
              { t: 'Insurance & corporates', d: 'Schemes with their own prices, fixed or percentage copay, capitation, pre-authorisations and remittances matched against invoices.' },
            ].map((c) => (
              <div key={c.t} className="border-t-2 border-stone-900 pt-4 dark:border-white">
                <h3 className="font-semibold text-stone-900 dark:text-white">{c.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Blog */}
      <section className="border-t border-stone-200 py-20 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className={eyebrow}>From the blog</p>
              <h2 className={h2}>Notes for people who run facilities</h2>
            </div>
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-900 hover:underline dark:text-white">All articles <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          {lead ? (
            <div className={`mt-12 grid gap-12 ${others.length ? 'lg:grid-cols-[1.5fr_1fr]' : ''}`}>
              <PostCard post={lead} featured={!others.length} />
              {others.length > 0 && <div className="divide-y divide-stone-200 dark:divide-stone-800">{others.map((p) => <PostRow key={p.id} post={p} />)}</div>}
            </div>
          ) : (
            <div className="mt-12 rounded-lg border border-stone-200 bg-[#f7f6f2] p-8 dark:border-stone-800 dark:bg-stone-900">
              <p className="font-display text-xl text-stone-900 dark:text-white">New articles are on the way.</p>
              <p className="mt-2 max-w-xl text-sm text-stone-600 dark:text-stone-400">We write about SHA claims, running a pharmacy store, getting paid by insurers and setting up a facility. <Link href="/blog" className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 dark:text-white">Visit the blog</Link>.</p>
            </div>
          )}
        </div>
      </section>

      {/* Security */}
      <section className="bg-[#10201c] py-20 text-stone-300">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:px-8">
          <div>
            <p className="text-sm font-medium text-emerald-300">Security</p>
            <h2 className="font-display mt-3 text-3xl leading-tight text-white sm:text-[2.5rem]">Patient records are not something to be casual about</h2>
            <p className="mt-4 text-stone-400">Staff see only what their role allows, and every change is written to an audit trail.</p>
            <Link href="/security" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-white hover:underline">How we protect your data <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="border-t border-white/15 py-5">
                <dt className="font-medium text-white">{h.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-stone-400">{h.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Getting started */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-2">
          <div>
            <p className={eyebrow}>Getting started</p>
            <h2 className={h2}>From sign-up to your first patient</h2>
            <ol className="mt-8 space-y-6">
              {[
                { t: 'Register online', d: 'Fill in your facility details, choose your web address and verify your email. About five minutes.' },
                { t: 'Set up your facility', d: 'Add your logo, staff and their roles, price lists and stock. Your drug list can come straight from Excel.' },
                { t: 'Start seeing patients', d: 'Staff sign in securely, with two-step verification if you require it, and every department works from the same record.' },
              ].map((s, i) => (
                <li key={s.t} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="font-display text-xl text-stone-400 tabular-nums">{i + 1}.</span>
                  <div>
                    <h3 className="font-semibold text-stone-900 dark:text-white">{s.t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-stone-200 p-6 sm:p-8 dark:border-stone-800">
            <h3 className="font-display text-xl text-stone-900 dark:text-white">The user guide</h3>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{GUIDE_TOPICS.length} plain-language guides, one for each part of the system. Useful for training new staff.</p>
            <ul className="mt-5 divide-y divide-stone-200 border-t border-stone-200 text-sm dark:divide-stone-800 dark:border-stone-800">
              {guideLinks.map((t) => (
                <li key={t.slug}><Link href={`/user-guide/${t.slug}`} className="flex items-center justify-between py-3 text-stone-700 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">{t.title}<ArrowRight className="h-4 w-4 text-stone-400" aria-hidden /></Link></li>
              ))}
            </ul>
            <Link href="/user-guide" className="mt-5 inline-flex text-sm font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 dark:text-white">Browse all guides</Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-stone-200 py-20 dark:border-stone-800">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.8fr] lg:px-8">
          <div>
            <h2 className="font-display text-3xl leading-tight text-stone-900 sm:text-[2.5rem] dark:text-white">Questions we&rsquo;re often asked</h2>
            <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">Something else? Call <a href={`tel:${CONTACT.phoneTel}`} className="font-medium text-stone-900 dark:text-white">{CONTACT.phoneDisplay}</a>, <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer" className="font-medium text-stone-900 dark:text-white">WhatsApp us</a> or email <a href={`mailto:${CONTACT.email}`} className="font-medium text-stone-900 dark:text-white">{CONTACT.email}</a>.</p>
          </div>
          <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 font-medium text-stone-900 dark:text-white">
                  {f.q}
                  <span className="mt-0.5 text-lg leading-none text-stone-400 group-open:hidden" aria-hidden>+</span>
                  <span className="mt-0.5 hidden text-lg leading-none text-stone-400 group-open:inline" aria-hidden>&minus;</span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600 dark:text-stone-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
