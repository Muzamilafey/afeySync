'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FileSpreadsheet } from 'lucide-react';
import { ExcelImport } from '@/features/imports/ExcelImport';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';
import { money } from '@/lib/utils';
import { CATEGORIES, type ServiceItem } from '@/features/billing/types';

function ServiceForm({ item, onDone }: { item?: ServiceItem; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: item?.code ?? '', name: item?.name ?? '', category: item?.category ?? 'consultation', department: item?.department ?? '', shaInterventionCode: item?.shaInterventionCode ?? '', active: item?.active ?? true });
  const [prices, setPrices] = useState(item?.prices ?? [{ priceList: 'cash', amount: 0 }, { priceList: 'sha', amount: 0 }]);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, department: f.department || undefined, shaInterventionCode: f.shaInterventionCode || undefined, prices: prices.filter((p) => p.priceList) };
      return item ? api(`/billing/services/${item._id}`, { method: 'PATCH', body: { ...body, code: undefined } }) : api('/billing/services', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services-admin'] }); onDone(); },
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code"><Input value={f.code} disabled={!!item} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="SHA intervention code"><Input value={f.shaInterventionCode} onChange={(e) => setF({ ...f, shaInterventionCode: e.target.value })} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <p className="label">Price lists</p>
      {prices.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2">
          <Input value={p.priceList} placeholder="cash / sha / insurance / scheme key" onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, priceList: e.target.value.toLowerCase() } : x)))} />
          <Input type="number" min={0} value={p.amount} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
          <Button variant="ghost" onClick={() => setPrices(prices.filter((_, j) => j !== i))} aria-label="Remove price"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => setPrices([...prices, { priceList: 'insurance', amount: 0 }])}><Plus className="h-3 w-3" /> Add price list</Button>
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button>
    </div>
  );
}

export default function ServicesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState<ServiceItem | 'new' | null>(null);
  const list = useQuery({ queryKey: ['services-admin', q, category], queryFn: async () => (await api<ServiceItem[]>('/billing/services', { query: { q, category, active: 'all', limit: 500 } })).data });
  return (
    <>
      <PageHeader title="Services & Prices" crumbs={['Billing', 'Service catalog']} actions={can('billing.prices') && <><Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" /> Import from Excel</Button><Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add service</Button></>} />
      <ExcelImport open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['services-admin'] })} title="Import services & prices from Excel" noun="services" templatePath="/billing/services/import-template" templateName="services-and-prices-template.xlsx" importPath="/billing/services/import" />
      <Card>
        <div className="mb-3 flex gap-2">
          <Input className="max-w-60" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-48" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </div>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error} />
        {list.data && (
          <Table head={['Code', 'Service', 'Category', 'Prices', 'SHA', 'Status', '']} empty={list.data.length === 0}>
            {list.data.map((s) => (
              <tr key={s._id}>
                <Td className="font-mono text-xs">{s.code}</Td>
                <Td className="font-medium">{s.name}</Td>
                <Td className="capitalize">{s.category}</Td>
                <Td className="text-xs">{s.prices.map((p) => `${p.priceList}: ${money(p.amount)}`).join(' · ')}</Td>
                <Td className="font-mono text-xs">{s.shaInterventionCode ?? '—'}</Td>
                <Td><Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'active' : 'inactive'}</Badge></Td>
                <Td>{can('billing.prices') && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add service' : 'Edit service'} wide>
        {edit && <ServiceForm item={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}
