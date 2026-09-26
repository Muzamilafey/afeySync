'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FileSpreadsheet } from 'lucide-react';
import { ExcelImport } from '@/features/imports/ExcelImport';
import { DOSAGE_FORMS, STOCK_UNITS } from '@/features/pharmacy/dosageForms';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Td } from '@/components/ui';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';
import { ItemPicker } from '@/features/pharmacy/ItemPicker';
import { STANDARD_LISTS } from '@/features/billing/types';
import type { Batch, Item, Location } from '@/features/pharmacy/types';

type Tab = 'summary' | 'batches' | 'expiring' | 'movements' | 'items';
interface Row { _id: string; code: string; name: string; unit: string; category: string; reorderLevel: number; onHand: number; usable: number; expired: number; value: number; nearestExpiry?: string; lowStock: boolean }

function ReceiveForm({ locations, onDone }: { locations: Location[]; onDone: () => void }) {
  const [loc, setLoc] = useState(locations[0]?._id ?? '');
  const [ref, setRef] = useState('');
  const [lines, setLines] = useState<Array<{ item: Item; batchNumber: string; expiryDate: string; quantity: string; unitCost: string; inPacks?: boolean }>>([]);
  // Entered in packs (e.g. boxes of 100): stock is still kept in single units.
  const units = (l: (typeof lines)[number]) => (l.inPacks ? Number(l.quantity) * (l.item.packSize ?? 1) : Number(l.quantity));
  const unitCost = (l: (typeof lines)[number]) => (l.inPacks ? Number(l.unitCost || 0) / (l.item.packSize ?? 1) : Number(l.unitCost || 0));
  const m = useMutation({ mutationFn: () => api('/pharmacy/stock/receive', { method: 'POST', body: { locationId: loc, reference: ref || undefined, lines: lines.map((l) => ({ itemId: l.item._id, batchNumber: l.batchNumber, expiryDate: l.expiryDate, quantity: units(l), unitCost: Math.round(unitCost(l) * 100) / 100 })) } }), onSuccess: onDone });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location"><Select value={loc} onChange={(e) => setLoc(e.target.value)}>{locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
        <Field label="Reference (invoice / delivery note)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <ItemPicker onPick={(item) => setLines([...lines, { item, batchNumber: '', expiryDate: '', quantity: '', unitCost: '' }])} placeholder="Add item" />
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_90px_90px_auto]">
          <span className="text-sm">
            {l.item.name}
            {(l.item.packSize ?? 1) > 1 && (
              <label className="muted mt-1 flex items-center gap-1 text-xs"><input type="checkbox" checked={!!l.inPacks} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, inPacks: e.target.checked } : x)))} /> In {l.item.packUnit || 'packs'} of {l.item.packSize}{l.inPacks && l.quantity ? ` = ${units(l)} ${l.item.unit}` : ''}</label>
            )}
          </span>
          <Input placeholder="Batch" value={l.batchNumber} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batchNumber: e.target.value } : x)))} />
          <Input type="date" value={l.expiryDate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, expiryDate: e.target.value } : x)))} />
          <Input placeholder={l.inPacks ? `No. of ${l.item.packUnit || 'packs'}` : 'Qty'} type="number" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          <Input placeholder={l.inPacks ? 'Cost per pack' : 'Unit cost'} type="number" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} />
          <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!lines.length || lines.some((l) => !l.batchNumber || !l.expiryDate || !l.quantity)}>Receive stock</Button>
    </div>
  );
}

function ItemForm({ item, onDone }: { item?: Item; onDone: () => void }) {
  const can = useCan();
  const canPrice = can('billing.prices');
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(STANDARD_LISTS.map(([k]) => [k, item?.prices?.[k] != null ? String(item.prices[k]) : ''])));
  // Only lists that were changed are sent; clearing a price removes it (that list then bills at the cash price).
  const priceBody = () => {
    const out: Record<string, number | null> = {};
    for (const [k] of STANDARD_LISTS) {
      const before = item?.prices?.[k] != null ? String(item.prices[k]) : '';
      if (prices[k] !== before) out[k] = prices[k] === '' ? null : Number(prices[k]);
    }
    return canPrice && Object.keys(out).length ? out : undefined;
  };
  const [f, setF] = useState({ code: item?.code ?? '', name: item?.name ?? '', genericName: item?.genericName ?? '', form: item?.form ?? '', strength: item?.strength ?? '', unit: item?.unit ?? 'unit', category: item?.category ?? 'drug', reorderLevel: item?.reorderLevel ?? 0, serviceCode: item?.serviceCode ?? '', controlled: item?.controlled ?? false, brand: item?.brand ?? '', manufacturer: item?.manufacturer ?? '', packUnit: item?.packUnit ?? '', packSize: item?.packSize ?? 1, barcode: item?.barcode ?? '' });
  const formIsListed = DOSAGE_FORMS.some((d) => d.form === f.form);
  const m = useMutation({ mutationFn: () => { const body = { ...f, prices: priceBody(), genericName: f.genericName || undefined, form: f.form.trim() || undefined, unit: f.unit.trim() || 'unit', strength: f.strength || undefined, serviceCode: f.serviceCode || undefined, brand: f.brand.trim() || undefined, manufacturer: f.manufacturer.trim() || undefined, packUnit: f.packUnit.trim() || undefined, packSize: Math.max(1, Math.floor(Number(f.packSize) || 1)), barcode: f.barcode.trim() || undefined }; return item ? api(`/pharmacy/items/${item._id}`, { method: 'PATCH', body: { ...body, code: undefined } }) : api('/pharmacy/items', { method: 'POST', body }); }, onSuccess: onDone });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Code"><Input value={f.code} disabled={!!item} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Generic name"><Input value={f.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} /></Field>
      <Field label="Form">
        <Select
          value={formIsListed ? f.form : f.form ? '__other' : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__other') return setF({ ...f, form: formIsListed || !f.form ? ' ' : f.form });
            const hit = DOSAGE_FORMS.find((d) => d.form === v);
            // Suggest the usual stock unit while the unit has not been chosen yet.
            setF({ ...f, form: v, unit: hit && (f.unit === 'unit' || DOSAGE_FORMS.some((d) => d.unit === f.unit)) ? hit.unit : f.unit });
          }}
        >
          <option value="">Select form…</option>
          {DOSAGE_FORMS.map((d) => <option key={d.form} value={d.form}>{d.form}</option>)}
          <option value="__other">Other…</option>
        </Select>
        {!formIsListed && !!f.form && <Input className="mt-2" autoFocus placeholder="Type the form" value={f.form.trim()} onChange={(e) => setF({ ...f, form: e.target.value || ' ' })} />}
      </Field>
      <Field label="Strength"><Input value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} /></Field>
      <Field label="Unit" hint="How stock is counted.">
        <Select value={STOCK_UNITS.includes(f.unit) ? f.unit : '__other'} onChange={(e) => setF({ ...f, unit: e.target.value === '__other' ? '' : e.target.value })}>
          {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          <option value="__other">Other…</option>
        </Select>
        {!STOCK_UNITS.includes(f.unit) && <Input className="mt-2" placeholder="Type the unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />}
      </Field>
      <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['drug', 'consumable', 'reagent', 'equipment', 'other'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Brand / trade name"><Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} placeholder="e.g. Panadol" /></Field>
      <Field label="Manufacturer"><Input value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} placeholder="e.g. GSK" /></Field>
      <Field label="Bought in (pack)" hint={f.packUnit ? `1 ${f.packUnit} = ${f.packSize || 1} ${f.unit || 'unit'}` : 'e.g. box, bottle, strip'}><Input value={f.packUnit} onChange={(e) => setF({ ...f, packUnit: e.target.value })} /></Field>
      <Field label="Units per pack"><Input type="number" min={1} value={f.packSize} onChange={(e) => setF({ ...f, packSize: Number(e.target.value) })} /></Field>
      <Field label="Barcode" hint="Scan it here to save; the POS finds the item by scanning."><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() })} /></Field>
      <Field label="Reorder level"><Input type="number" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: Number(e.target.value) })} /></Field>
      <Field label="Billing service code" hint="Defaults to RX-<code>"><Input value={f.serviceCode} onChange={(e) => setF({ ...f, serviceCode: e.target.value.toUpperCase() })} /></Field>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.controlled} onChange={(e) => setF({ ...f, controlled: e.target.checked })} /> Controlled drug</label>
      {canPrice ? (
        <div className="col-span-full space-y-2 rounded-lg border border-[var(--border)] p-3">
          <p className="label">Selling price per {f.unit || 'unit'} (KES)</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {STANDARD_LISTS.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint}><Input type="number" min={0} step="0.01" value={prices[k]} placeholder={k === 'cash' ? 'Required' : 'Blank = cash'} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <p className="muted text-xs">Charged when the item is dispensed. Kept in Services &amp; Prices under {(f.serviceCode || `RX-${f.code || '<code>'}`).toUpperCase()}. Stock comes from receiving batches (Receive), not from this form.</p>
        </div>
      ) : (
        <p className="muted col-span-full text-xs">Selling prices are set by staff who manage prices (Services &amp; Prices).</p>
      )}
      <div className="col-span-full space-y-2"><ErrorText error={m.error} /><Button onClick={() => m.mutate()} loading={m.isPending} disabled={canPrice && prices.cash === '' && Object.values(prices).some((v) => v !== '')}>Save</Button></div>
    </div>
  );
}

export default function InventoryPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('summary');
  const [loc, setLoc] = useState('');
  const [modal, setModal] = useState<'receive' | 'transfer' | 'adjust' | 'item' | null>(null);
  const [editItem, setEditItem] = useState<Item | undefined>();
  const [importing, setImporting] = useState(false);
  const [adj, setAdj] = useState<{ batch?: Batch; delta: string; reason: string; type: string }>({ delta: '', reason: '', type: 'adjustment' });
  const [trf, setTrf] = useState<{ item?: Item; to: string; qty: string }>({ to: '', qty: '' });
  const locs = useQuery({ queryKey: ['locations'], queryFn: async () => (await api<Location[]>('/pharmacy/locations')).data });
  const location = loc || locs.data?.[0]?._id || '';
  const summary = useQuery({ queryKey: ['stock-summary', location], queryFn: () => api<Row[]>('/pharmacy/stock/summary', { query: { locationId: location } }), enabled: !!location && tab === 'summary' });
  const batches = useQuery({ queryKey: ['batches', location], queryFn: async () => (await api<Batch[]>('/pharmacy/stock', { query: { locationId: location } })).data, enabled: !!location && tab === 'batches' });
  const expiring = useQuery({ queryKey: ['expiring'], queryFn: async () => (await api<Batch[]>('/pharmacy/stock/expiring', { query: { days: 90 } })).data, enabled: tab === 'expiring' });
  const moves = useQuery({ queryKey: ['movements'], queryFn: async () => (await api<Array<{ _id: string; type: string; quantity: number; reference?: string; reason?: string; createdAt: string; itemId: { name: string } }>>('/pharmacy/stock/movements', { query: { limit: 100 } })).data, enabled: tab === 'movements' });
  const items = useQuery({ queryKey: ['items-admin'], queryFn: async () => (await api<Item[]>('/pharmacy/items', { query: { all: 'true', limit: 500 } })).data, enabled: tab === 'items' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['stock-summary'] }); qc.invalidateQueries({ queryKey: ['batches'] }); qc.invalidateQueries({ queryKey: ['expiring'] }); qc.invalidateQueries({ queryKey: ['items-admin'] }); setModal(null); };
  const adjust = useMutation({ mutationFn: () => api('/pharmacy/stock/adjust', { method: 'POST', body: { batchId: adj.batch!._id, quantityDelta: Number(adj.delta), reason: adj.reason, type: adj.type } }), onSuccess: refresh });
  const transfer = useMutation({ mutationFn: () => api('/pharmacy/stock/transfer', { method: 'POST', body: { fromLocationId: location, toLocationId: trf.to, itemId: trf.item!._id, quantity: Number(trf.qty) } }), onSuccess: refresh });
  const write = can('pharmacy.stock', 'inventory.manage');
  return (
    <>
      <PageHeader title="Inventory" crumbs={['Inventory', 'Stock']} actions={<>
        <Select className="w-56" value={location} onChange={(e) => setLoc(e.target.value)}>{locs.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
        {write && <Button onClick={() => setModal('receive')}><Plus className="h-4 w-4" /> Receive</Button>}
        {write && <Button variant="outline" onClick={() => setModal('transfer')}>Transfer</Button>}
        <Link href="/inventory/stores"><Button variant="outline">Stores &amp; stock take</Button></Link>
      </>} />
      {summary.data && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Stat label="Stock value" value={money(Number(summary.data.meta?.totalValue ?? 0))} />
          <Stat label="Low stock items" value={Number(summary.data.meta?.lowStock ?? 0)} tone="amber" />
          <Stat label="Items with expired stock" value={summary.data.data.filter((r) => r.expired > 0).length} tone="red" />
        </div>
      )}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'summary', label: 'Stock on hand' }, { key: 'batches', label: 'Batches' }, { key: 'expiring', label: 'Expiring (90d)' }, { key: 'movements', label: 'Ledger' }, { key: 'items', label: 'Items' }]} />
      <Card>
        {tab === 'summary' && (summary.isLoading ? <Loading /> : (
          <Table head={['Item', 'Category', 'Usable', 'Expired', 'Reorder', 'Nearest expiry', 'Value']} empty={(summary.data?.data ?? []).length === 0}>
            {summary.data?.data.map((r) => <tr key={r._id}><Td className="font-medium">{r.name}<span className="muted block font-mono text-xs">{r.code}</span></Td><Td className="capitalize">{r.category}</Td><Td>{r.usable} {r.unit} {r.lowStock && r.reorderLevel > 0 && <Badge tone="amber">low</Badge>}</Td><Td className={r.expired ? 'text-red-600' : ''}>{r.expired || '—'}</Td><Td>{r.reorderLevel}</Td><Td>{fmtDate(r.nearestExpiry)}</Td><Td>{money(r.value)}</Td></tr>)}
          </Table>
        ))}
        {tab === 'batches' && (
          <Table head={['Item', 'Batch', 'Expiry', 'Qty', 'Unit cost', '']} empty={(batches.data ?? []).length === 0}>
            {batches.data?.map((b) => { const it = typeof b.itemId === 'object' ? b.itemId : null; const expired = new Date(b.expiryDate) < new Date(); return <tr key={b._id}><Td>{it?.name}</Td><Td className="font-mono text-xs">{b.batchNumber}</Td><Td className={expired ? 'font-semibold text-red-600' : ''}>{fmtDate(b.expiryDate)}{expired && ' (expired)'}</Td><Td>{b.quantity}</Td><Td>{money(b.unitCost)}</Td><Td>{can('inventory.manage') && <Button size="sm" variant="ghost" onClick={() => { setAdj({ batch: b, delta: expired ? String(-b.quantity) : '', reason: expired ? 'Expired stock write-off' : '', type: expired ? 'expiry_writeoff' : 'adjustment' }); setModal('adjust'); }}>{expired ? 'Write off' : 'Adjust'}</Button>}</Td></tr>; })}
          </Table>
        )}
        {tab === 'expiring' && (
          <Table head={['Item', 'Location', 'Batch', 'Expiry', 'Qty']} empty={(expiring.data ?? []).length === 0}>
            {expiring.data?.map((b) => <tr key={b._id}><Td>{typeof b.itemId === 'object' ? b.itemId.name : ''}</Td><Td>{b.locationId?.name}</Td><Td className="font-mono text-xs">{b.batchNumber}</Td><Td className={new Date(b.expiryDate) < new Date() ? 'text-red-600' : 'text-amber-600'}>{fmtDate(b.expiryDate)}</Td><Td>{b.quantity}</Td></tr>)}
          </Table>
        )}
        {tab === 'movements' && (
          <Table head={['Time', 'Item', 'Type', 'Qty', 'Reference', 'Reason']} empty={(moves.data ?? []).length === 0}>
            {moves.data?.map((mv) => <tr key={mv._id}><Td>{fmtDateTime(mv.createdAt)}</Td><Td>{mv.itemId?.name}</Td><Td><Badge>{mv.type.replace('_', ' ')}</Badge></Td><Td className={mv.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}>{mv.quantity > 0 ? '+' : ''}{mv.quantity}</Td><Td className="font-mono text-xs">{mv.reference}</Td><Td className="text-xs">{mv.reason}</Td></tr>)}
          </Table>
        )}
        {tab === 'items' && (
          <>
            {write && (
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { setEditItem(undefined); setModal('item'); }}><Plus className="h-3 w-3" /> New item</Button>
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="h-3 w-3" /> Import from Excel</Button>
              </div>
            )}
            <Table head={['Code', 'Item', 'Form / strength', 'Category', 'Stock (usable)', 'Price', 'Reorder', 'Status', '']}>
              {items.data?.map((i) => <tr key={i._id}><Td className="font-mono text-xs">{i.code}</Td><Td>{i.name}<span className="muted block text-xs">{[i.genericName, i.brand, i.manufacturer].filter(Boolean).join(' · ')}{i.packUnit ? ` · ${i.packUnit} of ${i.packSize}` : ''}</span></Td><Td>{i.form} {i.strength}</Td><Td className="capitalize">{i.category}{i.controlled && <Badge tone="red" className="ml-1">controlled</Badge>}</Td><Td><span className={(i.stock?.usable ?? 0) === 0 ? 'font-semibold text-red-600' : (i.stock?.usable ?? 0) <= i.reorderLevel ? 'font-semibold text-amber-600' : ''}>{i.stock?.usable ?? 0} {i.unit}</span>{(i.stock?.expired ?? 0) > 0 && <span className="block text-xs text-red-600">{i.stock!.expired} expired</span>}</Td><Td className="text-xs">{i.prices?.cash != null ? STANDARD_LISTS.filter(([k]) => i.prices?.[k] != null).map(([k, label]) => <span key={k} className="block whitespace-nowrap"><span className="muted">{label.split(' ')[0]}:</span> {money(i.prices![k]!)}</span>) : <Badge tone="amber">no price</Badge>}</Td><Td>{i.reorderLevel}</Td><Td><Badge tone={i.active ? 'green' : 'gray'}>{i.active ? 'active' : 'inactive'}</Badge></Td><Td>{write && <Button size="sm" variant="ghost" onClick={() => { setEditItem(i); setModal('item'); }}>Edit</Button>}</Td></tr>)}
            </Table>
          </>
        )}
      </Card>
      <ExcelImport open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['items-admin'] })} title="Import inventory items from Excel" noun="items" templatePath="/inventory/items/import-template" templateName="inventory-items-template.xlsx" importPath="/inventory/items/import" />
      <Modal open={modal === 'receive'} onClose={() => setModal(null)} title="Receive stock" wide>{locs.data && <ReceiveForm locations={locs.data} onDone={refresh} />}</Modal>
      <Modal open={modal === 'item'} onClose={() => setModal(null)} title={editItem ? 'Edit item' : 'New item'} wide><ItemForm item={editItem} onDone={refresh} /></Modal>
      <Modal open={modal === 'adjust'} onClose={() => setModal(null)} title={`${adj.type === 'expiry_writeoff' ? 'Write off' : 'Adjust'} batch ${adj.batch?.batchNumber}`}>
        <div className="space-y-3">
          <Field label="Quantity change (+/-)"><Input type="number" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} /></Field>
          <Field label="Reason (audited)"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
          <ErrorText error={adjust.error} />
          <Button onClick={() => adjust.mutate()} loading={adjust.isPending} disabled={!adj.delta || adj.reason.length < 5}>Save</Button>
        </div>
      </Modal>
      <Modal open={modal === 'transfer'} onClose={() => setModal(null)} title="Transfer stock (FEFO)">
        <div className="space-y-3">
          {trf.item ? <p className="text-sm">{trf.item.name} <button className="text-xs text-brand-600" onClick={() => setTrf({ ...trf, item: undefined })}>change</button></p> : <ItemPicker onPick={(i) => setTrf({ ...trf, item: i })} />}
          <Field label="To location"><Select value={trf.to} onChange={(e) => setTrf({ ...trf, to: e.target.value })}><option value="">Select…</option>{locs.data?.filter((l) => l._id !== location).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
          <Field label="Quantity"><Input type="number" value={trf.qty} onChange={(e) => setTrf({ ...trf, qty: e.target.value })} /></Field>
          <ErrorText error={transfer.error} />
          <Button onClick={() => transfer.mutate()} loading={transfer.isPending} disabled={!trf.item || !trf.to || !trf.qty}>Transfer</Button>
        </div>
      </Modal>
    </>
  );
}
