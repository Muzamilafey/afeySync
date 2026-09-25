'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

export interface Branding { name: string; legalName: string; tagline: string | null; welcomeMessage: string | null; primaryColor: string | null; logoUrl: string | null }
export interface HostContext { kind: 'facility' | 'platform' | 'owner' | 'unknown'; facility?: { name: string; slug: string } | null; branding?: Branding | null; message?: string }

const CACHE_KEY = 'afs.branding';
const readCache = (): Branding | null => {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v ? (JSON.parse(v) as Branding) : null;
  } catch {
    return null;
  }
};

/** What kind of address this is, and the facility's branding when it is a facility address. */
export function useHostContext() {
  return useQuery({
    queryKey: ['host-context'],
    queryFn: async () => (await api<HostContext>('/auth/context', { auth: false })).data,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useBranding(): Branding | null {
  const { data } = useHostContext();
  // The last-seen branding bridges the moment before the context loads; read after mount so server and client render alike.
  const [cached, setCached] = useState<Branding | null>(null);
  useEffect(() => setCached(readCache()), []);
  if (data) return data.kind === 'facility' ? data.branding ?? null : null;
  return cached;
}

const SHADES: Array<[string, string]> = [
  ['50', 'color-mix(in srgb, var(--afs-brand) 8%, white)'],
  ['100', 'color-mix(in srgb, var(--afs-brand) 16%, white)'],
  ['200', 'color-mix(in srgb, var(--afs-brand) 32%, white)'],
  ['300', 'color-mix(in srgb, var(--afs-brand) 50%, white)'],
  ['500', 'color-mix(in srgb, var(--afs-brand) 85%, white)'],
  ['600', 'var(--afs-brand)'],
  ['700', 'color-mix(in srgb, var(--afs-brand) 80%, black)'],
  ['900', 'color-mix(in srgb, var(--afs-brand) 45%, black)'],
];

/** Re-tints the whole app (every brand-* class) to the facility's colour, or restores the default. */
export function applyBrandColor(hex: string | null) {
  const s = document.documentElement.style;
  if (!hex) {
    s.removeProperty('--afs-brand');
    for (const [k] of SHADES) s.removeProperty(`--color-brand-${k}`);
    return;
  }
  s.setProperty('--afs-brand', hex);
  for (const [k, v] of SHADES) s.setProperty(`--color-brand-${k}`, v);
}

function setFavicon(url: string | null) {
  document.querySelectorAll<HTMLLinkElement>('link[data-afs-brand-icon]').forEach((l) => l.remove());
  if (!url) return;
  for (const rel of ['icon', 'apple-touch-icon']) {
    const l = document.createElement('link');
    l.rel = rel;
    l.href = url;
    l.dataset.afsBrandIcon = '1';
    document.head.appendChild(l);
  }
}

/** Applies the facility's colour, favicon and tab title on its own address. Renders nothing. */
export function BrandingApplier() {
  const { data } = useHostContext();
  useEffect(() => {
    const cached = readCache();
    if (cached) applyBrandColor(cached.primaryColor);
  }, []);
  useEffect(() => {
    if (!data) return;
    const b = data.kind === 'facility' ? data.branding ?? null : null;
    try {
      if (b) localStorage.setItem(CACHE_KEY, JSON.stringify(b));
      else localStorage.removeItem(CACHE_KEY);
    } catch {
      /* storage unavailable */
    }
    applyBrandColor(b?.primaryColor ?? null);
    setFavicon(b?.logoUrl ?? null);
    if (b && document.title === 'AfeySync HMIS') document.title = `${b.name} · AfeySync`;
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media*="dark"])');
    if (theme && b?.primaryColor) theme.content = b.primaryColor;
  }, [data]);
  return null;
}

/** The facility's logo and name (or the AfeySync mark on other addresses). */
export function BrandMark({ branding, subtitle, size = 'md', className }: { branding: Branding | null; subtitle?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = { sm: 'h-7 w-7', md: 'h-10 w-10', lg: 'h-14 w-14' }[size];
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {branding?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoUrl} alt="" className={cn(box, 'shrink-0 rounded-lg object-contain')} />
      ) : (
        <span className={cn(box, 'grid shrink-0 place-items-center rounded-lg', size === 'sm' ? '' : 'bg-brand-50 dark:bg-brand-900/40')}>
          <Activity className={cn('text-brand-600', size === 'sm' ? 'h-5 w-5' : 'h-6 w-6')} />
        </span>
      )}
      <div className="min-w-0">
        <p className={cn('truncate font-semibold', size === 'sm' ? 'text-sm' : 'text-lg leading-tight')}>{branding?.name ?? 'AfeySync'}</p>
        {subtitle !== null && size !== 'sm' && <p className="muted truncate text-xs">{subtitle ?? branding?.tagline ?? 'Hospital Management Information System'}</p>}
      </div>
    </div>
  );
}

/** Small attribution shown on branded pages. */
export function PoweredBy({ branding }: { branding: Branding | null }) {
  if (!branding) return null;
  return <p className="muted mt-2 flex items-center justify-center gap-1 text-[11px]"><Activity className="h-3 w-3" /> Powered by AfeySync</p>;
}
