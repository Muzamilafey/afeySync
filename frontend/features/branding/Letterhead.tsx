'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

export interface LetterheadData {
  name: string;
  legalName: string;
  tagline: string | null;
  primaryColor: string | null;
  logoDataUrl: string | null;
  branch: { name: string; address: string | null; phone: string | null; email: string | null; facilityCode: string | null; county: string | null } | null;
}

export function useLetterhead() {
  return useQuery({ queryKey: ['letterhead'], queryFn: async () => (await api<LetterheadData>('/auth/letterhead')).data, staleTime: 5 * 60_000 });
}

/**
 * The facility's letterhead for every printed document: logo, name and branch contacts, then the
 * document title. `compact` is for narrow slips such as receipts.
 */
export function Letterhead({ title, meta, compact = false, className }: { title?: string; meta?: React.ReactNode; compact?: boolean; className?: string }) {
  const { data: l } = useLetterhead();
  const contacts = l?.branch ? [l.branch.address, l.branch.phone, l.branch.email].filter(Boolean).join(' · ') : '';
  const accent = l?.primaryColor ?? '#0f172a';
  if (compact) {
    return (
      <div className={cn('letterhead space-y-1 text-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {l?.logoDataUrl && <img src={l.logoDataUrl} alt="" className="mx-auto h-14 w-14 object-contain" />}
        <p className="text-base font-bold">{l?.name ?? ''}</p>
        {l?.branch && <p className="text-xs">{l.branch.name}</p>}
        {contacts && <p className="text-[11px]">{contacts}</p>}
        {title && <p className="border-y border-dashed py-1 font-bold">{title}</p>}
      </div>
    );
  }
  return (
    <div className={cn('letterhead mb-4 border-b-2 pb-3', className)} style={{ borderColor: accent }}>
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {l?.logoDataUrl && <img src={l.logoDataUrl} alt="" className="h-16 w-16 shrink-0 object-contain" />}
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-tight" style={{ color: accent }}>{l?.name ?? ''}</p>
          {l?.legalName && l.legalName !== l.name && <p className="text-xs">{l.legalName}</p>}
          {l?.branch && <p className="text-sm">{l.branch.name}{l.branch.facilityCode ? ` · MFL ${l.branch.facilityCode}` : ''}</p>}
          {contacts && <p className="text-xs">{contacts}</p>}
        </div>
        {(title || meta) && (
          <div className="shrink-0 text-right">
            {title && <p className="text-lg font-bold tracking-wide">{title}</p>}
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}
