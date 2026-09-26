import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Lightbulb, MapPin, Users } from 'lucide-react';
import { CtaBand } from '@/features/site/SiteShell';
import { CONTACT, pageMetadata, siteUrl } from '@/features/site/site';
import { GUIDE_GROUPS, GUIDE_TOPICS, guideTopic } from '@/features/site/guide';
import { headingId } from '@/features/site/Markdown';
import { WhatsAppIcon } from '@/features/site/WhatsAppIcon';
import { cn } from '@/lib/utils';

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return GUIDE_TOPICS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const t = guideTopic((await params).slug);
  if (!t) return { title: { absolute: 'User guide | AfeySync' } };
  return pageMetadata(`${t.title}: User Guide`, `${t.summary} Step-by-step instructions for AfeySync.`, `/user-guide/${t.slug}`);
}

export default async function GuideTopicPage({ params }: { params: Params }) {
  const { slug } = await params;
  const t = guideTopic(slug);
  if (!t) notFound();
  const index = GUIDE_TOPICS.indexOf(t);
  const prev = GUIDE_TOPICS[index - 1];
  const next = GUIDE_TOPICS[index + 1];
  const Icon = t.icon;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: t.title,
    description: t.summary,
    url: `${siteUrl()}/user-guide/${t.slug}`,
    step: t.sections.flatMap((s) => s.steps).map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: s.text })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        {/* Topic navigation */}
        <aside className="order-2 lg:order-1">
          <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2">
            <Link href="/user-guide" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300"><ArrowLeft className="h-4 w-4" aria-hidden /> All topics</Link>
            <nav aria-label="User guide topics" className="mt-5 space-y-5">
              {GUIDE_GROUPS.map((g) => (
                <div key={g}>
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{g}</p>
                  <ul className="mt-2 space-y-0.5">
                    {GUIDE_TOPICS.filter((x) => x.group === g).map((x) => (
                      <li key={x.slug}>
                        <Link href={`/user-guide/${x.slug}`} aria-current={x.slug === t.slug ? 'page' : undefined} className={cn('block rounded-lg px-3 py-1.5 text-sm', x.slug === t.slug ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white')}>{x.title}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <article className="order-1 min-w-0 lg:order-2">
          <p className="text-sm font-semibold text-brand-700 dark:text-emerald-300">{t.group}</p>
          <div className="mt-2 flex items-start gap-4">
            <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white sm:grid"><Icon className="h-6 w-6" aria-hidden /></span>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">{t.title}</h1>
              <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">{t.summary}</p>
            </div>
          </div>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900"><Users className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden /><div><dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Who uses it</dt><dd className="text-sm text-slate-800 dark:text-slate-200">{t.who}</dd></div></div>
            <div className="flex gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden /><div><dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Where to find it</dt><dd className="text-sm text-slate-800 dark:text-slate-200">{t.where}</dd></div></div>
          </dl>

          {t.sections.length > 1 && (
            <nav aria-label="On this page" className="mt-8 rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">On this page</p>
              <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {t.sections.map((s, i) => <li key={s.title}><a href={`#${headingId(s.title)}`} className="text-sm font-medium text-brand-700 hover:underline dark:text-emerald-300">{i + 1}. {s.title}</a></li>)}
              </ol>
            </nav>
          )}

          <div className="mt-10 space-y-14">
            {t.sections.map((s, si) => (
              <section key={s.title} id={headingId(s.title)} className="scroll-mt-24">
                <h2 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-sm text-white dark:bg-white dark:text-slate-900">{si + 1}</span>{s.title}</h2>
                {s.intro && <p className="mt-3 text-slate-600 dark:text-slate-400">{s.intro}</p>}
                <ol className="relative mt-6 space-y-4 border-l-2 border-brand-100 pl-8 dark:border-slate-800">
                  {s.steps.map((step, i) => (
                    <li key={step.title} className="relative">
                      <span className="absolute top-0.5 -left-[2.65rem] grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white ring-4 ring-white dark:ring-slate-950">{i + 1}</span>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                      <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">{step.text}</p>
                    </li>
                  ))}
                </ol>
                {s.tips && s.tips.length > 0 && (
                  <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300"><Lightbulb className="h-4 w-4" aria-hidden /> Good to know</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">{s.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
                  </div>
                )}
              </section>
            ))}
          </div>

          <div className="mt-14 flex flex-col gap-3 rounded-2xl bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-900">
            <p className="text-sm text-slate-700 dark:text-slate-300">Need help with this? Our team can show you on a call.</p>
            <a href={`${CONTACT.whatsapp}?text=${encodeURIComponent(`Hello AfeySync, I need help with: ${t.title}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe5a]"><WhatsAppIcon className="h-4 w-4" /> Ask on WhatsApp</a>
          </div>

          <nav aria-label="Previous and next topics" className="mt-10 grid gap-3 sm:grid-cols-2">
            {prev ? <Link href={`/user-guide/${prev.slug}`} className="rounded-2xl border border-slate-200 p-5 hover:border-brand-300 dark:border-slate-800"><span className="flex items-center gap-1 text-xs text-slate-500"><ArrowLeft className="h-3.5 w-3.5" /> Previous</span><span className="mt-1 block font-semibold text-slate-900 dark:text-white">{prev.title}</span></Link> : <span />}
            {next && <Link href={`/user-guide/${next.slug}`} className="rounded-2xl border border-slate-200 p-5 text-right hover:border-brand-300 dark:border-slate-800"><span className="flex items-center justify-end gap-1 text-xs text-slate-500">Next <ArrowRight className="h-3.5 w-3.5" /></span><span className="mt-1 block font-semibold text-slate-900 dark:text-white">{next.title}</span></Link>}
          </nav>
        </article>
      </div>
      <CtaBand title="Ready to try it with your team?" />
    </>
  );
}
