'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { api, ApiError } from '@/services/api';

const TOPICS = [
  ['demo', 'Request a demo'],
  ['pricing', 'Pricing'],
  ['support', 'Support'],
  ['sha', 'SHA / insurance'],
  ['partnership', 'Partnership'],
  ['other', 'Something else'],
] as const;

const input = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export function ContactForm({ phone, email }: { phone: string; email: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(['name', 'email', 'phone', 'facility', 'topic', 'message', 'website'].map((k) => [k, String(f.get(k) ?? '')]));
    setBusy(true);
    setError(null);
    try {
      await api('/contact', { method: 'POST', body, auth: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : `We could not send your message. Please call ${phone} or email ${email}.`);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-brand-200 bg-brand-50 p-10 text-center dark:border-slate-700 dark:bg-slate-900">
        <CheckCircle2 className="h-12 w-12 text-brand-600" aria-hidden />
        <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Thank you, message received</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-400">We will get back to you by email or phone. If it is urgent, call us on {phone}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900" noValidate={false}>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">Send us a message</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Your name *<input name="name" required minLength={2} maxLength={120} autoComplete="name" className={`${input} mt-1.5`} /></label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email *<input name="email" type="email" required maxLength={160} autoComplete="email" className={`${input} mt-1.5`} /></label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Phone<input name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="07xx xxx xxx" className={`${input} mt-1.5`} /></label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Facility<input name="facility" maxLength={160} autoComplete="organization" className={`${input} mt-1.5`} /></label>
      </div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">How can we help?
        <select name="topic" defaultValue="demo" className={`${input} mt-1.5`}>
          {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Message *<textarea name="message" required minLength={10} maxLength={3000} rows={5} className={`${input} mt-1.5`} placeholder="Tell us about your facility and what you need." /></label>
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div className="absolute -left-[9999px]" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700 disabled:opacity-60 sm:w-auto">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Send message
      </button>
    </form>
  );
}
