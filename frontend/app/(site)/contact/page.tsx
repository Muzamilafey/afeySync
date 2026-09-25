import { Mail, Phone } from 'lucide-react';
import { WhatsAppIcon } from '@/features/site/WhatsAppIcon';
import { PageHero } from '@/features/site/SiteShell';
import { ContactForm } from '@/features/site/ContactForm';
import { CONTACT, pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata('Contact Us', `Talk to AfeySync about a demo, pricing or support. Call ${CONTACT.phoneDisplay} or email ${CONTACT.email}.`, '/contact');

export default function ContactPage() {
  const channels = [
    { icon: Phone, label: 'Call us', value: CONTACT.phoneDisplay, href: `tel:${CONTACT.phoneTel}`, note: 'Talk to our team directly' },
    { icon: WhatsAppIcon, label: 'WhatsApp', value: CONTACT.phoneDisplay, href: CONTACT.whatsapp, note: 'Chat with us on WhatsApp', external: true, tone: 'bg-[#25D366]' },
    { icon: Mail, label: 'Email', value: CONTACT.email, href: `mailto:${CONTACT.email}`, note: 'We reply as soon as we can' },
  ];
  return (
    <>
      <PageHero eyebrow="Contact" title="Let’s talk about your facility" intro="Want a demo, help choosing a plan, or support with your account? Reach us any way you like." />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-8">
        <div className="space-y-4">
          {channels.map(({ icon: Icon, label, value, href, note, external, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; href: string; note: string; external?: boolean; tone?: string }) => (
            <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white ${tone ?? 'bg-brand-600'}`}><Icon className="h-6 w-6" aria-hidden /></span>
              <span>
                <span className="block text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
                <span className="block text-lg font-semibold text-slate-900 dark:text-white">{value}</span>
                <span className="block text-sm text-slate-500">{note}</span>
              </span>
            </a>
          ))}
          <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            <p className="font-semibold text-slate-900 dark:text-white">Already using AfeySync?</p>
            <p className="mt-1">For help with your facility’s account, include your facility’s web address (for example <em>yourfacility.afey.co.ke</em>) so we can find you quickly. Never send passwords or patient details by email.</p>
          </div>
        </div>
        <div className="relative"><ContactForm phone={CONTACT.phoneDisplay} email={CONTACT.email} /></div>
      </section>
    </>
  );
}
