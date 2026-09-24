'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Button, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';
import type { LabItem, LabOrder, LabTest } from './types';

export function ResultEntry({ order, item, onDone }: { order: LabOrder; item: LabItem; onDone: () => void }) {
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: async () => (await api<LabTest[]>('/laboratory/tests')).data });
  const test = tests.data?.find((t) => t.code === item.testCode);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(item.results.map((r) => [r.parameter, r.value])));
  const [comment, setComment] = useState(item.comment ?? '');
  const m = useMutation({
    mutationFn: () => api(`/laboratory/orders/${order._id}/items/${item._id}/result`, { method: 'POST', body: { results: Object.entries(values).filter(([, v]) => v !== '').map(([parameter, value]) => ({ parameter, value })), comment: comment || undefined } }),
    onSuccess: onDone,
  });
  if (!test) return <p className="muted text-sm">Loading test definition…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm"><strong>{test.name}</strong> · {item.accessionNumber} · specimen {test.specimen}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {test.parameters.map((p) => {
          const r = p.ranges[0];
          const hint = p.type === 'numeric' && r ? `Ref ${r.low ?? ''}–${r.high ?? ''} ${p.unit ?? ''}` : r?.text ? `Normal: ${r.text}` : undefined;
          return (
            <Field key={p.code} label={`${p.name}${p.unit ? ` (${p.unit})` : ''}`} hint={hint}>
              {p.type === 'option' ? (
                <Select value={values[p.code] ?? ''} onChange={(e) => setValues({ ...values, [p.code]: e.target.value })}><option value="">—</option>{p.options?.map((o) => <option key={o}>{o}</option>)}</Select>
              ) : (
                <Input inputMode={p.type === 'numeric' ? 'decimal' : 'text'} value={values[p.code] ?? ''} onChange={(e) => setValues({ ...values, [p.code]: e.target.value })} />
              )}
            </Field>
          );
        })}
      </div>
      <Field label="Comment"><Textarea rows={2} className="min-h-0" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending}>Save results</Button>
      <p className="muted text-xs">Flags and critical values are computed by the server from the patient’s age/sex-specific reference ranges. Results require verification by a second person and approval before release.</p>
    </div>
  );
}
