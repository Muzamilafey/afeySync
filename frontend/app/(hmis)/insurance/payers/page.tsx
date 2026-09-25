'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td } from '@/components/ui';
import type { Payer } from '@/features/insurance/types';

interface CodeMap { _id: string; sourceSystem: string; sourceCode: string; targetSystem: string; targetCode: string; description?: string; reference?: string }

function PayersTab() {
  const can = useCan();
  const qc = useQueryClient();
  const manage = can('insurance.manage') || can('admin.integrations');
  const q = useQuery({ queryKey: ['ins-payers'], queryFn: async () => (await api<Payer[]>('/insurance/payers')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ins-payers'] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ providerType: 'SLADE360', sladeCode: '', name: '', displayName: '', environment: 'production', notes: '' });
  const toggle = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<Payer> }) => api(`/insurance/payers/${id}`, { method: 'PATCH', body: patch }), onSuccess: refresh });
  const create = useMutation({
    mutationFn: () => api('/insurance/payers', { method: 'POST', body: { ...form, sladeCode: form.sladeCode || undefined, displayName: form.displayName || undefined, notes: form.notes || undefined } }),
    onSuccess: () => { setOpen(false); setForm({ ...form, sladeCode: '', name: '', displayName: '', notes: '' }); refresh(); },
  });
  const examples = useMutation({ mutationFn: async () => (await api<{ added: number }>('/insurance/payers/sandbox-examples', { method: 'POST' })).data, onSuccess: refresh });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="muted flex-1 text-sm">Only payers that are both <b>enabled</b> and <b>supported</b> can be selected for new coverages. Confirm each payer and its payer code with Slade360 before enabling it in production.</p>
        {manage && <><Button variant="outline" onClick={() => examples.mutate()} loading={examples.isPending}>Add sandbox examples</Button><Button onClick={() => setOpen(true)}>Add payer</Button></>}
      </div>
      {examples.data && <div className="mb-3"><Alert tone="amber">{examples.data.added} sandbox example payer(s) added (disabled). These are Slade360 sandbox examples, not a production payer list.</Alert></div>}
      <ErrorText error={examples.error ?? toggle.error} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : (
        <Table head={['Payer', 'Payer code', 'Provider', 'Environment', 'Enabled', 'Supported', 'Notes']} empty={!q.data?.length}>
          {q.data?.map((p) => (
            <tr key={p._id}>
              <Td className="font-medium">{p.displayName || p.name}{p.displayName && <div className="muted text-xs">{p.name}</div>}</Td>
              <Td className="font-mono text-xs">{p.sladeCode ?? '—'}</Td>
              <Td>{p.providerType}</Td>
              <Td>{p.environment ? <Badge tone={p.environment === 'production' ? 'green' : 'amber'}>{p.environment}</Badge> : '—'}</Td>
              <Td>{manage ? <input type="checkbox" checked={p.enabled} onChange={(e) => toggle.mutate({ id: p._id, patch: { enabled: e.target.checked } })} /> : p.enabled ? 'Yes' : 'No'}</Td>
              <Td>{manage ? <input type="checkbox" checked={p.supported} onChange={(e) => toggle.mutate({ id: p._id, patch: { supported: e.target.checked } })} /> : p.supported ? 'Yes' : 'No'}</Td>
              <Td className="text-xs">{p.notes}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add payer">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider"><Select value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value })}><option value="SLADE360">Slade360</option><option value="DIRECT_INSURER">Direct insurer</option><option value="OTHER">Other</option></Select></Field>
          <Field label="Payer code" hint={form.providerType === 'SLADE360' ? 'The payer_slade_code issued by Slade360' : undefined}><Input value={form.sladeCode} onChange={(e) => setForm({ ...form, sladeCode: e.target.value })} /></Field>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Display name"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="Environment"><Select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}><option value="production">Production</option><option value="sandbox">Sandbox</option></Select></Field>
          <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <p className="muted text-xs sm:col-span-2">New payers start disabled. Enable them once the facility's contract with the payer is confirmed.</p>
          <div className="sm:col-span-2"><ErrorText error={create.error} /><Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.name.trim().length < 2}>Save payer</Button></div>
        </div>
      </Modal>
    </>
  );
}

function CodeMapsTab() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ins-code-maps'], queryFn: async () => (await api<CodeMap[]>('/insurance/code-maps')).data });
  const [form, setForm] = useState({ sourceSystem: 'ICD-11', sourceCode: '', targetCode: '', description: '', reference: '' });
  const save = useMutation({
    mutationFn: () => api('/insurance/code-maps', { method: 'POST', body: { ...form, targetSystem: 'ICD-10', targetCode: form.targetCode.trim().toUpperCase(), description: form.description || undefined, reference: form.reference || undefined } }),
    onSuccess: () => { setForm({ ...form, sourceCode: '', targetCode: '', description: '', reference: '' }); qc.invalidateQueries({ queryKey: ['ins-code-maps'] }); },
  });
  return (
    <>
      <Alert tone="blue" title="ICD-10 for insurance claims">Slade360 claims carry ICD-10 codes. AfeySync never converts codes silently: a claim is blocked until every diagnosis has an ICD-10 code or a mapping entered here. Record the source you used for each mapping (for example the WHO ICD-11 → ICD-10 mapping tables).</Alert>
      {can('insurance.manage') && (
        <div className="my-4 grid gap-3 md:grid-cols-6">
          <Field label="Source system"><Select value={form.sourceSystem} onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })}><option>ICD-11</option><option>LOCAL</option></Select></Field>
          <Field label="Source code"><Input value={form.sourceCode} onChange={(e) => setForm({ ...form, sourceCode: e.target.value })} /></Field>
          <Field label="ICD-10 code"><Input value={form.targetCode} onChange={(e) => setForm({ ...form, targetCode: e.target.value })} placeholder="e.g. J18.9" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Mapping reference" className="md:col-span-2"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <div className="md:col-span-6"><ErrorText error={save.error} /><Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!form.sourceCode || !form.targetCode}>Save mapping</Button></div>
        </div>
      )}
      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : (
        <Table head={['Source', 'Code', 'ICD-10', 'Description', 'Reference']} empty={!q.data?.length}>
          {q.data?.map((m) => <tr key={m._id}><Td>{m.sourceSystem}</Td><Td className="font-mono">{m.sourceCode}</Td><Td className="font-mono">{m.targetCode}</Td><Td>{m.description}</Td><Td className="text-xs">{m.reference}</Td></tr>)}
        </Table>
      )}
    </>
  );
}

export default function PayersPage() {
  const [tab, setTab] = useState<'payers' | 'codes'>('payers');
  return (
    <>
      <PageHeader title="Payers" crumbs={['Insurance', 'Payers']} subtitle="The facility's private insurance payer directory and diagnosis code mappings" />
      <Tabs tabs={[{ key: 'payers', label: 'Payer directory' }, { key: 'codes', label: 'Code mappings' }]} value={tab} onChange={setTab} />
      <div className="mt-4">{tab === 'payers' ? <PayersTab /> : <CodeMapsTab />}</div>
    </>
  );
}
