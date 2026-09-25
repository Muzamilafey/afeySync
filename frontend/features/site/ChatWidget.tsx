'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Phone, Send, X } from 'lucide-react';
import { WhatsAppIcon } from './WhatsAppIcon';

const QUICK = ['I’d like a demo', 'How much does it cost?', 'I need help with my account', 'Tell me about SHA claims'];
const SEEN_KEY = 'afs-chat-teaser-seen';

/** The “Chat with us” button on the website. Messages continue on WhatsApp with the AfeySync team. */
export function ChatWidget({ whatsapp, phoneTel, phoneDisplay }: { whatsapp: string; phoneTel: string; phoneDisplay: string }) {
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A small "We're online" bubble appears once per visit, a few seconds after the page opens.
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* storage blocked */ }
    if (seen) return;
    const t = setTimeout(() => setTeaser(true), 4000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    setTeaser(false);
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const start = (message: string) => {
    const body = message.trim() || 'Hello AfeySync, I’d like to know more.';
    window.open(`${whatsapp}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  };
  const submit = (e: FormEvent) => { e.preventDefault(); start(text); };
  const dismissTeaser = () => { setTeaser(false); try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ } };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6 print:hidden">
      {open && (
        <div role="dialog" aria-label="Chat with AfeySync" className="w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 shadow-slate-900/20 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
          <div className="flex items-center gap-3 bg-[#075E54] px-5 py-4 text-white">
            <span className="relative grid h-11 w-11 place-items-center rounded-full bg-white/15 text-lg font-bold">A<span className="absolute right-0 bottom-0 h-3 w-3 rounded-full bg-[#25D366] ring-2 ring-[#075E54]" /></span>
            <div className="flex-1">
              <p className="font-semibold">AfeySync team</p>
              <p className="flex items-center gap-1.5 text-xs text-emerald-100"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#25D366]" /></span>We’re online</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Close chat"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-3 bg-[#efeae2] px-4 py-5 dark:bg-slate-950">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100">
              Hello 👋 Welcome to AfeySync. How can we help your facility today?
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => start(q)} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#075E54] shadow-sm ring-1 ring-[#25D366]/40 hover:bg-emerald-50 dark:bg-slate-800 dark:text-emerald-300">{q}</button>)}
            </div>
          </div>
          <form onSubmit={submit} className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
            <label className="sr-only" htmlFor="afs-chat-text">Your message</label>
            <textarea id="afs-chat-text" ref={inputRef} rows={1} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(text); } }} placeholder="Type your message…" className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#25D366]/50 dark:bg-slate-800 dark:text-white" />
            <button type="submit" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5a]" aria-label="Start chat on WhatsApp"><Send className="h-4 w-4" /></button>
          </form>
          <div className="flex items-center justify-between gap-2 px-4 pb-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><WhatsAppIcon className="h-3.5 w-3.5 text-[#25D366]" /> Chat continues on WhatsApp</span>
            <a href={`tel:${phoneTel}`} className="flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300"><Phone className="h-3.5 w-3.5" /> {phoneDisplay}</a>
          </div>
        </div>
      )}

      {teaser && !open && (
        <div className="relative max-w-[16rem] rounded-2xl bg-white px-4 py-3 text-sm shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
          <button type="button" onClick={dismissTeaser} className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-slate-700 text-white" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setOpen(true)} className="text-left">
            <span className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white"><span className="h-2 w-2 rounded-full bg-[#25D366]" /> We’re online</span>
            <span className="mt-0.5 block text-slate-600 dark:text-slate-400">Chat with us now. We’re happy to help.</span>
          </button>
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Close chat' : 'Chat with us on WhatsApp'} className="group flex items-center gap-2 rounded-full bg-[#25D366] py-3 pr-5 pl-3 text-white shadow-lg shadow-[#25D366]/40 transition hover:bg-[#1ebe5a] hover:shadow-xl">
        <span className="relative grid h-9 w-9 place-items-center">
          {open ? <X className="h-6 w-6" /> : <WhatsAppIcon className="h-7 w-7" />}
          {!open && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-white ring-2 ring-[#25D366]"><span className="absolute inset-0.5 rounded-full bg-[#25D366]" /></span>}
        </span>
        <span className="hidden text-sm font-semibold sm:inline">{open ? 'Close' : 'Chat with us'}</span>
      </button>
    </div>
  );
}
