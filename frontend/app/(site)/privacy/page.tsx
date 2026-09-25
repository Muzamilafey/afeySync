import { PageHero } from '@/features/site/SiteShell';
import { CONTACT, pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata('Privacy', 'How AfeySync handles personal information on this website and in the AfeySync service.', '/privacy');

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Privacy" title="How we handle your information" intro="A plain-language summary of what we collect and why." />
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-16 text-slate-600 sm:px-6 dark:text-slate-400">
        <section>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">This website</h2>
          <p className="mt-2">When you register a facility or send us a message, we collect the details you enter (such as your name, email, phone number and facility details) so we can reply, set up your facility and support you. We do not sell this information.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Patient information in AfeySync</h2>
          <p className="mt-2">Each facility is the data controller for its patients’ information and decides who can see it. AfeySync processes that information only to provide the service to the facility. Each facility’s data is stored in its own database and is never shared with another facility.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Security</h2>
          <p className="mt-2">We use encrypted connections, two-step verification, role-based access and audit trails to protect information. See our security page for details.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Your rights</h2>
          <p className="mt-2">Under the Kenya Data Protection Act, 2019 you can ask to see, correct or delete personal information we hold about you. Patients should contact the facility that treated them. For anything else, email <a className="font-semibold text-brand-700 dark:text-emerald-300" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or call {CONTACT.phoneDisplay}.</p>
        </section>
      </article>
    </>
  );
}
