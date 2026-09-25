import { HeartHandshake, MapPin, Target } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata('About Us', 'AfeySync builds hospital management software for Kenyan healthcare facilities, so that care teams spend less time on paperwork and more time with patients.', '/about');

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About AfeySync" title="Software made for Kenyan healthcare" intro="We build AfeySync so that clinics and hospitals can spend less time on paperwork and follow-up calls, and more time caring for patients." />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Target, t: 'Our mission', d: 'Give every Kenyan facility, from a small clinic to a referral hospital, a modern and affordable system to run its work.' },
            { icon: MapPin, t: 'Built for local realities', d: 'SHA and private insurance, M-Pesa, KMPDC levels, county structures and ordinary internet connections are part of the design from the start.' },
            { icon: HeartHandshake, t: 'We work with you', d: 'We help you set up, import your data and train your team, and we listen to what your staff need next.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
              <Icon className="h-6 w-6 text-brand-600 dark:text-emerald-300" aria-hidden />
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 max-w-3xl space-y-4 text-slate-600 dark:text-slate-400">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">What we believe</h2>
          <p>Patient information belongs to the patient and the facility caring for them, so every facility gets its own private database and web address.</p>
          <p>Money must be counted correctly. Every bill is priced by the system from your own price list, and a payment is only recorded once it is actually received.</p>
          <p>Integrations must be honest. AfeySync connects to SHA, M-Pesa and insurers only through their official channels, using the credentials issued to your facility.</p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
