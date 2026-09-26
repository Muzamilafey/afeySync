'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Input, KV, Loading, PageHeader, Stat, Table, Td, statusTone } from '@/components/ui';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';

interface StockTakeLine { _id: string; code: string; name: string; unit: string; batchNumber: string; expiryDate: string; systemQuantity: number; countedQuantity?: number | null; unitCost: number; note?: string }
interface StockTake {
  _id: string; takeNumber: string; status: string; category?: string; notes?: string; createdAt: string;
  createdByName?: string; submittedByName?: string; submittedAt?: string; approvedByName?: string; approvedAt?: string;
  location?: { name: string } | null; lines: StockTakeLine[];
}

export default function StockTakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stock-take', id], queryFn: async () => (await api<StockTake>(`/inventory/stock-takes/${id}`)).data });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [saved, setSaved] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['stock-take', id] }); qc.invalidateQueries({ queryKey: ['stock-takes'] }); };
  const save = useMutation({
    mutationFn: (submit: boolean) => api(`/inventory/stock-takes/${id}/counts`, { method: 'PUT', body: { submit, counts: Object.keys({ ...counts, ...notes }).map((lineId) => ({ lineId, countedQuantity: counts[lineId] === undefined ? (q.data?.lines.find((l) => l._id === lineId)?.countedQuantity ?? null) : counts[lineId] === '' ? null : Number(counts[lineId]), note: notes[lineId] })) } }),
    onSuccess: (_, submit) => { setCounts({}); setNotes({}); setSaved(submit ? 'Counts submitted for approval.' : 'Counts saved.'); refresh(); },
  });
  const approve = useMutation({ mutationFn: () => api<{ adjustedLines: number; varianceValue: number }>(`/inventory/stock-takes/${id}/approve`, { method: 'POST' }), onSuccess: (r) => { setSaved(`Approved: ${r.data.adjustedLines} batch(es) adjusted, variance ${money(r.data.varianceValue)}.`); refresh(); } });
  const cancel = useMutation({ mutationFn: () => api(`/inventory/stock-takes/${id}/cancel`, { method: 'POST' }), onSuccess: refresh });

  const st = q.data;
  const value = (l: StockTakeLine) => (counts[l._id] !== undefined ? counts[l._id] : l.countedQuantity != null ? String(l.countedQuantity) : '');
  const totals = useMemo(() => {
    if (!st) return { counted: 0, variance: 0, lines: 0 };
    let counted = 0; let variance = 0; let lines = 0;
    for (const l of st.lines) {
      const v = counts[l._id] !== undefined ? counts[l._id] : l.countedQuantity != null ? String(l.countedQuantity) : '';
      if (v === '') continue;
      counted += 1;
      const d = Number(v) - l.systemQuantity;
      if (d) { lines += 1; variance += d * (l.unitCost || 0); }
    }
    return { counted, variance, lines };
  }, [st, counts]);
  if (!st) return q.error ? <ErrorText error={q.error} /> : <Loading />;
  const counting = st.status === 'counting' && can('inventory.view', 'inventory.manage', 'pharmacy.stock');
  const shown = st.lines.filter((l) => !filter || `${l.name} ${l.code} ${l.batchNumber}`.toLowerCase().includes(filter.toLowerCase()));
  const dirty = Object.keys(counts).length + Object.keys(notes).length > 0;
  return (
    <>
      <PageHeader title={`Stock take ${st.takeNumber}`} crumbs={['Inventory', 'Stores', 'Stock take']} actions={<Button variant="outline" onClick={() => window.open(`/print/stock-take/${st._id}`, '_blank')}><Printer className="h-4 w-4" /> Count sheet</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Lines counted" value={`${totals.counted} / ${st.lines.length}`} />
        <Stat label="Lines with a variance" value={totals.lines} tone={totals.lines ? 'amber' : 'gray'} />
        <Stat label="Variance value" value={money(Math.round(totals.variance))} tone={totals.variance < 0 ? 'red' : 'gray'} />
        <Stat label="Status" value={<Badge tone={statusTone(st.status)}>{st.status}</Badge>} />
      </div>
      <Card>
        <KV items={[['Location', st.location?.name ?? '—'], ['Items', st.category ?? 'All items'], ['Started', `${st.createdByName ?? ''}, ${fmtDateTime(st.createdAt)}`], ['Submitted', st.submittedByName ? `${st.submittedByName}, ${fmtDateTime(st.submittedAt)}` : '—'], ['Approved', st.approvedByName ? `${st.approvedByName}, ${fmtDateTime(st.approvedAt)}` : '—']]} />
        {st.notes && <p className="muted mt-2 text-sm">{st.notes}</p>}
        {saved && <div className="mt-3"><Alert tone="green">{saved}</Alert></div>}
        <div className="my-3 flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder="Find item or batch" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {counting && <Button variant="outline" onClick={() => save.mutate(false)} loading={save.isPending && !save.variables} disabled={!dirty}>Save counts</Button>}
          {counting && <Button onClick={() => confirm('Submit the counts? They can no longer be changed.') && save.mutate(true)} loading={save.isPending && !!save.variables}>Submit for approval</Button>}
          {st.status === 'submitted' && can('inventory.manage') && <Button onClick={() => confirm('Approve? Every variance becomes a stock adjustment.') && approve.mutate()} loading={approve.isPending}>Approve and adjust stock</Button>}
          {['counting', 'submitted'].includes(st.status) && can('inventory.manage', 'pharmacy.stock') && <Button variant="ghost" onClick={() => confirm('Cancel this stock take? No stock will change.') && cancel.mutate()}>Cancel</Button>}
        </div>
        <ErrorText error={save.error ?? approve.error ?? cancel.error} />
        <Table head={['Item', 'Batch', 'Expiry', 'System qty', 'Counted', 'Variance', 'Note']} empty={shown.length === 0}>
          {shown.map((l) => {
            const v = value(l);
            const d = v === '' ? null : Number(v) - l.systemQuantity;
            return (
              <tr key={l._id}>
                <Td>{l.name}<span className="muted block font-mono text-xs">{l.code} · {l.unit}</span></Td>
                <Td className="font-mono text-xs">{l.batchNumber}</Td>
                <Td className={new Date(l.expiryDate) < new Date() ? 'text-red-600' : ''}>{fmtDate(l.expiryDate)}</Td>
                <Td>{l.systemQuantity}</Td>
                <Td>{counting ? <Input className="w-24" type="number" min={0} value={v} onChange={(e) => setCounts({ ...counts, [l._id]: e.target.value })} /> : (l.countedQuantity ?? '—')}</Td>
                <Td className={d ? (d < 0 ? 'font-semibold text-red-600' : 'font-semibold text-emerald-600') : 'muted'}>{d == null ? '—' : d > 0 ? `+${d}` : d}</Td>
                <Td>{counting ? <Input className="w-40" placeholder="e.g. damaged" value={notes[l._id] ?? l.note ?? ''} onChange={(e) => setNotes({ ...notes, [l._id]: e.target.value })} /> : <span className="text-xs">{l.note}</span>}</Td>
              </tr>
            );
          })}
        </Table>
        {st.status === 'submitted' && <p className="muted mt-2 text-xs">The person who submitted the counts cannot approve them.</p>}
      </Card>
    </>
  );
}
