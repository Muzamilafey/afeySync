'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';

/**
 * Schema-agnostic rendering of HIE responses. AfeySync does not reinterpret provider payloads: it
 * shows the fields the HIE returns (per the official API catalog) with light formatting.
 */
type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function unwrapList(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.filter(isObj);
  if (!isObj(body)) return [];
  for (const k of ['data', 'results', 'items', 'benefits', 'interventions']) {
    const v = body[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = unwrapList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

export const pickStr = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && typeof o[k] !== 'object') return String(o[k]);
  return undefined;
};

export const humanize = (k: string) => k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

export function Flags({ o }: { o: Obj }) {
  const flags = Object.entries(o).filter(([, v]) => typeof v === 'boolean');
  if (!flags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map(([k, v]) => (
        <Badge key={k} tone={v ? (/(pre.?auth|authori[sz]ation|required)/i.test(k) ? 'amber' : 'green') : 'gray'}>
          {humanize(k)}: {v ? 'YES' : 'NO'}
        </Badge>
      ))}
    </div>
  );
}

export function Scalars({ o, exclude = [] }: { o: Obj; exclude?: string[] }) {
  const rows = Object.entries(o).filter(([k, v]) => v != null && typeof v !== 'object' && typeof v !== 'boolean' && !exclude.includes(k));
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="muted">{humanize(k)}:</dt>
          <dd className="font-medium break-all">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RawJson({ data, label = 'Raw HIE response' }: { data: unknown; label?: string }): ReactNode {
  return (
    <details className="mt-2">
      <summary className="muted cursor-pointer text-xs">{label}</summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
