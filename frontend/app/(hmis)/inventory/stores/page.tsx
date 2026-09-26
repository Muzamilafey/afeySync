'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Download, Plus, Printer, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, SearchInput, Select, Table, Tabs, Td, Textarea, statusTone, useDebounced } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';

type Tab = 'requisitions' | 'stocktakes' | 'movement' | 'reorder';
interface Loc { _id: string; name: string; type: string }
interface PickItem { _id: string; code: string; name: string; strength?: string; unit: string; packUnit?: string; packSize?: number }
interface ReqLine { _id: string; itemId: string; name: string; unit?: string; quantity: number; approvedQuantity?: number; issuedQuantity?: number }
interface Requisition {
  _id: string; reqNumber: string; status: string; urgency: string; notes?: string; createdAt: string;
  fromLocationId: { _id: string; name: string } | null; toLocationId: { _id: string; name: string } | null;
  items: ReqLine[]; requestedBy?: string; requestedByName?: string; decidedByName?: string; decidedAt?: string; rejectionReason?: string;
  issues: Array<{ at: string; byName: string; reference: string; lines: Array<{ batchNumber: string; quantity: number }> }>;
  receivedByName?: string; receivedAt?: string;
}
interface StockTakeRow { _id: string; takeNumber: string; status: string; category?: string; createdAt: string; createdByName?: string; approvedByName?: string; locationId: { name: string } | null }
interface MoveRow { itemId: string; code: string; name: string; unit: string; category: string; opening: number; received: number; issued: number; adjusted: number; closing: number }
interface Reorder { itemId: string; code: string; name: string; category: string; unit: string; packUnit?: string; packSize: number; usable: number; reorderLevel: number; suggestedQuantity: number; lastUnitCost: number; onOrder: Array<{ po: string; quantity: number }> }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };

function ReqItemPicker({ onPick }: { onPick: (i: PickItem) => void }) {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['req-items', q], queryFn: async () => (await api<PickItem[]>('/inventory/requisition-items', { query: { q } })).data, enabled: q.length >= 2 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item to request" />
      {q.length >= 2 && r.data && (
        <ul className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md shadow-lg">
          {r.data.length === 0 && <li className="muted p-2 text-sm">No items</li>}
          {r.data.map((i) => <li key={i._id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => { onPick(i); setQ(''); }}>{i.name} {i.strength} <span className="muted text-xs">{i.code} · {i.unit}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

function NewRequisition({ locations, onDone }: { locations: Loc[]; onDone: () => void }) {
  const stores = locations.filter((l) => l.type === 'store' || l.type === 'pharmacy');
  const [from, setFrom] = useState(stores[0]?._id ?? '');
  const [to, setTo] = useState(locations.find((l) => l._id !== (stores[0]?._id ?? ''))?._id ?? '');
  const [urgency, setUrgency] = useState<'routine' | 'urgent'>('routine');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ item: PickItem; quantity: string }>>([]);
  const m = useMutation({ mutationFn: () => api('/inventory/requisitions', { method: 'POST', body: { fromLocationId: from, toLocationId: to, urgency, notes: notes || undefined, items: lines.map((l) => ({ itemId: l.item._id, quantity: Number(l.quantity) })) } }), onSuccess: onDone });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Request from (store)"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
        <Field label="Deliver to (department)"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{locations.filter((l) => l._id !== from).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
        <Field label="Urgency"><Select value={urgency} onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent')}><option value="routine">Routine</option><option value="urgent">Urgent</option></Select></Field>
      </div>
      <ReqItemPicker onPick={(item) => !lines.some((l) => l.item._id === item._id) && setLines([...lines, { item, quantity: '' }])} />
      {lines.map((l, i) => (
        <div key={l.item._id} className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
          <span className="text-sm">{l.item.name} {l.item.strength}{(l.item.packSize ?? 1) > 1 && <span className="muted block text-xs">{l.item.packUnit || 'pack'} of {l.item.packSize} {l.item.unit}</span>}</span>
          <Input type="number" min={1} placeholder={`Qty (${l.item.unit})`} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          <Button variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why the items are needed, e.g. weekly ward top-up" /></Field>
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!from || !to || !lines.length || lines.some((l) => !(Number(l.quantity) > 0))}>Send requisition</Button>
    </div>
  );
}

function RequisitionDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['requisition', id], queryFn: async () => (await api<Requisition>(`/inventory/requisitions/${id}`)).data });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const done = () => { qc.invalidateQueries({ queryKey: ['requisition', id] }); onDone(); };
  const quantities = () => Object.fromEntries(Object.entries(qty).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
  const decide = useMutation({ mutationFn: (approve: boolean) => api(`/inventory/requisitions/${id}/decide`, { method: 'POST', body: { approve, reason: reason || undefined, quantities: quantities() } }), onSuccess: () => { setQty({}); done(); } });
  const issue = useMutation({ mutationFn: () => api(`/inventory/requisitions/${id}/issue`, { method: 'POST', body: { quantities: quantities() } }), onSuccess: () => { setQty({}); done(); } });
  const receive = useMutation({ mutationFn: () => api(`/inventory/requisitions/${id}/receive`, { method: 'POST' }), onSuccess: done });
  const cancel = useMutation({ mutationFn: () => api(`/inventory/requisitions/${id}/cancel`, { method: 'POST' }), onSuccess: done });
  if (!q.data) return <Loading />;
  const r = q.data;
  const manage = can('inventory.manage', 'pharmacy.stock');
  const editQty = (r.status === 'pending' && manage) || (['approved', 'partially_issued'].includes(r.status) && manage);
  return (
    <div className="space-y-4">
      <KV items={[
        ['Number', <span key="n" className="font-mono">{r.reqNumber}</span>],
        ['Status', <Badge key="s" tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge>],
        ['From → to', `${r.fromLocationId?.name ?? '—'} → ${r.toLocationId?.name ?? '—'}`],
        ['Urgency', r.urgency],
        ['Requested by', `${r.requestedByName ?? '—'}, ${fmtDateTime(r.createdAt)}`],
        ['Decided by', r.decidedByName ? `${r.decidedByName}, ${fmtDateTime(r.decidedAt)}` : '—'],
        ...(r.rejectionReason ? [['Reason', r.rejectionReason] as [string, string]] : []),
        ...(r.receivedByName ? [['Received by', `${r.receivedByName}, ${fmtDateTime(r.receivedAt)}`] as [string, string]] : []),
      ]} />
      {r.notes && <p className="muted text-sm">{r.notes}</p>}
      <Table head={['Item', 'Requested', 'Approved', 'Issued', editQty ? (r.status === 'pending' ? 'Approve qty' : 'Issue now') : '']}>
        {r.items.map((i) => {
          const outstanding = (i.approvedQuantity ?? 0) - (i.issuedQuantity ?? 0);
          return (
            <tr key={i._id}>
              <Td>{i.name}</Td><Td>{i.quantity} {i.unit}</Td><Td>{i.approvedQuantity ?? '—'}</Td><Td>{i.issuedQuantity ?? 0}</Td>
              <Td>{editQty && (r.status === 'pending' || outstanding > 0) && <Input className="w-24" type="number" min={0} placeholder={String(r.status === 'pending' ? i.quantity : outstanding)} value={qty[i._id] ?? ''} onChange={(e) => setQty({ ...qty, [i._id]: e.target.value })} />}</Td>
            </tr>
          );
        })}
      </Table>
      {r.issues.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">Issues</p>
          {r.issues.map((s) => <p key={s.reference} className="muted text-xs">{s.reference} · {fmtDateTime(s.at)} · {s.byName} · {s.lines.map((l) => `${l.batchNumber} × ${l.quantity}`).join(', ')}</p>)}
        </div>
      )}
      <ErrorText error={decide.error ?? issue.error ?? receive.error ?? cancel.error} />
      <div className="flex flex-wrap items-end gap-2">
        {r.status === 'pending' && manage && (
          <>
            <Button onClick={() => decide.mutate(true)} loading={decide.isPending}>Approve</Button>
            <Input className="w-64" placeholder="Reason (needed to reject)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="outline" onClick={() => decide.mutate(false)} disabled={reason.trim().length < 3}>Reject</Button>
          </>
        )}
        {['approved', 'partially_issued'].includes(r.status) && manage && <Button onClick={() => issue.mutate()} loading={issue.isPending}>Issue from store</Button>}
        {r.status === 'issued' && <Button onClick={() => receive.mutate()} loading={receive.isPending}>Confirm received</Button>}
        {['pending', 'approved'].includes(r.status) && <Button variant="ghost" onClick={() => confirm('Cancel this requisition?') && cancel.mutate()}>Cancel requisition</Button>}
        <Button variant="outline" onClick={() => window.open(`/print/requisition/${r._id}`, '_blank')}><Printer className="h-4 w-4" /> Print</Button>
      </div>
      {r.status === 'pending' && manage && <p className="muted text-xs">Leave a quantity blank to approve what was requested. The person who raised a requisition cannot approve it.</p>}
    </div>
  );
}

function Requisitions({ locations }: { locations: Loc[] }) {
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending,approved,partially_issued,issued');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim()) || undefined;
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['requisitions', status, mine, term], queryFn: async () => (await api<Requisition[]>('/inventory/requisitions', { query: { status: status || undefined, mine: mine ? 'true' : undefined, q: term, limit: 100 } })).data, placeholderData: (prev) => prev });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['requisitions'] }); };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search number, item or requester" />
        <Button size="sm" onClick={() => setOpen('new')}><Plus className="h-3 w-3" /> New requisition</Button>
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending,approved,partially_issued,issued">Open</option>
          <option value="pending">Awaiting approval</option>
          <option value="approved,partially_issued">To issue</option>
          <option value="issued">To confirm receipt</option>
          <option value="received,rejected,cancelled">Closed</option>
          <option value="">All</option>
        </Select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
      </div>
      {list.isLoading ? <Loading /> : (
        <Table head={['Number', 'Date', 'From → to', 'Items', 'Requested by', 'Status', '']} empty={(list.data ?? []).length === 0}>
          {list.data?.map((r) => (
            <tr key={r._id}>
              <Td className="font-mono text-xs">{r.reqNumber}{r.urgency === 'urgent' && <Badge tone="red" className="ml-1">urgent</Badge>}</Td>
              <Td>{fmtDateTime(r.createdAt)}</Td>
              <Td>{r.fromLocationId?.name} → {r.toLocationId?.name}</Td>
              <Td className="text-xs">{r.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</Td>
              <Td>{r.requestedByName}</Td>
              <Td><Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge></Td>
              <Td><Button size="sm" variant="ghost" onClick={() => setOpen(r._id)}>{can('inventory.manage', 'pharmacy.stock') && ['pending', 'approved', 'partially_issued'].includes(r.status) ? 'Review' : 'Open'}</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open === 'new'} onClose={() => setOpen(null)} title="New requisition" wide><NewRequisition locations={locations} onDone={() => { refresh(); setOpen(null); }} /></Modal>
      <Modal open={!!open && open !== 'new'} onClose={() => setOpen(null)} title="Requisition" wide>{open && open !== 'new' && <RequisitionDetail id={open} onDone={refresh} />}</Modal>
    </>
  );
}

function StockTakes({ locations }: { locations: Loc[] }) {
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ locationId: '', category: '', notes: '' });
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim()) || undefined;
  const list = useQuery({ queryKey: ['stock-takes', term], queryFn: async () => (await api<StockTakeRow[]>('/inventory/stock-takes', { query: { q: term } })).data, placeholderData: (prev) => prev });
  const start = useMutation({ mutationFn: () => api<{ _id: string }>('/inventory/stock-takes', { method: 'POST', body: { locationId: f.locationId || locations[0]?._id, category: f.category || undefined, notes: f.notes || undefined } }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['stock-takes'] }); window.location.href = `/inventory/stock-takes/${r.data._id}`; } });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search number, location, item or person" />
        {can('inventory.manage', 'pharmacy.stock') && <Button size="sm" onClick={() => setOpen(true)}><ClipboardCheck className="h-3 w-3" /> Start stock take</Button>}
      </div>
      {list.isLoading ? <Loading /> : (
        <Table head={['Number', 'Started', 'Location', 'Category', 'Started by', 'Approved by', 'Status', '']} empty={(list.data ?? []).length === 0}>
          {list.data?.map((s) => (
            <tr key={s._id}>
              <Td className="font-mono text-xs">{s.takeNumber}</Td><Td>{fmtDateTime(s.createdAt)}</Td><Td>{s.locationId?.name}</Td><Td className="capitalize">{s.category ?? 'All items'}</Td><Td>{s.createdByName}</Td><Td>{s.approvedByName ?? '—'}</Td>
              <Td><Badge tone={statusTone(s.status)}>{s.status}</Badge></Td>
              <Td className="whitespace-nowrap"><Link className="text-sm text-brand-600" href={`/inventory/stock-takes/${s._id}`}>{s.status === 'counting' ? 'Count' : 'Open'}</Link> · <Link className="text-sm text-brand-600" href={`/print/stock-take/${s._id}`} target="_blank">Sheet</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Start stock take">
        <div className="space-y-3">
          <Field label="Location to count"><Select value={f.locationId || locations[0]?._id} onChange={(e) => setF({ ...f, locationId: e.target.value })}>{locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
          <Field label="Items" hint="Count one category at a time in large stores."><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All items</option>{['drug', 'consumable', 'reagent', 'equipment', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Month-end count, March" /></Field>
          <Alert tone="blue">The system quantity of every batch is frozen on the sheet now. Sales and issues can go on during the count; only the difference you count is applied when the stock take is approved.</Alert>
          <ErrorText error={start.error} />
          <Button onClick={() => start.mutate()} loading={start.isPending}>Start and open count sheet</Button>
        </div>
      </Modal>
    </>
  );
}

function MovementReport({ locations }: { locations: Loc[] }) {
  const [f, setF] = useState({ from: monthStart(), to: today(), locationId: '', category: '' });
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim()) || undefined;
  const q = useQuery({ queryKey: ['movement-report', f, term], queryFn: async () => (await api<MoveRow[]>('/inventory/stock/movement-report', { query: { ...f, locationId: f.locationId || undefined, category: f.category || undefined, q: term } })).data, placeholderData: (prev) => prev });
  const csv = () => {
    const rows = [['Code', 'Item', 'Unit', 'Opening', 'Received', 'Issued', 'Adjusted', 'Closing'], ...(q.data ?? []).map((r) => [r.code, r.name, r.unit, r.opening, r.received, r.issued, r.adjusted, r.closing])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock-movement-${f.from}-to-${f.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const qs = new URLSearchParams([...Object.entries(f), ['q', term ?? '']].filter(([, v]) => v) as Array<[string, string]>).toString();
  return (
    <>
      <SearchInput className="mb-3" value={search} onChange={setSearch} placeholder="Search item name, code, generic or brand" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Location"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All locations</option>{locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All</option>{['drug', 'consumable', 'reagent', 'equipment', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        <div className="flex items-end gap-2">
          <Button variant="outline" onClick={csv} disabled={!q.data?.length}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={() => window.open(`/print/stock-movement?${qs}`, '_blank')}><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </div>
      {q.isLoading ? <Loading /> : (
        <Table head={['Item', 'Opening', 'Received', 'Issued / dispensed', 'Adjusted', 'Closing']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((r) => <tr key={r.itemId}><Td>{r.name}<span className="muted block font-mono text-xs">{r.code} · {r.unit}</span></Td><Td>{r.opening}</Td><Td className="text-emerald-600">{r.received ? `+${r.received}` : 0}</Td><Td className="text-red-600">{r.issued ? `−${r.issued}` : 0}</Td><Td className={r.adjusted < 0 ? 'text-red-600' : r.adjusted > 0 ? 'text-emerald-600' : ''}>{r.adjusted > 0 ? '+' : ''}{r.adjusted}</Td><Td className="font-semibold">{r.closing}</Td></tr>)}
        </Table>
      )}
      <p className="muted mt-2 text-xs">Received includes goods received, transfers in and returns. Issued includes dispensing, counter sales and transfers out. Adjusted includes stock-take variances and expiry write-offs.</p>
    </>
  );
}

function ReorderLpo({ locations }: { locations: Loc[] }) {
  const can = useCan();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim()) || undefined;
  const [picked, setPicked] = useState<Record<string, { quantity: string; unitCost: string }>>({});
  const [f, setF] = useState({ supplierId: '', locationId: '', notes: '' });
  const [created, setCreated] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['reorder', category, term], queryFn: async () => (await api<Reorder[]>('/inventory/stock/reorder-suggestions', { query: { category: category || undefined, q: term } })).data, placeholderData: (prev) => prev });
  const canLpo = can('procurement.manage', 'inventory.manage', 'pharmacy.stock', 'lab.manage');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: async () => (await api<Array<{ _id: string; name: string }>>('/procurement/suppliers')).data, enabled: canLpo });
  const stores = locations.filter((l) => l.type === 'store' || l.type === 'pharmacy' || l.type === 'lab');
  const lines = Object.entries(picked).filter(([, v]) => Number(v.quantity) > 0);
  const total = lines.reduce((s, [, v]) => s + Number(v.quantity) * Number(v.unitCost || 0), 0);
  const lpo = useMutation({
    mutationFn: () => api<{ poNumber: string }>('/procurement/purchase-orders', { method: 'POST', body: { supplierId: f.supplierId, locationId: f.locationId || stores[0]?._id, notes: f.notes || 'Raised from low-stock reorder list', items: lines.map(([itemId, v]) => ({ itemId, quantity: Number(v.quantity), unitCost: Number(v.unitCost || 0) })) } }),
    onSuccess: (r) => { setCreated(r.data.poNumber); setPicked({}); },
  });
  const toggle = (r: Reorder) => setPicked((p) => { const n = { ...p }; if (n[r.itemId]) delete n[r.itemId]; else n[r.itemId] = { quantity: String(r.suggestedQuantity), unitCost: String(r.lastUnitCost || '') }; return n; });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search item name, code or brand" />
        <Field label="Category"><Select className="w-48" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{['drug', 'consumable', 'reagent', 'equipment', 'other'].map((c) => <option key={c} value={c}>{c === 'reagent' ? 'Lab reagents' : c}</option>)}</Select></Field>
        {canLpo && q.data && q.data.length > 0 && <Button size="sm" variant="outline" onClick={() => setPicked(Object.fromEntries(q.data.map((r) => [r.itemId, { quantity: String(r.suggestedQuantity), unitCost: String(r.lastUnitCost || '') }])))}>Select all</Button>}
      </div>
      {created && <Alert tone="green" title={`Purchase order ${created} created`}>It is a draft until a procurement manager approves it. <Link className="underline" href="/procurement">Open procurement</Link></Alert>}
      {q.isLoading ? <Loading /> : (
        <Table head={[canLpo ? '' : ' ', 'Item', 'Usable', 'Reorder level', 'On order', 'Order qty', 'Unit cost']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((r) => {
            const sel = picked[r.itemId];
            return (
              <tr key={r.itemId}>
                <Td>{canLpo && <input type="checkbox" aria-label={`Select ${r.name}`} checked={!!sel} onChange={() => toggle(r)} />}</Td>
                <Td>{r.name}<span className="muted block text-xs">{r.code} · <span className="capitalize">{r.category}</span>{r.packSize > 1 ? ` · ${r.packUnit || 'pack'} of ${r.packSize}` : ''}</span></Td>
                <Td className={r.usable === 0 ? 'font-semibold text-red-600' : 'text-amber-600'}>{r.usable} {r.unit}</Td>
                <Td>{r.reorderLevel}</Td>
                <Td className="text-xs">{r.onOrder.length ? r.onOrder.map((o) => `${o.po}: ${o.quantity}`).join(', ') : '—'}</Td>
                <Td>{sel ? <Input className="w-24" type="number" min={1} value={sel.quantity} onChange={(e) => setPicked({ ...picked, [r.itemId]: { ...sel, quantity: e.target.value } })} /> : r.suggestedQuantity}</Td>
                <Td>{sel ? <Input className="w-24" type="number" min={0} value={sel.unitCost} onChange={(e) => setPicked({ ...picked, [r.itemId]: { ...sel, unitCost: e.target.value } })} /> : money(r.lastUnitCost)}</Td>
              </tr>
            );
          })}
        </Table>
      )}
      {canLpo && lines.length > 0 && (
        <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
          <Field label="Supplier"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Select supplier…</option>{suppliers.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
          <Field label="Deliver to"><Select value={f.locationId || stores[0]?._id} onChange={(e) => setF({ ...f, locationId: e.target.value })}>{stores.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => lpo.mutate()} loading={lpo.isPending} disabled={!f.supplierId}><ShoppingCart className="h-4 w-4" /> Create LPO for {lines.length} item(s) · {money(Math.round(total))}</Button>
            <ErrorText error={lpo.error} />
          </div>
        </div>
      )}
      <p className="muted mt-2 text-xs">Items appear here when usable stock across the selected locations is at or below their reorder level. The suggested quantity tops stock up to twice the reorder level, in whole packs. Set reorder levels on the Items tab of Inventory.</p>
    </>
  );
}

export default function StoresPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('requisitions');
  // Deep links such as /inventory/stores?tab=reorder (from Procurement and Inventory).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && ['requisitions', 'stocktakes', 'movement', 'reorder'].includes(t)) setTab(t);
  }, []);
  const locs = useQuery({ queryKey: ['req-locations'], queryFn: async () => (await api<Loc[]>('/inventory/requisition-locations')).data });
  const seeStock = can('inventory.view', 'inventory.manage', 'pharmacy.stock', 'pharmacy.view');
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'requisitions', label: 'Requisitions' }];
  if (seeStock) tabs.push({ key: 'stocktakes', label: 'Stock takes' }, { key: 'movement', label: 'Stock movement report' });
  if (seeStock || can('lab.manage', 'procurement.view')) tabs.push({ key: 'reorder', label: 'Reorder & LPO' });
  return (
    <>
      <PageHeader title="Stores" subtitle="Request and approve items, count stock, see how it moved and reorder what is running low." crumbs={['Inventory', 'Stores']} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />
      <Card>
        {!locs.data ? <Loading /> : locs.data.length === 0 ? <Alert tone="amber">No stock locations yet. An inventory manager adds them (store, pharmacy, ward, lab) first.</Alert> : (
          <>
            {tab === 'requisitions' && <Requisitions locations={locs.data} />}
            {tab === 'stocktakes' && <StockTakes locations={locs.data} />}
            {tab === 'movement' && <MovementReport locations={locs.data} />}
            {tab === 'reorder' && <ReorderLpo locations={locs.data} />}
          </>
        )}
      </Card>
    </>
  );
}
