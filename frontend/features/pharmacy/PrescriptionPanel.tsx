'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Input, Select, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { ItemPicker } from './ItemPicker';
import { EPrescriptionControls } from './EPrescriptionControls';
import { DosePicker } from './DosePicker';
import { DAY_OPTIONS, defaultsForForm, FREQUENCIES, INSTRUCTIONS, ROUTES, suggestQuantity } from './dosing';
import type { Prescription } from './types';

interface Line { itemId?: string; drugName: string; form?: string; strength?: string; stockUnit?: string; amount: number | ''; unit: string; frequency: string; route: string; days: number | ''; quantity: string; qtyEdited: boolean; tags: string[]; note: string; stock?: number }

/** Recomputes the quantity from dose × frequency × days unless the prescriber set it by hand. */
function withQuantity(l: Line): Line {
  if (l.qtyEdited) return l;
  const q = l.amount === '' ? null : suggestQuantity({ amount: l.amount, unit: l.unit, frequency: l.frequency, days: l.days === '' ? 0 : l.days, strength: l.strength, form: l.form });
  return { ...l, quantity: q ? String(q) : l.quantity };
}

/** What is still missing or wrong on a line (the server checks the same). */
function lineProblems(l: Line) {
  const p: string[] = [];
  if (l.amount === '' || !(l.amount > 0)) p.push('choose a dose');
  if (!l.frequency) p.push('choose how often');
  if (!l.route) p.push('choose a route');
  if (l.frequency !== 'STAT' && l.days === '') p.push('choose for how many days');
  const q = Number(l.quantity);
  if (!l.quantity || !Number.isInteger(q) || q < 1) p.push('quantity must be a whole number of 1 or more');
  else if (q > 100_000) p.push('quantity is too large');
  return p;
}

export function PrescriptionPanel({ visitId, admissionId, patientId, open }: { visitId?: string; admissionId?: string; patientId: string; open: boolean }) {
  void patientId;
  const can = useCan();
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [override, setOverride] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const receive = useMutation({ mutationFn: (rxId: string) => api(`/pharmacy/prescriptions/${rxId}/receive`, { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rx', visitId ?? admissionId] }) });
  const list = useQuery({ queryKey: ['rx', visitId ?? admissionId], queryFn: async () => (await api<Prescription[]>('/pharmacy/prescriptions', { query: { visitId, admissionId } })).data, enabled: can('pharmacy.view', 'prescription.create', 'nursing.view') });
  const m = useMutation({
    mutationFn: () => api('/pharmacy/prescriptions', { method: 'POST', body: { visitId, admissionId, urgency: admissionId ? urgency : undefined, overrideAllergy: override ? { reason: override } : undefined, items: lines.map((l) => ({ itemId: l.itemId, drugName: l.drugName, dose: `${l.amount} ${l.unit}`, frequency: l.frequency, route: l.route, durationDays: l.days === '' ? undefined : l.days, quantity: Number(l.quantity), instructions: [...l.tags, l.note.trim()].filter(Boolean).join('. ') || undefined })) } }),
    onSuccess: () => { setLines([]); setOverride(''); setUrgency('routine'); qc.invalidateQueries({ queryKey: ['rx', visitId ?? admissionId] }); },
  });
  const allergy = m.error instanceof ApiError && m.error.code === 'ALLERGY_ALERT';
  const up = (i: number, p: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? withQuantity({ ...x, ...p }) : x)));
  const problems = lines.map(lineProblems);
  return (
    <Card title={<span className="flex items-center gap-2"><Pill className="h-4 w-4" /> {admissionId ? 'Medication orders (sent to pharmacy)' : 'Prescriptions'}</span>}>
      {open && can('prescription.create') && (
        <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
          <ItemPicker
            onPick={(i) => {
              const d = defaultsForForm(i.form);
              setLines([...lines, { itemId: i._id, drugName: `${i.name}${i.strength ? ` ${i.strength}` : ''}`, form: i.form, strength: i.strength, stockUnit: i.unit, stock: i.stock?.usable, amount: '', unit: d.unit, frequency: '', route: d.route, days: '', quantity: '', qtyEdited: false, tags: [], note: '' }]);
            }}
            placeholder="Add drug from formulary (shows stock)"
          />
          {lines.map((l, i) => {
            const qty = Number(l.quantity);
            const short = l.stock !== undefined && Number.isInteger(qty) && qty > (l.stock ?? 0);
            return (
              <div key={i} className="space-y-2 rounded border border-[var(--border)] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{l.drugName}{l.form && <span className="muted font-normal"> · {l.form}</span>}<span className={`block text-xs ${(l.stock ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{l.stock ?? 0} {l.stockUnit ?? ''} in stock</span></div>
                  <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1.6fr_1.3fr_1fr_0.9fr_0.8fr]">
                  <div className="text-xs"><span className="muted">Dose</span><DosePicker amount={l.amount} unit={l.unit} strength={l.strength} onChange={(v) => up(i, v)} /></div>
                  <label className="text-xs"><span className="muted">How often</span>
                    <Select value={l.frequency} onChange={(e) => up(i, { frequency: e.target.value, days: e.target.value === 'STAT' ? '' : l.days })}>
                      <option value="">Choose…</option>
                      {FREQUENCIES.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.label}</option>)}
                    </Select>
                  </label>
                  <label className="text-xs"><span className="muted">Route</span>
                    <Select value={l.route} onChange={(e) => up(i, { route: e.target.value })}>
                      <option value="">Choose…</option>
                      {ROUTES.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}
                    </Select>
                  </label>
                  <label className="text-xs"><span className="muted">For</span>
                    <Select value={l.days === '' ? '' : String(l.days)} disabled={l.frequency === 'STAT'} onChange={(e) => up(i, { days: e.target.value === '' ? '' : Number(e.target.value) })}>
                      <option value="">{l.frequency === 'STAT' ? 'Once' : 'Days…'}</option>
                      {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
                    </Select>
                  </label>
                  <label className="text-xs"><span className="muted">Quantity{l.stockUnit ? ` (${l.stockUnit})` : ''}</span>
                    <Input type="number" min={1} step={1} inputMode="numeric" value={l.quantity} className={short ? 'border-amber-500' : ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^0-9]/g, ''), qtyEdited: e.target.value !== '' } : x)))} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {INSTRUCTIONS.map((t) => {
                    const on = l.tags.includes(t);
                    return <button key={t} type="button" onClick={() => up(i, { tags: on ? l.tags.filter((x) => x !== t) : [...l.tags, t] })} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-[var(--border)]'}`}>{t}</button>;
                  })}
                  <Input className="h-7 min-w-40 flex-1 py-0 text-xs" placeholder="Other instruction (optional)" maxLength={200} value={l.note} onChange={(e) => up(i, { note: e.target.value })} />
                </div>
                {problems[i].length > 0 && (l.amount !== '' || l.frequency || l.days !== '' || l.quantity) && <p className="text-xs text-red-600">To send: {problems[i].join(', ')}.</p>}
                {short && <p className="text-xs text-amber-600">More than the {l.stock} in stock: pharmacy may only part-dispense.</p>}
                {!l.qtyEdited && l.quantity && <p className="muted text-xs">Quantity worked out from dose × frequency × days. You can change it.</p>}
              </div>
            );
          })}
          {allergy && (
            <Alert tone="red" title="ALLERGY ALERT">
              {(m.error as ApiError).message}
              <Input className="mt-2" placeholder="Override reason (documented and audited)" value={override} onChange={(e) => setOverride(e.target.value)} />
            </Alert>
          )}
          {!allergy && <ErrorText error={m.error} />}
          {lines.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {admissionId && (
                <div className="flex rounded-md border border-[var(--border)] p-0.5 text-xs" role="radiogroup" aria-label="Urgency">
                  {(['routine', 'urgent', 'stat'] as const).map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={urgency === u} onClick={() => setUrgency(u)} className={`rounded px-2.5 py-1 capitalize ${urgency === u ? (u === 'stat' ? 'bg-red-600 text-white' : u === 'urgent' ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white') : ''}`}>{u === 'stat' ? 'STAT' : u}</button>
                  ))}
                </div>
              )}
              <Button onClick={() => m.mutate()} loading={m.isPending} disabled={problems.some((p) => p.length > 0) || (allergy && override.length < 5)}>{allergy ? 'Override & send' : admissionId ? 'Send to pharmacy' : 'Prescribe'}</Button>
            </div>
          )}
        </div>
      )}
      {(list.data ?? []).length === 0 && <p className="muted text-sm">{admissionId ? 'No medication orders yet.' : 'No prescriptions.'}</p>}
      <ErrorText error={receive.error} />
      {list.data?.map((rx) => (
        <div key={rx._id} className="mb-3">
          <p className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono">{rx.rxNumber} · {rx.prescriberName} · {fmtDateTime(rx.createdAt)}</span>
            <span className="flex items-center gap-1">
              {rx.urgency && rx.urgency !== 'routine' && <Badge tone={rx.urgency === 'stat' ? 'red' : 'amber'}>{rx.urgency === 'stat' ? 'STAT' : 'Urgent'}</Badge>}
              <Badge tone={statusTone(rx.status === 'dispensed' ? 'completed' : rx.status === 'cancelled' ? 'failed' : 'pending')}>{rx.status === 'pending' && admissionId ? 'waiting for pharmacy' : rx.status.replace('_', ' ')}</Badge>
              {admissionId && rx.dispenses.length > 0 && (() => {
                const got = Math.max(0, ...(rx.receipts ?? []).map((r) => r.dispenseCount));
                return got >= rx.dispenses.length
                  ? <Badge tone="green">received on ward</Badge>
                  : can('nursing.record') ? <Button size="sm" onClick={() => receive.mutate(rx._id)} loading={receive.isPending && receive.variables === rx._id}>Confirm received</Button> : <Badge tone="blue">ready on ward</Badge>;
              })()}
            </span>
          </p>
          <Table head={['Drug', 'Dose', 'Freq', 'Days', 'Qty', 'Dispensed']}>
            {rx.items.map((i) => <tr key={i._id} className={i.status === 'cancelled' ? 'line-through opacity-50' : ''}><Td>{i.drugName}<span className="muted block text-xs">{i.instructions}</span></Td><Td>{i.dose}</Td><Td>{i.frequency}</Td><Td>{i.durationDays}</Td><Td>{i.quantity}</Td><Td>{i.dispensedQuantity}</Td></tr>)}
          </Table>
          {!admissionId && <EPrescriptionControls rx={rx} />}
        </div>
      ))}
    </Card>
  );
}
