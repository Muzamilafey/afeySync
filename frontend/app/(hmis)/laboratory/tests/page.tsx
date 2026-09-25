'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { ExcelImport } from '@/features/imports/ExcelImport';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';
import type { LabTest } from '@/features/lab/types';

type Param = LabTest['parameters'][number];
const blankParam = (): Param => ({ code: '', name: '', unit: '', type: 'numeric', options: [], ranges: [{ sex: 'any', ageMinDays: 0, ageMaxDays: 54750 }] });

function TestForm({ test, onDone }: { test?: LabTest; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: test?.code ?? '', name: test?.name ?? '', department: test?.department ?? 'General', specimen: test?.specimen ?? 'Blood', container: test?.container ?? '', turnaroundMinutes: test?.turnaroundMinutes ?? 60, serviceCode: test?.serviceCode ?? '', active: test?.active ?? true });
  const [params, setParams] = useState<Param[]>(test?.parameters ?? [blankParam()]);
  const up = (i: number, p: Partial<Param>) => setParams(params.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, container: f.container || undefined, serviceCode: f.serviceCode || undefined, parameters: params.map((p) => ({ ...p, unit: p.unit || undefined, options: p.type === 'option' ? p.options : undefined, ranges: p.ranges.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v !== undefined && !(typeof v === 'number' && Number.isNaN(v))))) })) };
      return test ? api(`/laboratory/tests/${test.code}`, { method: 'PATCH', body: { ...body, code: undefined } }) : api('/laboratory/tests', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-tests-admin'] }); onDone(); },
  });
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code"><Input value={f.code} disabled={!!test} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="Specimen"><Input value={f.specimen} onChange={(e) => setF({ ...f, specimen: e.target.value })} /></Field>
        <Field label="Container"><Input value={f.container} onChange={(e) => setF({ ...f, container: e.target.value })} /></Field>
        <Field label="TAT (minutes)"><Input type="number" value={f.turnaroundMinutes} onChange={(e) => setF({ ...f, turnaroundMinutes: Number(e.target.value) })} /></Field>
        <Field label="Billing service code" hint="Defaults to LAB-<code>"><Input value={f.serviceCode} onChange={(e) => setF({ ...f, serviceCode: e.target.value.toUpperCase() })} /></Field>
      </div>
      {params.map((p, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <div className="grid gap-2 sm:grid-cols-[100px_1fr_100px_130px_auto]">
            <Input placeholder="Code" value={p.code} onChange={(e) => up(i, { code: e.target.value.toUpperCase() })} />
            <Input placeholder="Parameter name" value={p.name} onChange={(e) => up(i, { name: e.target.value })} />
            <Input placeholder="Unit" value={p.unit ?? ''} onChange={(e) => up(i, { unit: e.target.value })} />
            <Select value={p.type} onChange={(e) => up(i, { type: e.target.value as Param['type'] })}><option value="numeric">Numeric</option><option value="option">Options</option><option value="text">Free text</option></Select>
            <Button variant="ghost" onClick={() => setParams(params.filter((_, j) => j !== i))} aria-label="Remove parameter"><Trash2 className="h-4 w-4" /></Button>
          </div>
          {p.type === 'option' && <Input placeholder="Options, comma separated" value={(p.options ?? []).join(', ')} onChange={(e) => up(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />}
          {p.ranges.map((r, k) => (
            <div key={k} className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-8">
              <Select value={r.sex} onChange={(e) => up(i, { ranges: p.ranges.map((x, j) => (j === k ? { ...x, sex: e.target.value } : x)) })}><option value="any">Any sex</option><option value="male">Male</option><option value="female">Female</option></Select>
              <Input placeholder="Min age (days)" type="number" value={r.ageMinDays} onChange={(e) => up(i, { ranges: p.ranges.map((x, j) => (j === k ? { ...x, ageMinDays: Number(e.target.value) } : x)) })} />
              <Input placeholder="Max age (days)" type="number" value={r.ageMaxDays} onChange={(e) => up(i, { ranges: p.ranges.map((x, j) => (j === k ? { ...x, ageMaxDays: Number(e.target.value) } : x)) })} />
              {p.type === 'numeric' ? (
                (['low', 'high', 'criticalLow', 'criticalHigh'] as const).map((key) => <Input key={key} placeholder={key} type="number" step="any" value={r[key] ?? ''} onChange={(e) => up(i, { ranges: p.ranges.map((x, j) => (j === k ? { ...x, [key]: num(e.target.value) } : x)) })} />)
              ) : (
                <Input className="col-span-4" placeholder="Normal value" value={r.text ?? ''} onChange={(e) => up(i, { ranges: p.ranges.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
              )}
              <Button variant="ghost" size="sm" onClick={() => up(i, { ranges: p.ranges.filter((_, j) => j !== k) })}>Remove</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => up(i, { ranges: [...p.ranges, { sex: 'any', ageMinDays: 0, ageMaxDays: 54750 }] })}>Add range</Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => setParams([...params, blankParam()])}><Plus className="h-3 w-3" /> Add parameter</Button>
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending}>Save test</Button>
    </div>
  );
}

export default function LabTestsPage() {
  const [importing, setImporting] = useState(false);
  const qcImport = useQueryClient();
  const can = useCan();
  const [edit, setEdit] = useState<LabTest | 'new' | null>(null);
  const q = useQuery({ queryKey: ['lab-tests-admin'], queryFn: async () => (await api<LabTest[]>('/laboratory/tests', { query: { all: 'true' } })).data });
  return (
    <>
      <PageHeader title="Lab Test Catalog" crumbs={['Laboratory', 'Catalog']} actions={can('lab.manage') && <><Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" /> Import from Excel</Button><Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add test</Button></>} />
      <ExcelImport open={importing} onClose={() => setImporting(false)} onDone={() => qcImport.invalidateQueries()} title="Import lab tests from Excel" noun="tests" templatePath="/laboratory/tests/import-template" templateName="lab-tests-template.xlsx" importPath="/laboratory/tests/import" />
      <div className="mb-4"><Alert tone="amber">Seeded reference ranges are generic defaults. Your laboratory must review and adjust them for its analysers and population before clinical use.</Alert></div>
      <Card>
        {q.isLoading && <Loading />}
        <Table head={['Code', 'Test', 'Department', 'Specimen', 'Parameters', 'TAT', 'Status', '']}>
          {q.data?.map((x) => (
            <tr key={x._id}>
              <Td className="font-mono text-xs">{x.code}</Td><Td className="font-medium">{x.name}</Td><Td>{x.department}</Td><Td>{x.specimen}</Td>
              <Td className="text-xs">{x.parameters.map((p) => p.name).join(', ')}</Td><Td>{x.turnaroundMinutes} min</Td>
              <Td><Badge tone={x.active ? 'green' : 'gray'}>{x.active ? 'active' : 'inactive'}</Badge></Td>
              <Td>{can('lab.manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(x)}>Edit</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add lab test' : 'Edit lab test'} wide>{edit && <TestForm test={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}</Modal>
    </>
  );
}
