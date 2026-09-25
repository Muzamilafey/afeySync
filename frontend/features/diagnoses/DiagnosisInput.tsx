'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Input } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Suggestion { display: string; code?: string; system?: string; category?: string; source: 'catalog' | 'recent' | 'dha' }
const SOURCE: Record<Suggestion['source'], string> = { catalog: 'List', recent: 'Recent', dha: 'National' };

/** A free-text diagnosis field with suggestions from the facility's diagnosis list, recent use and DHA terminology. */
export function DiagnosisInput({ value, onChange, context = 'admission', placeholder = 'Start typing, e.g. malaria, pneumonia, PPH…' }: { value: string; onChange: (v: string) => void; context?: 'admission' | 'consultation'; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(value), 200);
    return () => clearTimeout(t);
  }, [value]);
  const s = useQuery({ queryKey: ['dx-suggest', context, q], queryFn: async () => (await api<Suggestion[]>('/diagnoses/suggest', { query: { q, context } })).data, enabled: open, staleTime: 60_000 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const rows = s.data ?? [];
  const pick = (d: Suggestion) => { onChange(d.code ? `${d.display} (${d.code})` : d.display); setOpen(false); };
  return (
    <div ref={box} className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (!open || !rows.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && rows.length > 0 && (
        <ul role="listbox" className="surface absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg py-1 shadow-lg">
          {rows.map((d, i) => (
            <li key={`${d.source}:${d.display}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={(e) => { e.preventDefault(); pick(d); }} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === active && 'bg-[var(--surface-2)]')}>
                <span className="min-w-0 flex-1 truncate">{d.display}{d.code && <span className="muted ml-1 font-mono text-xs">{d.code}</span>}</span>
                {d.category && <span className="muted hidden text-xs sm:inline">{d.category}</span>}
                <span className="rounded bg-[var(--surface-2)] px-1.5 text-[10px] uppercase tracking-wide text-slate-500">{SOURCE[d.source]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
