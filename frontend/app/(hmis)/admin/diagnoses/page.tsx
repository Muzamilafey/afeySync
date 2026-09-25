'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';
import { ExcelImport } from '@/features/imports/ExcelImport';

interface Dx { _id: string; name: string; code?: string; system: 'ICD-11' | 'ICD-10' | 'local'; category?: string; synonyms: string[]; admission: boolean; notifiable: boolean; active: boolean; source: string }
const EMPTY = { name: '', code: '', system: 'ICD-11' as Dx['system'], category: '', synonyms: '', admission: true, notifiable: false, active: true };

function DxForm({ item, onDone }: { item?: Dx; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(item ? { ...item, code: item.code ?? '', category: item.category ?? '', synonyms: item.synonyms.join(', ') } : EMPTY);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name, code: f.code, system: f.system, category: f.category || undefined, synonyms: f.synonyms.split(',').map((s) => s.trim()).filter(Boolean), admission: f.admission, notifiable: f.notifiable, active: f.active };
      return item ? api(`/diagnoses/${item._id}`, { method: 'PATCH', body }) : api('/diagnoses', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['diagnoses'] }); onDone(); },
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Diagnosis / disease" className="col-span-full"><Input value={f.name} maxLength={160} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Severe malaria" /></Field>
      <Field label="Code (optional)" hint="Only codes you have checked against the official ICD browser."><Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="e.g. BA00" /></Field>
      <Field label="Code system"><Select value={f.system} onChange={(e) => setF({ ...f, system: e.target.value as Dx['system'] })}><option>ICD-11</option><option>ICD-10</option><option value="local">Local</option></Select></Field>
      <Field label="Category"><Input value={f.category} maxLength={60} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Respiratory" /></Field>
      <Field label="Other names" hint="Abbreviations or other names, separated by commas."><Input value={f.synonyms} onChange={(e) => setF({ ...f, synonyms: e.target.value })} placeholder="e.g. CVA, cerebrovascular accident" /></Field>
      <div className="col-span-full flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.admission} onChange={(e) => setF({ ...f, admission: e.target.checked })} /> Offer first when admitting</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.notifiable} onChange={(e) => setF({ ...f, notifiable: e.target.checked })} /> Notifiable disease</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <div className="col-span-full space-y-2"><ErrorText error={m.error} /><Button type="submit" loading={m.isPending} disabled={f.name.trim().length < 2}>{item ? 'Save changes' : 'Add diagnosis'}</Button></div>
    </form>
  );
}

export default function DiagnosesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Dx | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useQuery({ queryKey: ['diagnoses', q], queryFn: async () => (await api<Dx[]>('/diagnoses', { query: { q, all: 'true' } })).data });
  return (
    <>
      <PageHeader
        title="Diagnoses"
        subtitle="The diagnosis and disease list staff pick from when admitting a patient and in consultations."
        crumbs={['Admin', 'Diagnoses']}
        actions={<><Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" /> Import from Excel</Button><Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add diagnosis</Button></>}
      />
      <div className="mb-4"><Alert tone="blue">Your list starts with common admission diagnoses. Add the codes (ICD-11 or ICD-10) your facility uses; codes appear on records and claims, so only enter codes you have checked. Staff can still type any diagnosis.</Alert></div>
      <Card>
        <Input className="mb-3 max-w-sm" placeholder="Search name, code or other name" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.isLoading && <Loading />}
        {list.data && (
          <Table head={['Diagnosis', 'Code', 'Category', 'Other names', '', 'Status', '']} empty={list.data.length === 0}>
            {list.data.map((d) => (
              <tr key={d._id}>
                <Td className="font-medium">{d.name}</Td>
                <Td className="font-mono text-xs">{d.code ? `${d.code} · ${d.system}` : '—'}</Td>
                <Td className="text-sm">{d.category ?? '—'}</Td>
                <Td className="muted max-w-xs truncate text-xs">{d.synonyms.join(', ')}</Td>
                <Td>{d.admission && <Badge tone="blue">Admission</Badge>} {d.notifiable && <Badge tone="amber">Notifiable</Badge>}</Td>
                <Td><Badge tone={d.active ? 'green' : 'gray'}>{d.active ? 'active' : 'hidden'}</Badge></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setEdit(d)}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add diagnosis' : 'Edit diagnosis'} wide>
        {edit && <DxForm key={edit === 'new' ? 'new' : edit._id} item={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
      <ExcelImport open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['diagnoses'] })} title="Import diagnoses from Excel" noun="diagnoses" templatePath="/diagnoses/import-template" templateName="diagnoses-template.xlsx" importPath="/diagnoses/import" />
    </>
  );
}
