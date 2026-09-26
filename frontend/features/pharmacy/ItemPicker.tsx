'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Input } from '@/components/ui';
import { itemLabel, type Item } from './types';

export function ItemPicker({ onPick, placeholder = 'Search drug / item', category }: { onPick: (i: Item) => void; placeholder?: string; category?: string }) {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['items', q, category], queryFn: async () => (await api<Item[]>('/pharmacy/items', { query: { q, limit: 15, category } })).data, enabled: q.length >= 2 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q.length >= 2 && r.data && (
        <ul className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md shadow-lg">
          {r.data.length === 0 && <li className="muted p-2 text-sm">No items</li>}
          {r.data.map((i) => (
            <li key={i._id}>
              <button type="button" className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => { onPick(i); setQ(''); }}>
                <span className="min-w-0 break-words">{itemLabel(i)} <span className="muted text-xs">{i.form} · {i.code}</span></span>
                <span className={`shrink-0 whitespace-nowrap text-xs ${(i.stock?.usable ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{i.stock?.usable ?? 0} {i.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
