'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, statusTone, Table, Tabs, Td } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { ItemPicker } from '@/features/pharmacy/ItemPicker';
import type { Item, Location } from '@/features/pharmacy/types';

interface Supplier { _id: string; name: string; contactPerson?: string; phone?: string; email?: string; kraPin?: string; active: boolean }
interface PO { _id: string; poNumber: string; status: string; total: number; createdAt: string; supplierId: { name: string }; locationId: { name: string }; items: Array<{ itemId: string; itemName: string; quantity: number; unitCost: number; receivedQuantity: number }> }

export default function ProcurementPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pos' | 'suppliers'>('pos');
  const [modal, setModal] = useState<'po' | 'supplier' | null>(null);
  const [grn, setGrn] = useState<PO | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: async () => (await api<Supplier[]>('/procurement/suppliers', { query: { all: 'true' } })).data });
  const pos = useQuery({ queryKey: ['pos'], queryFn: async () => (await api<PO[]>('/procurement/purchase-orders', { query: { limit: 100 } })).data });
  const locs = useQuery({ queryKey: ['locations'], queryFn: async () => (await api<Location[]>('/pharmacy/locations')).data });
  const [sup, setSup] = useState({ name: '', contactPerson: '', phone: '', email: '', kraPin: '' });
  const [po, setPo] = useState<{ supplierId: string; locationId: string; lines: Array<{ item: Item; quantity: string; unitCost: string }>; notes: string }>({ supplierId: '', locationId: '', lines: [], notes: '' });
  const [grnLines, setGrnLines] = useState<Record<string, { batchNumber: string; expiryDate: string; quantity: string }>>({});
  const [deliveryNote, setDeliveryNote] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['pos'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); setModal(null); setGrn(null); };
  const createSup = useMutation({ mutationFn: () => api('/procurement/suppliers', { method: 'POST', body: { ...sup, email: sup.email || undefined } }), onSuccess: refresh });
  const createPo = useMutation({ mutationFn: () => api('/procurement/purchase-orders', { method: 'POST', body: { supplierId: po.supplierId, locationId: po.locationId || locs.data?.[0]?._id, notes: po.notes || undefined, items: po.lines.map((l) => ({ itemId: l.item._id, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) } }), onSuccess: refresh });
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api(`/procurement/purchase-orders/${id}/${action}`, { method: 'POST' }), onSuccess: refresh });
  const receive = useMutation({ mutationFn: () => api(`/procurement/purchase-orders/${grn!._id}/receive`, { method: 'POST', body: { deliveryNote: deliveryNote || undefined, lines: Object.entries(grnLines).filter(([, l]) => l.quantity && l.batchNumber && l.expiryDate).map(([itemId, l]) => ({ itemId, batchNumber: l.batchNumber, expiryDate: l.expiryDate, quantity: Number(l.quantity) })) } }), onSuccess: refresh });
  return (
    <>
      <PageHeader title="Procurement" crumbs={['Procurement']} actions={can('procurement.manage') && (tab === 'pos' ? <Button onClick={() => setModal('po')}><Plus className="h-4 w-4" /> Purchase order</Button> : <Button onClick={() => setModal('supplier')}><Plus className="h-4 w-4" /> Supplier</Button>)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pos', label: 'Purchase orders' }, { key: 'suppliers', label: 'Suppliers' }]} />
      <ErrorText error={act.error} />
      <Card>
        {tab === 'pos' && (pos.isLoading ? <Loading /> : (
          <Table head={['PO', 'Supplier', 'Deliver to', 'Items', 'Total', 'Status', '']} empty={(pos.data ?? []).length === 0}>
            {pos.data?.map((p) => (
              <tr key={p._id}>
                <Td className="font-mono text-xs">{p.poNumber}<span className="muted block">{fmtDateTime(p.createdAt)}</span></Td>
                <Td>{p.supplierId?.name}</Td><Td>{p.locationId?.name}</Td>
                <Td className="text-xs">{p.items.map((i) => <span key={i.itemId} className="block">{i.itemName}: {i.receivedQuantity}/{i.quantity}</span>)}</Td>
                <Td>{money(p.total)}</Td>
                <Td><Badge tone={statusTone(p.status === 'received' ? 'completed' : p.status === 'cancelled' ? 'failed' : 'pending')}>{p.status.replace('_', ' ')}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {p.status === 'draft' && can('procurement.manage') && <><Button size="sm" onClick={() => act.mutate({ id: p._id, action: 'approve' })}>Approve</Button> <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: p._id, action: 'cancel' })}>Cancel</Button></>}
                  {['approved', 'partially_received'].includes(p.status) && can('procurement.manage', 'inventory.manage', 'pharmacy.stock') && <Button size="sm" onClick={() => { setGrn(p); setGrnLines({}); }}>Receive (GRN)</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        ))}
        {tab === 'suppliers' && (
          <Table head={['Supplier', 'Contact', 'Phone', 'Email', 'KRA PIN', 'Status']}>
            {suppliers.data?.map((s) => <tr key={s._id}><Td className="font-medium">{s.name}</Td><Td>{s.contactPerson}</Td><Td>{s.phone}</Td><Td>{s.email}</Td><Td>{s.kraPin}</Td><Td><Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'active' : 'inactive'}</Badge></Td></tr>)}
          </Table>
        )}
      </Card>
      <Modal open={modal === 'supplier'} onClose={() => setModal(null)} title="New supplier">
        <div className="space-y-3">
          {(['name', 'contactPerson', 'phone', 'email', 'kraPin'] as const).map((k) => <Field key={k} label={k}><Input value={sup[k]} onChange={(e) => setSup({ ...sup, [k]: e.target.value })} /></Field>)}
          <ErrorText error={createSup.error} />
          <Button onClick={() => createSup.mutate()} loading={createSup.isPending}>Save</Button>
        </div>
      </Modal>
      <Modal open={modal === 'po'} onClose={() => setModal(null)} title="New purchase order" wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier"><Select value={po.supplierId} onChange={(e) => setPo({ ...po, supplierId: e.target.value })}><option value="">Select…</option>{suppliers.data?.filter((s) => s.active).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
            <Field label="Deliver to"><Select value={po.locationId} onChange={(e) => setPo({ ...po, locationId: e.target.value })}>{locs.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select></Field>
          </div>
          <ItemPicker onPick={(item) => setPo({ ...po, lines: [...po.lines, { item, quantity: '', unitCost: '' }] })} placeholder="Add item" />
          {po.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_120px_auto] gap-2">
              <span className="text-sm">{l.item.name}</span>
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} />
              <Input placeholder="Unit cost" type="number" value={l.unitCost} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)) })} />
              <Button variant="ghost" onClick={() => setPo({ ...po, lines: po.lines.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <p className="text-right text-sm font-semibold">Total {money(po.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0))}</p>
          <ErrorText error={createPo.error} />
          <Button onClick={() => createPo.mutate()} loading={createPo.isPending} disabled={!po.supplierId || !po.lines.length}>Create draft PO</Button>
          <p className="muted text-xs">Purchase orders must be approved by someone other than their author.</p>
        </div>
      </Modal>
      <Modal open={!!grn} onClose={() => setGrn(null)} title={`Goods received — ${grn?.poNumber}`} wide>
        <div className="space-y-3">
          <Field label="Delivery note"><Input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} /></Field>
          {grn?.items.map((i) => (
            <div key={i.itemId} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_100px]">
              <span className="text-sm">{i.itemName} <span className="muted text-xs">({i.receivedQuantity}/{i.quantity})</span></span>
              <Input placeholder="Batch" value={grnLines[i.itemId]?.batchNumber ?? ''} onChange={(e) => setGrnLines({ ...grnLines, [i.itemId]: { ...(grnLines[i.itemId] ?? { expiryDate: '', quantity: '' }), batchNumber: e.target.value } })} />
              <Input type="date" value={grnLines[i.itemId]?.expiryDate ?? ''} onChange={(e) => setGrnLines({ ...grnLines, [i.itemId]: { ...(grnLines[i.itemId] ?? { batchNumber: '', quantity: '' }), expiryDate: e.target.value } })} />
              <Input type="number" placeholder="Qty" max={i.quantity - i.receivedQuantity} value={grnLines[i.itemId]?.quantity ?? ''} onChange={(e) => setGrnLines({ ...grnLines, [i.itemId]: { ...(grnLines[i.itemId] ?? { batchNumber: '', expiryDate: '' }), quantity: e.target.value } })} />
            </div>
          ))}
          <ErrorText error={receive.error} />
          <Button onClick={() => receive.mutate()} loading={receive.isPending}>Receive</Button>
        </div>
      </Modal>
    </>
  );
}
