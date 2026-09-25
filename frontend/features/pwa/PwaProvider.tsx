'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface Pwa {
  /** The browser offered a native install prompt (Chrome, Edge, Android). */
  canInstall: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** iPhone/iPad Safari: installation is manual (Share → Add to Home Screen). */
  iosManual: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  updateReady: boolean;
  applyUpdate: () => void;
}
const Ctx = createContext<Pwa>({ canInstall: false, installed: false, iosManual: false, install: async () => 'unavailable', updateReady: false, applyUpdate: () => undefined });
export const usePwa = () => useContext(Ctx);

export function PwaProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosManual, setIosManual] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const updating = useRef(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIosManual(ios && !standalone && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua));

    const onPrompt = (e: Event) => {
      e.preventDefault(); // show our own install button instead of the mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Development (next dev): no offline worker, and remove any left over, so edits always load fresh.
    if (process.env.NODE_ENV !== 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => undefined);
      if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => undefined);
    }
    // Service workers need a secure context (HTTPS, or localhost).
    else if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(sw);
          });
        });
      }).catch(() => undefined);
      // Reload only when the user chose to apply an update, never on the first install (it would
      // interrupt whatever they are typing).
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!updating.current) return;
        updating.current = false;
        window.location.reload();
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }, [deferred]);
  const applyUpdate = useCallback(() => {
    updating.current = true;
    waiting?.postMessage('SKIP_WAITING');
  }, [waiting]);

  return (
    <Ctx.Provider value={{ canInstall: !!deferred && !installed, installed, iosManual, install, updateReady: !!waiting, applyUpdate }}>
      {children}
      {waiting && (
        <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl sm:inset-x-auto sm:right-4">
          <span className="flex-1">A new version of AfeySync is available.</span>
          <button type="button" onClick={applyUpdate} className="rounded-lg bg-emerald-500 px-3 py-1.5 font-semibold text-slate-900">Refresh</button>
        </div>
      )}
    </Ctx.Provider>
  );
}
