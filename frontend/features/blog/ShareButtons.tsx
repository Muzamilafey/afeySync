'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { WhatsAppIcon } from '@/features/site/WhatsAppIcon';

export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const pill = 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 ring-slate-200 transition hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Share</span>
      <a className={`${pill} text-[#128C7E]`} href={`https://wa.me/?text=${t}%20${u}`} target="_blank" rel="noopener noreferrer"><WhatsAppIcon className="h-4 w-4" /> WhatsApp</a>
      <a className={`${pill} text-slate-700 dark:text-slate-200`} href={`https://www.facebook.com/sharer/sharer.php?u=${u}`} target="_blank" rel="noopener noreferrer">Facebook</a>
      <a className={`${pill} text-slate-700 dark:text-slate-200`} href={`https://www.linkedin.com/sharing/share-offsite/?url=${u}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
      <a className={`${pill} text-slate-700 dark:text-slate-200`} href={`https://twitter.com/intent/tweet?url=${u}&text=${t}`} target="_blank" rel="noopener noreferrer">X</a>
      <button type="button" className={`${pill} text-slate-700 dark:text-slate-200`} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } }}>
        {copied ? <Check className="h-3.5 w-3.5 text-brand-600" /> : <Link2 className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
