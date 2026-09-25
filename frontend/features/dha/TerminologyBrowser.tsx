'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, Select } from '@/components/ui';

const FNS = [
  { key: 'search', label: 'Search concepts', hint: 'Free-text search across code systems' },
  { key: 'lookup', label: 'Look up a code', hint: 'Details of one code in a system' },
  { key: 'validate', label: 'Validate a code', hint: 'Is the code valid in the system / value set?' },
  { key: 'translate', label: 'Translate (map) a code', hint: 'Map a code between systems (e.g. ICD-11 ↔ other)' },
] as const;

/**
 * DHA terminology service browser. Parameter names follow the HIE terminology contract configured by the
 * platform owner, so they are entered as key/value pairs rather than guessed.
 */
export function TerminologyBrowser() {
  const [fn, setFn] = useState<(typeof FNS)[number]['key']>('search');
  const [params, setParams] = useState<Array<{ k: string; v: string }>>([{ k: 'q', v: '' }]);
  const run = useMutation({
    mutationFn: async () => (await api<unknown>(`/dha/terminology/${fn}`, { query: Object.fromEntries(params.filter((p) => p.k && p.v).map((p) => [p.k, p.v])) })).data,
  });
  const notConfigured = run.error instanceof ApiError && run.error.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED';
  return (
    <Card title="DHA terminology service">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        <Field label="Operation" hint={FNS.find((f) => f.key === fn)?.hint}>
          <Select value={fn} onChange={(e) => setFn(e.target.value as typeof fn)}>{FNS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
        </Field>
        <div>
          <p className="label">Parameters</p>
          {params.map((p, i) => (
            <div key={i} className="mb-2 grid grid-cols-[160px_1fr_auto] gap-2">
              <Input placeholder="name" value={p.k} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
              <Input placeholder="value" value={p.v} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              <Button type="button" variant="ghost" aria-label="Remove parameter" onClick={() => setParams(params.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setParams([...params, { k: '', v: '' }])}><Plus className="h-3 w-3" /> Parameter</Button>
        </div>
        <Button type="submit" loading={run.isPending}><Search className="h-4 w-4" /> Run</Button>
      </form>
      <div className="mt-4">
        {notConfigured ? <Alert tone="amber" title="Not configured">The terminology operations are declared but their paths have not been configured by AfeySync platform administration from the official HIE API catalog.</Alert> : <ErrorText error={run.error} />}
        {run.data !== undefined && <pre className="max-h-[28rem] overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(run.data, null, 2)}</pre>}
      </div>
    </Card>
  );
}
