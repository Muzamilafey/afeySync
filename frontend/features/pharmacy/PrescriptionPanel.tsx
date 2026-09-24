'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Input, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { ItemPicker } from './ItemPicker';
import type { Prescription } from './types';

interface Line { itemId?: string; drugName: string; dose: string; frequency: string; route: string; durationDays: string; quantity: string; instructions: string; stock?: number }
const blank = (): Line => ({ drugName: '', dose: '', frequency: '', route: 'PO', durationDays: '', quantity: '', instructions: '' });

export function PrescriptionPanel({ visitId, admissionId, patientId, open }: { visitId?: string; admissionId?: string; patientId: string; open: boolean }) {
  void patientId;
  const can = useCan();
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [override, setOverride] = useState('');
  const list = useQuery({ queryKey: ['rx', visitId ?? admissionId], queryFn: async () => (await api<Prescription[]>('/pharmacy/prescriptions', { query: { visitId, admissionId } })).data, enabled: can('pharmacy.view', 'prescription.create', 'nursing.view') });
  const m = useMutation({
    mutationFn: () => api('/pharmacy/prescriptions', { method: 'POST', body: { visitId, admissionId, overrideAllergy: override ? { reason: override } : undefined, items: lines.map((l) => ({ itemId: l.itemId, drugName: l.drugName, dose: l.dose || undefined, frequency: l.frequency || undefined, route: l.route || undefined, durationDays: l.durationDays ? Number(l.durationDays) : undefined, quantity: Number(l.quantity), instructions: l.instructions || undefined })) } }),
    onSuccess: () => { setLines([]); setOverride(''); qc.invalidateQueries({ queryKey: ['rx', visitId ?? admissionId] }); },
  });
  const allergy = m.error instanceof ApiError && m.error.code === 'ALLERGY_ALERT';
  const up = (i: number, p: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Card title={<span className="flex items-center gap-2"><Pill className="h-4 w-4" /> Prescriptions</span>}>
      {open && can('prescription.create') && (
        <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
          <ItemPicker onPick={(i) => setLines([...lines, { ...blank(), itemId: i._id, drugName: `${i.name}${i.strength ? ` ${i.strength}` : ''}`, stock: i.stock?.usable }])} placeholder="Add drug from formulary (shows stock)" />
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 rounded border border-[var(--border)] p-2 sm:grid-cols-[1.6fr_repeat(5,1fr)_auto]">
              <div className="text-sm font-medium">{l.drugName}<span className={`block text-xs ${(l.stock ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{l.stock ?? 0} in stock</span></div>
              <Input placeholder="Dose" value={l.dose} onChange={(e) => up(i, { dose: e.target.value })} />
              <Input placeholder="Freq (TDS)" value={l.frequency} onChange={(e) => up(i, { frequency: e.target.value })} />
              <Input placeholder="Route" value={l.route} onChange={(e) => up(i, { route: e.target.value })} />
              <Input placeholder="Days" type="number" value={l.durationDays} onChange={(e) => up(i, { durationDays: e.target.value })} />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => up(i, { quantity: e.target.value })} />
              <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              <Input className="sm:col-span-7" placeholder="Instructions" value={l.instructions} onChange={(e) => up(i, { instructions: e.target.value })} />
            </div>
          ))}
          {allergy && (
            <Alert tone="red" title="ALLERGY ALERT">
              {(m.error as ApiError).message}
              <Input className="mt-2" placeholder="Override reason (documented and audited)" value={override} onChange={(e) => setOverride(e.target.value)} />
            </Alert>
          )}
          {!allergy && <ErrorText error={m.error} />}
          {lines.length > 0 && <Button onClick={() => m.mutate()} loading={m.isPending} disabled={lines.some((l) => !l.quantity) || (allergy && override.length < 5)}>{allergy ? 'Override & prescribe' : 'Prescribe'}</Button>}
        </div>
      )}
      {(list.data ?? []).length === 0 && <p className="muted text-sm">No prescriptions.</p>}
      {list.data?.map((rx) => (
        <div key={rx._id} className="mb-3">
          <p className="mb-1 flex justify-between text-xs"><span className="font-mono">{rx.rxNumber} · {rx.prescriberName} · {fmtDateTime(rx.createdAt)}</span><Badge tone={statusTone(rx.status === 'dispensed' ? 'completed' : rx.status === 'cancelled' ? 'failed' : 'pending')}>{rx.status.replace('_', ' ')}</Badge></p>
          <Table head={['Drug', 'Dose', 'Freq', 'Days', 'Qty', 'Dispensed']}>
            {rx.items.map((i) => <tr key={i._id} className={i.status === 'cancelled' ? 'line-through opacity-50' : ''}><Td>{i.drugName}<span className="muted block text-xs">{i.instructions}</span></Td><Td>{i.dose}</Td><Td>{i.frequency}</Td><Td>{i.durationDays}</Td><Td>{i.quantity}</Td><Td>{i.dispensedQuantity}</Td></tr>)}
          </Table>
        </div>
      ))}
    </Card>
  );
}
