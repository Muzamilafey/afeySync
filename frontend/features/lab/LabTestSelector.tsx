'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Input } from '@/components/ui';
import type { LabTest } from './types';

export interface LabPackage { code: string; name: string; description?: string; testCodes: string[]; tests: Array<{ code: string; name: string }>; prices: Record<string, number>; priceIfSeparate: number; active: boolean }
export interface LabSelection { tests: LabTest[]; packages: LabPackage[] }

/** Search and pick lab tests and test packages. Tests already inside a chosen package are not added twice. */
export function LabTestSelector({ value, onChange, enabled = true }: { value: LabSelection; onChange: (v: LabSelection) => void; enabled?: boolean }) {
  const [q, setQ] = useState('');
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: async () => (await api<LabTest[]>('/laboratory/tests')).data, enabled });
  const pkgs = useQuery({ queryKey: ['lab-packages'], queryFn: async () => (await api<LabPackage[]>('/laboratory/packages')).data, enabled });
  const inPkg = new Set(value.packages.flatMap((p) => p.testCodes));
  const term = q.trim().toLowerCase();
  const pkgMatches = (pkgs.data ?? []).filter((p) => (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().startsWith(term)) && !value.packages.some((x) => x.code === p.code)).slice(0, term ? 6 : 4);
  const testMatches = term ? (tests.data ?? []).filter((t) => (t.name.toLowerCase().includes(term) || t.code.toLowerCase().startsWith(term)) && !value.tests.some((s) => s.code === t.code) && !inPkg.has(t.code)).slice(0, 8) : [];
  return (
    <div className="space-y-2">
      <Input placeholder="Search tests or packages (e.g. FBC, malaria, antenatal)" value={q} onChange={(e) => setQ(e.target.value)} />
      {(pkgMatches.length > 0 || testMatches.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {pkgMatches.map((p) => (
            <button key={p.code} type="button" className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200" onClick={() => { onChange({ packages: [...value.packages, p], tests: value.tests.filter((t) => !p.testCodes.includes(t.code)) }); setQ(''); }} title={p.tests.map((t) => t.name).join(', ')}>
              <Package className="h-3 w-3" /> {p.name}{p.prices.cash != null ? ` · KES ${p.prices.cash.toLocaleString()}` : ''}
            </button>
          ))}
          {testMatches.map((t) => <button key={t.code} type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]" onClick={() => { onChange({ ...value, tests: [...value.tests, t] }); setQ(''); }}>{t.name}</button>)}
        </div>
      )}
      {(value.packages.length > 0 || value.tests.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {value.packages.map((p) => <Badge key={p.code} tone="purple">{p.name} ({p.testCodes.length} tests) <button type="button" onClick={() => onChange({ ...value, packages: value.packages.filter((x) => x.code !== p.code) })} aria-label={`Remove ${p.name}`}>×</button></Badge>)}
          {value.tests.map((t) => <Badge key={t.code} tone="blue">{t.name} <button type="button" onClick={() => onChange({ ...value, tests: value.tests.filter((x) => x.code !== t.code) })} aria-label={`Remove ${t.name}`}>×</button></Badge>)}
        </div>
      )}
    </div>
  );
}
