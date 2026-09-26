'use client';

import { useMemo } from 'react';
import { BookOpen, Mail, Phone } from 'lucide-react';
import { WhatsAppIcon } from '@/features/site/WhatsAppIcon';
import { CONTACT } from '@/features/site/contact';
import { GUIDE_GROUPS, GUIDE_TOPICS } from '@/features/site/guide';

/** The public website (afey.co.ke) seen from a facility address such as famzahra.afey.co.ke. */
function useWebsite() {
  return useMemo(() => {
    if (typeof window === 'undefined') return '';
    const { protocol, hostname, port } = window.location;
    const apex = hostname.split('.').slice(1).join('.') || hostname;
    return `${protocol}//${apex}${port ? `:${port}` : ''}`;
  }, []);
}

export default function HelpPage() {
  const site = useWebsite();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:px-9">
        <h1 className="text-3xl font-bold tracking-tight text-brand-700 dark:text-brand-200">Help</h1>
        <p className="muted mt-2">Step-by-step guides for every part of AfeySync, and people ready to help.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <a href={`${site}/user-guide`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 hover:border-brand-600"><BookOpen className="h-6 w-6 text-brand-600" /><span><span className="block font-semibold">User guide</span><span className="muted text-sm">All topics</span></span></a>
          <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 hover:border-brand-600"><WhatsAppIcon className="h-6 w-6 text-[#25D366]" /><span><span className="block font-semibold">WhatsApp us</span><span className="muted text-sm">We are online</span></span></a>
          <a href={`tel:${CONTACT.phoneTel}`} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 hover:border-brand-600"><Phone className="h-6 w-6 text-brand-600" /><span><span className="block font-semibold">Call</span><span className="muted text-sm">{CONTACT.phoneDisplay}</span></span></a>
          <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 hover:border-brand-600"><Mail className="h-6 w-6 text-brand-600" /><span><span className="block font-semibold">Email</span><span className="muted text-sm">{CONTACT.email}</span></span></a>
        </div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:px-9">
        {GUIDE_GROUPS.map((g) => {
          const topics = GUIDE_TOPICS.filter((t) => t.group === g);
          if (!topics.length) return null;
          return (
            <div key={g} className="mb-8 last:mb-0">
              <h2 className="text-lg font-semibold">{g}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {topics.map((t) => (
                  <a key={t.slug} href={`${site}/user-guide/${t.slug}`} target="_blank" rel="noreferrer" className="flex gap-3 rounded-lg border border-[var(--border)] p-4 hover:border-brand-600">
                    <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                    <span><span className="block font-medium">{t.title}</span><span className="muted text-sm">{t.summary}</span></span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
