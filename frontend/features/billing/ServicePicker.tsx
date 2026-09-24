'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Input } from '@/components/ui';
import { money } from '@/lib/utils';
import type { ServiceItem } from './types';

export function ServicePicker({ onPick, priceList = 'cash' }: { onPick: (s: ServiceItem) => void; priceList?: string }) {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['services', q], queryFn: async () => (await api<ServiceItem[]>('/billing/services', { query: { q, limit: 20 } })).data, enabled: q.length >= 1 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search service by name or code" />
      {q && r.data && (
        <ul className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md shadow-lg">
          {r.data.length === 0 && <li className="muted p-2 text-sm">No services found</li>}
          {r.data.map((s) => (
            <li key={s._id}>
              <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => { onPick(s); setQ(''); }}>
                <span><span className="font-mono text-xs">{s.code}</span> {s.name}</span>
                <span className="muted">{money((s.prices.find((p) => p.priceList === priceList) ?? s.prices.find((p) => p.priceList === 'cash'))?.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
