import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mail, MapPin, Phone } from 'lucide-react';
import { WhatsAppIcon } from './WhatsAppIcon';
import { ChatWidget } from './ChatWidget';
import { CONTACT, NAV, accountsLinks } from './site';
import { Logo, SiteHeader } from './SiteHeader';

/** Header, footer and page frame shared by every page of the public website. */
export async function SiteShell({ children }: { children: ReactNode }) {
  const links = await accountsLinks();
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-screen flex-col bg-white text-stone-700 dark:bg-stone-950 dark:text-stone-300">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <SiteHeader nav={NAV} signIn={links.signIn} getStarted={links.getStarted} />
      <main id="main" className="flex-1">{children}</main>
      <footer className="bg-[#10201c] text-stone-300">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr] lg:px-8">
          <div>
            <Logo light />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-stone-400">A complete hospital management system for Kenyan hospitals, clinics, maternity homes and medical centres, from the front desk to SHA claims.</p>
            <a href={links.getStarted} className="mt-6 inline-flex rounded-md bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-200">Register your facility</a>
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
              <li><Link className="hover:text-white" href="/blog">Blog</Link></li>
              <li><Link className="hover:text-white" href="/contact">Contact us</Link></li>
              <li><Link className="hover:text-white" href="/about">About AfeySync</Link></li>
              <li><Link className="hover:text-white" href="/privacy">Privacy</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Talk to us</p>
            <ul className="mt-4 space-y-3 text-sm">
              <li><a className="flex items-center gap-2.5 hover:text-white" href={`tel:${CONTACT.phoneTel}`}><Phone className="h-4 w-4 text-stone-500" aria-hidden />{CONTACT.phoneDisplay}</a></li>
              <li><a className="flex items-center gap-2.5 hover:text-white" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer"><WhatsAppIcon className="h-4 w-4 text-[#25D366]" />WhatsApp us</a></li>
              <li><a className="flex items-center gap-2.5 hover:text-white" href={`mailto:${CONTACT.email}`}><Mail className="h-4 w-4 text-stone-500" aria-hidden />{CONTACT.email}</a></li>
              <li className="flex items-center gap-2.5"><MapPin className="h-4 w-4 text-stone-500" aria-hidden />{CONTACT.location}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>© {year} AfeySync. All rights reserved.</p>
            <p>Made in Kenya for Kenyan healthcare.</p>
          </div>
        </div>
      </footer>
      <ChatWidget whatsapp={CONTACT.whatsapp} phoneTel={CONTACT.phoneTel} phoneDisplay={CONTACT.phoneDisplay} />
    </div>
  );
}

/** A page's opening band: eyebrow, title and a short introduction. */
export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-stone-200 bg-[#f7f6f2] dark:border-stone-800 dark:bg-stone-900">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-12 sm:px-6 sm:pt-20 sm:pb-16 lg:px-8">
        <p className="text-sm font-medium text-brand-700 dark:text-emerald-300">{eyebrow}</p>
        <h1 className="font-display mt-3 max-w-3xl text-4xl leading-[1.1] text-stone-900 sm:text-5xl dark:text-white">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600 dark:text-stone-400">{intro}</p>
        {children}
      </div>
    </section>
  );
}

/** The closing call to action used at the bottom of most pages. */
export async function CtaBand({ title = 'Ready to run your facility on AfeySync?', text = 'Register in about five minutes. Your facility gets its own private database and web address.' }: { title?: string; text?: string }) {
  const links = await accountsLinks();
  return (
    <section className="border-t border-stone-200 bg-[#f7f6f2] dark:border-stone-800 dark:bg-stone-900">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr] md:items-end lg:px-8">
        <div>
          <h2 className="font-display text-3xl leading-tight text-stone-900 sm:text-4xl dark:text-white">{title}</h2>
          <p className="mt-4 max-w-xl text-stone-600 dark:text-stone-400">{text}</p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          <a href={links.getStarted} className="rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200">Register your facility</a>
          <Link href="/contact" className="rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800 hover:border-stone-400 dark:border-stone-700 dark:bg-transparent dark:text-stone-100">Talk to us first</Link>
        </div>
      </div>
    </section>
  );
}
