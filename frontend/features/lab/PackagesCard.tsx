'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, Table, Td } from '@/components/ui';
import type { LabTest } from './types';
import type { LabPackage } from './LabTestSelector';

const LISTS = [['cash', 'Cash'], ['insurance', 'Insurance'], ['sha', 'SHA'], ['foreigner', 'Foreigner']] as const;

function PackageForm({ pkg, onDone }: { pkg?: LabPackage; onDone: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: async () => (await api<LabTest[]>('/laboratory/tests')).data });
  const [f, setF] = useState({ code: pkg?.code ?? '', name: pkg?.name ?? '', description: pkg?.description ?? '', testCodes: pkg?.testCodes ?? [], active: pkg?.active ?? true });
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(LISTS.map(([k]) => [k, pkg?.prices?.[k] != null ? String(pkg.prices[k]) : ''])));
  const [q, setQ] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const p = Object.fromEntries(Object.entries(prices).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
      const body = { name: f.name, description: f.description || undefined, testCodes: f.testCodes, active: f.active, prices: can('billing.prices') && Object.keys(p).length ? p : undefined };
      return pkg ? api(`/laboratory/packages/${pkg.code}`, { method: 'PATCH', body }) : api('/laboratory/packages', { method: 'POST', body: { ...body, code: f.code } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-packages'] }); onDone(); },
  });
  const shown = (tests.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.code.startsWith(q.toUpperCase()));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code *"><Input value={f.code} disabled={!!pkg} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-_]/g, '') })} placeholder="e.g. ANC" /></Field>
        <Field label="Name *" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Antenatal profile" /></Field>
        <Field label="Description" className="sm:col-span-3"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <Field label={`Tests in the package * (${f.testCodes.length} chosen)`}>
        <Input placeholder="Filter tests" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
          {shown.map((t) => (
            <label key={t.code} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--surface-2)]">
              <input type="checkbox" checked={f.testCodes.includes(t.code)} onChange={(e) => setF({ ...f, testCodes: e.target.checked ? [...f.testCodes, t.code] : f.testCodes.filter((c) => c !== t.code) })} />
              {t.name} <span className="muted font-mono text-xs">{t.code}</span>
            </label>
          ))}
          {tests.isLoading && <Loading />}
        </div>
      </Field>
      {can('billing.prices') ? (
        <div>
          <p className="label mb-1">Package price (KES)</p>
          <div className="grid gap-2 sm:grid-cols-4">{LISTS.map(([k, l]) => <Field key={k} label={l}><Input type="number" min={0} value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} /></Field>)}</div>
        </div>
      ) : <p className="muted text-xs">Someone who manages prices sets the package price under Services & Prices.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (can be ordered)</label>
      <ErrorText error={save.error} />
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={f.code.length < 2 || f.name.trim().length < 2 || f.testCodes.length < 2}>Save package</Button>
    </div>
  );
}

/** Test packages: several tests ordered together and charged at one package price. */
export function PackagesCard() {
  const can = useCan();
  const q = useQuery({ queryKey: ['lab-packages', 'all'], queryFn: async () => (await api<LabPackage[]>('/laboratory/packages', { query: { all: 'true' } })).data });
  const [edit, setEdit] = useState<LabPackage | 'new' | null>(null);
  return (
    <Card title={<span className="flex items-center gap-2"><Package className="h-4 w-4" /> Test packages</span>} actions={can('lab.manage') && <Button size="sm" onClick={() => setEdit('new')}><Plus className="h-3.5 w-3.5" /> Add package</Button>} className="mb-4">
      {q.isLoading ? <Loading /> : (
        <Table head={['Code', 'Package', 'Tests', 'Price (cash)', 'If ordered separately', 'Status', '']} empty={!q.data?.length}>
          {q.data?.map((p) => (
            <tr key={p.code}>
              <Td className="font-mono text-xs">{p.code}</Td>
              <Td className="font-medium">{p.name}</Td>
              <Td className="text-xs">{p.tests.map((t) => t.name).join(', ')}</Td>
              <Td>{p.prices.cash != null ? `KES ${p.prices.cash.toLocaleString()}` : <Badge tone="amber">no price</Badge>}</Td>
              <Td className="text-xs">KES {p.priceIfSeparate.toLocaleString()}{p.prices.cash != null && p.priceIfSeparate > p.prices.cash ? <span className="block text-emerald-600">saves KES {(p.priceIfSeparate - p.prices.cash).toLocaleString()}</span> : null}</Td>
              <Td><Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'active' : 'inactive'}</Badge></Td>
              <Td>{can('lab.manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add test package' : 'Edit test package'} wide>{edit && <PackageForm pkg={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}</Modal>
    </Card>
  );
}
