import { Building2, Eye, FileLock2, KeyRound, Lock, ServerCog, ShieldCheck, UserCheck } from 'lucide-react';
import { CtaBand, PageHero } from '@/features/site/SiteShell';
import { pageMetadata } from '@/features/site/site';

export const metadata = pageMetadata('Security & Data Protection', 'How AfeySync protects patient data: a separate database per facility, secure central sign-in, two-step verification, role-based access, audit trails and encrypted connections.', '/security');

const POINTS = [
  { icon: Building2, t: 'A separate database for every facility', d: 'Each facility’s records live in their own database, reached only through its own web address. Every request is checked against the facility it belongs to.' },
  { icon: KeyRound, t: 'One secure sign-in page', d: 'Staff sign in on accounts.afey.co.ke and are handed to their facility with a one-time link that expires within a minute and only works in the same browser.' },
  { icon: ShieldCheck, t: 'Two-step verification', d: 'Passkeys, authenticator apps, email or SMS codes. Administrators can require it for everyone. Codes are never stored in plain form.' },
  { icon: UserCheck, t: 'Role-based access', d: 'Every screen and every action is checked on the server against the user’s role and branch, never only in the browser.' },
  { icon: FileLock2, t: 'Records that cannot be quietly changed', d: 'Finalised clinical records are locked. Later corrections are recorded as amendments, so the original stays visible.' },
  { icon: Eye, t: 'Full audit trail', d: 'Sign-ins and changes to records are logged with who did it and when.' },
  { icon: Lock, t: 'Encrypted everywhere', d: 'All traffic uses HTTPS. Integration credentials, such as M-Pesa and insurance keys, are encrypted at rest.' },
  { icon: ServerCog, t: 'Backups and monitoring', d: 'Regular backups and system health monitoring, so your facility keeps working.' },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero eyebrow="Security" title="Patient data deserves serious protection" intro="AfeySync is designed so that each facility’s data stays private, every action is accountable, and only the right people see the right records." />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-2">
          {POINTS.map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">{t}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{d}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 rounded-3xl bg-slate-50 p-8 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Kenya Data Protection Act, 2019</h2>
          <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-400">Your facility remains the data controller for its patients’ information. AfeySync processes that information only to provide the service, and gives you the controls you need to meet your obligations: access control, audit trails and data exports.</p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
