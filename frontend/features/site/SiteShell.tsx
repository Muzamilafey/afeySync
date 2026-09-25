import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { CONTACT, NAV, accountsLinks } from './site';
import { Logo, SiteHeader } from './SiteHeader';

/** Header, footer and page frame shared by every page of the public website. */
export async function SiteShell({ children }: { children: ReactNode }) {
  const links = await accountsLinks();
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-700 dark:bg-slate-950 dark:text-slate-300">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <SiteHeader nav={NAV} signIn={links.signIn} getStarted={links.getStarted} />
      <main id="main" className="flex-1">{children}</main>
      <footer className="bg-[#062f29] text-emerald-50/80">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr] lg:px-8">
          <div>
            <Logo light />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-emerald-50/70">A complete hospital management system for Kenyan hospitals, clinics, maternity homes and medical centres, from the front desk to SHA claims.</p>
            <a href={links.getStarted} className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#062f29] hover:bg-emerald-50">Register your facility</a>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link className="hover:text-white" href="/features">Features</Link></li>
              <li><Link className="hover:text-white" href="/pricing">Pricing</Link></li>
              <li><Link className="hover:text-white" href="/security">Security</Link></li>
              <li><a className="hover:text-white" href={links.signIn}>Sign in</a></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Help</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link className="hover:text-white" href="/user-guide">User guide</Link></li>
              <li><Link className="hover:text-white" href="/contact">Contact us</Link></li>
              <li><Link className="hover:text-white" href="/about">About AfeySync</Link></li>
              <li><Link className="hover:text-white" href="/privacy">Privacy</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Talk to us</p>
            <ul className="mt-4 space-y-3 text-sm">
              <li><a className="flex items-center gap-2.5 hover:text-white" href={`tel:${CONTACT.phoneTel}`}><Phone className="h-4 w-4 text-emerald-300" aria-hidden />{CONTACT.phoneDisplay}</a></li>
              <li><a className="flex items-center gap-2.5 hover:text-white" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 text-emerald-300" aria-hidden />WhatsApp us</a></li>
              <li><a className="flex items-center gap-2.5 hover:text-white" href={`mailto:${CONTACT.email}`}><Mail className="h-4 w-4 text-emerald-300" aria-hidden />{CONTACT.email}</a></li>
              <li className="flex items-center gap-2.5"><MapPin className="h-4 w-4 text-emerald-300" aria-hidden />{CONTACT.location}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-emerald-50/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>© {year} AfeySync. All rights reserved.</p>
            <p>Made in Kenya for Kenyan healthcare.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A page's opening band: eyebrow, title and a short introduction. */
export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-b from-brand-50/70 to-white dark:border-slate-900 dark:from-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-900/30" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-14 sm:px-6 sm:pt-20 lg:px-8">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-emerald-300">{eyebrow}</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">{intro}</p>
        {children}
      </div>
    </section>
  );
}

/** The closing call to action used at the bottom of most pages. */
export async function CtaBand({ title = 'Ready to run your facility on AfeySync?', text = 'Register in about five minutes. Your facility gets its own private database and web address.' }: { title?: string; text?: string }) {
  const links = await accountsLinks();
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#083f36] via-brand-700 to-brand-600 px-6 py-14 text-center shadow-xl sm:px-12">
        <div className="pointer-events-none absolute -top-20 -left-16 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl" aria-hidden />
        <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="relative mx-auto mt-4 max-w-2xl text-emerald-50/85">{text}</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <a href={links.getStarted} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-[#083f36] shadow-lg hover:bg-emerald-50">Get started</a>
          <Link href="/contact" className="rounded-xl px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">Talk to our team</Link>
        </div>
      </div>
    </section>
  );
}
