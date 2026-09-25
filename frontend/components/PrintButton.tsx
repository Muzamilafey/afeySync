'use client';

import { useLetterhead } from '@/features/branding/Letterhead';

/** Waits for the letterhead (logo) to load so it is never missing from the printout. */
export function PrintButton() {
  const letterhead = useLetterhead();
  const ready = !letterhead.isLoading;
  return (
    <button onClick={() => window.print()} disabled={!ready} className="mb-4 rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 print:hidden">
      {ready ? 'Print' : 'Loading letterhead…'}
    </button>
  );
}
