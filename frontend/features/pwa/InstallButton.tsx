'use client';

import { useState } from 'react';
import { Download, Plus, Share, SquarePlus } from 'lucide-react';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { usePwa } from './PwaProvider';

/**
 * "Install AfeySync" — a native install prompt where the browser supports it, or step-by-step
 * instructions on iPhone/iPad. Hidden when already installed or not installable.
 */
export function InstallButton({ variant = 'button', label = 'Install app', className }: { variant?: 'button' | 'link' | 'card'; label?: string; className?: string }) {
  const { canInstall, installed, iosManual, install } = usePwa();
  const [ios, setIos] = useState(false);
  if (installed || (!canInstall && !iosManual)) return null;
  const onClick = () => (canInstall ? void install() : setIos(true));
  return (
    <>
      {variant === 'card' ? (
        <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left transition hover:border-brand-500', className)}>
          <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Install AfeySync</span><span className="muted block text-xs">Open it from your home screen or desktop, full screen</span></span>
          <Download className="h-4 w-4 text-brand-600" />
        </button>
      ) : variant === 'link' ? (
        <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline', className)}><Download className="h-4 w-4" />{label}</button>
      ) : (
        <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-2)]', className)} title="Install AfeySync as an app">
          <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span>
        </button>
      )}
      <Modal open={ios} onClose={() => setIos(false)} title="Install AfeySync on your iPhone or iPad">
        <ol className="space-y-4 text-sm">
          <li className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700">1</span><span>Tap the <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Share</strong> button in Safari&apos;s toolbar.</span></li>
          <li className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700">2</span><span>Scroll down and tap <SquarePlus className="inline h-4 w-4 align-text-bottom" /> <strong>Add to Home Screen</strong>.</span></li>
          <li className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700">3</span><span>Tap <strong>Add</strong>. AfeySync opens full screen from its <Plus className="inline h-4 w-4 align-text-bottom" /> home-screen icon.</span></li>
        </ol>
      </Modal>
    </>
  );
}
