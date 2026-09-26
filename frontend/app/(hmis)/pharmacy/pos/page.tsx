'use client';

import { itemLabel } from '@/features/pharmacy/types';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Printer, RotateCcw, ScanLine, ShoppingCart, Smartphone, Trash2, UserRound, Users } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td } from '@/components/ui';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { cn, fmtDateTime } from '@/lib/utils';
import type { Item, Location } from '@/features/pharmacy/types';

type Tab = 'sell' | 'sales';
interface CartLine { item: Item; quantity: number }
interface Sale { _id: string; saleNumber: string; status: 'awaiting_payment' | 'paid' | 'returned'; customerName?: string; customerPhone?: string; walkIn: boolean; total: number; invoiceNumber: string; soldByName?: string; createdAt: string; lines: Array<{ _id: string; name: string; quantity: number; unitPrice: number; amount: number; returnedQuantity?: number }> }
type Patient = Parameters<typeof PatientPicker>[0]['value'];
const money = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const newKey = () => `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

interface PromptStatus { saleStatus: Sale['status']; payment: { _id: string; status: 'pending' | 'completed' | 'failed'; amount: number; phone?: string; receiptNumber?: string; mpesaReceipt?: string; resultDesc?: string } | null }

/**
 * Follows an M-Pesa prompt for a sale until Safaricom confirms it (the sale is only paid on that confirmation),
 * and lets the prompt be sent again if the customer missed it or entered the wrong PIN.
 */
function MpesaPrompt({ saleId, defaultPhone, initialError }: { saleId: string; defaultPhone?: string; initialError?: string }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const st = useQuery({
    queryKey: ['pos-mpesa', saleId],
    queryFn: async () => (await api<PromptStatus>(`/pharmacy/sales/${saleId}/mpesa`, { query: { check: '1' } })).data,
    refetchInterval: (q) => (q.state.data?.saleStatus === 'awaiting_payment' && q.state.data?.payment?.status === 'pending' ? 4000 : false),
  });
  const resend = useMutation({
    mutationFn: async () => (await api(`/pharmacy/sales/${saleId}/mpesa`, { method: 'POST', body: { phone, idempotencyKey: newKey() } })).data,
    onSuccess: () => st.refetch(),
  });
  const d = st.data;
  useEffect(() => { if (d?.saleStatus === 'paid') qc.invalidateQueries({ queryKey: ['pos-sales'] }); }, [d?.saleStatus, qc]);
  if (d?.saleStatus === 'paid') return <Alert tone="green" title="M-Pesa payment received">Receipt {d.payment?.receiptNumber ?? ''}{d.payment?.mpesaReceipt ? ` · M-Pesa ${d.payment.mpesaReceipt}` : ''}.</Alert>;
  const pending = d?.payment?.status === 'pending';
  return (
    <div className="space-y-2">
      {pending ? (
        <Alert tone="blue" title="Waiting for the customer">Prompt sent to {d?.payment?.phone}. Ask them to enter their M-Pesa PIN. This updates on its own once Safaricom confirms.</Alert>
      ) : d?.payment?.status === 'failed' ? (
        <Alert tone="amber" title="The prompt was not completed">{d.payment.resultDesc ?? 'Cancelled, timed out or wrong PIN.'} Send it again, or take payment another way.</Alert>
      ) : initialError ? (
        <Alert tone="amber" title="The prompt could not be sent">{initialError} The sale is saved and awaiting payment.</Alert>
      ) : null}
      {!pending && (
        <div className="flex gap-2">
          <Input inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button onClick={() => resend.mutate()} loading={resend.isPending} disabled={phone.replace(/\D/g, '').length < 9}><Smartphone className="h-4 w-4" /> Send prompt</Button>
        </div>
      )}
      <ErrorText error={resend.error} />
    </div>
  );
}

function Sell({ canPay }: { canPay: boolean }) {
  const qc = useQueryClient();
  const locs = useQuery({ queryKey: ['locations'], queryFn: async () => (await api<Location[]>('/pharmacy/locations')).data });
  const [locationId, setLocationId] = useState('');
  const loc = locationId || locs.data?.find((l) => l.type === 'pharmacy')?._id || locs.data?.[0]?._id || '';
  const [q, setQ] = useState('');
  const search = useQuery({ queryKey: ['pos-items', loc, q], enabled: !!loc, queryFn: async () => (await api<Item[]>('/pharmacy/items', { query: { q: q || undefined, locationId: loc, category: 'drug', limit: 40 } })).data });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [who, setWho] = useState<'walkin' | 'patient'>('walkin');
  const [patient, setPatient] = useState<Patient>(null);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [rx, setRx] = useState({ show: false, prescriber: '', facility: '', reference: '' });
  const { data: me } = useMe();
  const mpesaEnabled = !!me?.integrations?.mpesa?.enabled;
  const [pay, setPay] = useState<{ method: 'cash' | 'stk' | 'mpesa' | 'card' | 'bank' | 'later'; tendered: string; reference: string; phone: string }>({ method: canPay ? 'cash' : 'later', tendered: '', reference: '', phone: '' });
  const [override, setOverride] = useState('');
  const [done, setDone] = useState<{ sale: Sale; receiptNumber?: string; mpesa?: { paymentId?: string; error?: string }; phone?: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), []);

  const nationality = (patient as { nationality?: string } | null)?.nationality;
  const priceList = who === 'patient' && nationality && !/kenya/i.test(nationality) ? 'foreigner' : 'cash';
  const priceOf = (i: Item) => i.prices?.[priceList] ?? i.prices?.cash;
  const total = useMemo(() => cart.reduce((s, l) => s + (priceOf(l.item) ?? 0) * l.quantity, 0), [cart, priceList]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (item: Item) => {
    setCart((c) => (c.some((l) => l.item._id === item._id) ? c.map((l) => (l.item._id === item._id ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { item, quantity: 1 }]));
    setQ('');
    searchRef.current?.focus();
  };
  const setQty = (id: string, quantity: number) => setCart((c) => c.map((l) => (l.item._id === id ? { ...l, quantity: Math.max(1, Math.floor(quantity) || 1) } : l)));

  const sell = useMutation({
    mutationFn: async () =>
      (await api<{ sale: Sale; receiptNumber?: string; mpesa?: { paymentId?: string; error?: string } }>('/pharmacy/sales', {
        method: 'POST',
        body: {
          locationId: loc,
          patientId: who === 'patient' ? patient?._id : undefined,
          customerName: who === 'walkin' ? customer.name : undefined,
          customerPhone: who === 'walkin' ? customer.phone || undefined : undefined,
          externalPrescription: rx.show && (rx.prescriber || rx.facility || rx.reference) ? { prescriber: rx.prescriber, facility: rx.facility, reference: rx.reference } : undefined,
          lines: cart.map((l) => ({ itemId: l.item._id, quantity: l.quantity })),
          overrideAllergy: override ? { reason: override } : undefined,
          payment: pay.method !== 'later' && pay.method !== 'stk' ? { method: pay.method, reference: pay.method === 'cash' ? undefined : pay.reference, idempotencyKey: newKey() } : undefined,
          mpesaPrompt: pay.method === 'stk' ? { phone: promptPhone, idempotencyKey: newKey() } : undefined,
        },
      })).data,
    onSuccess: (r) => { setDone({ ...r, phone: promptPhone }); setPay((p) => ({ ...p, phone: '' })); setCart([]); setCustomer({ name: '', phone: '' }); setPatient(null); setRx({ show: false, prescriber: '', facility: '', reference: '' }); setOverride(''); setPay((p) => ({ ...p, tendered: '', reference: '' })); qc.invalidateQueries({ queryKey: ['pos-items'] }); qc.invalidateQueries({ queryKey: ['pos-sales'] }); },
  });
  const promptPhone = pay.phone || (who === 'walkin' ? customer.phone : (patient as { phone?: string } | null)?.phone ?? '');
  const allergyAlert = sell.error instanceof ApiError && sell.error.code === 'ALLERGY_ALERT';
  const change = pay.method === 'cash' && pay.tendered ? Number(pay.tendered) - total : null;
  const ready = cart.length > 0 && !!loc && (who === 'walkin' ? customer.name.trim().length > 1 : !!patient) && (pay.method === 'cash' || pay.method === 'later' || (pay.method === 'stk' ? promptPhone.replace(/\D/g, '').length >= 9 : pay.reference.trim().length > 3)) && (change === null || change >= 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <label className="relative block">
              <ScanLine className="muted pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
              <input
                ref={searchRef}
                className="field pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && search.data?.length) { e.preventDefault(); const exact = search.data.find((i) => i.barcode === q.trim() || i.code === q.trim().toUpperCase()); add(exact ?? search.data[0]); } }}
                placeholder="Scan a barcode or search by name, brand or code, then press Enter"
              />
            </label>
            <Select value={loc} onChange={(e) => setLocationId(e.target.value)} aria-label="Sell from">{locs.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
          </div>
          <div className="mt-3 max-h-[420px] overflow-y-auto">
            {search.isLoading ? <Loading /> : (
              <ul className="divide-y divide-[var(--border)]">
                {(search.data ?? []).map((i) => {
                  const price = priceOf(i);
                  const usable = i.stock?.usable ?? 0;
                  return (
                    <li key={i._id}>
                      <button type="button" disabled={usable < 1 || price == null} onClick={() => add(i)} className="flex w-full items-start gap-3 px-1 py-2 text-left hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium break-words">{itemLabel(i)}</p>
                          <p className="muted text-xs break-words">{[i.genericName, i.brand, i.form, i.code].filter(Boolean).join(' · ')}</p>
                        </div>
                        <span className={cn('shrink-0 text-xs whitespace-nowrap', usable > 0 ? 'text-emerald-600' : 'text-red-600')}>{usable} {i.unit}</span>
                        <span className="w-24 shrink-0 text-right text-sm font-semibold whitespace-nowrap">{price != null ? money(price) : <span className="text-xs text-red-600">No price</span>}</span>
                      </button>
                    </li>
                  );
                })}
                {search.data?.length === 0 && <li className="muted py-6 text-center text-sm">No medicines found.</li>}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={<span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Sale</span>}>
          {cart.length === 0 ? <p className="muted py-6 text-center text-sm">Scan or pick medicines to start a sale.</p> : (
            <ul className="divide-y divide-[var(--border)]">
              {cart.map((l) => {
                const price = priceOf(l.item) ?? 0;
                const over = l.quantity > (l.item.stock?.usable ?? 0);
                return (
                  <li key={l.item._id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{itemLabel(l.item)}</p>
                      <p className={cn('text-xs', over ? 'text-red-600' : 'muted')}>{money(price)} × {l.quantity}{over ? ` · only ${l.item.stock?.usable ?? 0} in stock` : ''}</p>
                    </div>
                    <button type="button" className="rounded p-1 hover:bg-[var(--surface-2)]" onClick={() => setQty(l.item._id, l.quantity - 1)} aria-label="Less"><Minus className="h-4 w-4" /></button>
                    <input className="field w-16 text-center" value={l.quantity} onChange={(e) => setQty(l.item._id, Number(e.target.value))} inputMode="numeric" aria-label="Quantity" />
                    <button type="button" className="rounded p-1 hover:bg-[var(--surface-2)]" onClick={() => setQty(l.item._id, l.quantity + 1)} aria-label="More"><Plus className="h-4 w-4" /></button>
                    <span className="w-24 text-right text-sm font-semibold">{money(price * l.quantity)}</span>
                    <button type="button" className="rounded p-1 text-red-600 hover:bg-[var(--surface-2)]" onClick={() => setCart((c) => c.filter((x) => x.item._id !== l.item._id))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="text-2xl font-bold">{money(total)}</span>
          </div>
          <p className="muted text-xs">Final prices are confirmed by the system from the {priceList === 'foreigner' ? 'foreigner' : 'cash'} price list.</p>
        </Card>

        <Card title="Customer">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setWho('walkin')} className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm', who === 'walkin' ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300' : 'border-[var(--border)]')}><UserRound className="h-4 w-4" /> Walk-in customer</button>
            <button type="button" onClick={() => setWho('patient')} className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm', who === 'patient' ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300' : 'border-[var(--border)]')}><Users className="h-4 w-4" /> Registered patient</button>
          </div>
          {who === 'walkin' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name *"><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="07xx xxx xxx" /></Field>
            </div>
          ) : <PatientPicker value={patient} onChange={setPatient} />}
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={rx.show} onChange={(e) => setRx({ ...rx, show: e.target.checked })} /> Outside prescription</label>
          {rx.show && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Input placeholder="Prescriber" value={rx.prescriber} onChange={(e) => setRx({ ...rx, prescriber: e.target.value })} />
              <Input placeholder="Facility" value={rx.facility} onChange={(e) => setRx({ ...rx, facility: e.target.value })} />
              <Input placeholder="Prescription no." value={rx.reference} onChange={(e) => setRx({ ...rx, reference: e.target.value })} />
            </div>
          )}
        </Card>

        <Card title="Payment">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[...(canPay ? (['cash'] as const) : []), ...(mpesaEnabled ? (['stk'] as const) : []), ...(canPay ? (['mpesa', 'card', 'bank'] as const) : []), 'later' as const].map((m) => (
              <button key={m} type="button" onClick={() => setPay({ ...pay, method: m })} className={cn('rounded-lg border px-2 py-2 text-xs font-semibold', pay.method === m ? 'border-brand-600 bg-brand-600 text-white' : 'border-[var(--border)]')}>
                {{ cash: 'Cash', stk: 'M-Pesa prompt', mpesa: 'M-Pesa code', card: 'Card', bank: 'Bank', later: 'Pay at cashier' }[m]}
              </button>
            ))}
          </div>
          {pay.method === 'stk' && (
            <Field label="Customer's M-Pesa number" hint="A payment request goes to this phone, paid into the facility's M-Pesa account. The sale is marked paid only when Safaricom confirms." className="mt-3">
              <Input inputMode="tel" placeholder="07XX XXX XXX" value={promptPhone} onChange={(e) => setPay({ ...pay, phone: e.target.value })} />
            </Field>
          )}
          {pay.method === 'cash' && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Cash received"><Input inputMode="decimal" value={pay.tendered} onChange={(e) => setPay({ ...pay, tendered: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={String(total)} /></Field>
              <Field label="Change"><div className={cn('field font-semibold', change !== null && change < 0 && 'text-red-600')}>{change === null ? '—' : change < 0 ? `Short ${money(-change)}` : money(change)}</div></Field>
            </div>
          )}
          {(pay.method === 'mpesa' || pay.method === 'card' || pay.method === 'bank') && <Field label={pay.method === 'mpesa' ? 'M-Pesa code (e.g. SGH7XXXXXX)' : 'Reference'} className="mt-3"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value.toUpperCase() })} /></Field>}
          {pay.method === 'later' && <p className="muted mt-3 text-xs">The customer pays at the cashier (cash or M-Pesa prompt). The sale shows as awaiting payment until then.</p>}
          {allergyAlert && (
            <div className="mt-3 space-y-2">
              <Alert tone="red" title="Allergy alert">{(sell.error as ApiError).message}</Alert>
              <Input placeholder="Reason to continue anyway (recorded)" value={override} onChange={(e) => setOverride(e.target.value)} />
            </div>
          )}
          {!allergyAlert && <ErrorText error={sell.error} />}
          <Button className="mt-4 w-full py-3 text-base" onClick={() => sell.mutate()} loading={sell.isPending} disabled={!ready || (allergyAlert && override.trim().length < 5)}>
            {pay.method === 'later' ? 'Send to cashier' : pay.method === 'stk' ? `Send M-Pesa prompt · ${money(total)}` : `Complete sale · ${money(total)}`}
          </Button>
        </Card>
      </div>

      <Modal open={!!done} onClose={() => setDone(null)} title={done?.mpesa ? 'M-Pesa payment' : 'Sale complete'}>
        {done && (
          <div className="space-y-3 text-sm">
            <p><strong>{done.sale.saleNumber}</strong> · {money(done.sale.total)} · {done.sale.customerName}</p>
            {done.mpesa ? <MpesaPrompt saleId={done.sale._id} defaultPhone={done.phone} initialError={done.mpesa.error} />
              : done.sale.status === 'paid' ? <Alert tone="green">Paid{done.receiptNumber ? `. Receipt ${done.receiptNumber}` : ''}.</Alert> : <Alert tone="amber">Awaiting payment at the cashier (invoice {done.sale.invoiceNumber}).</Alert>}
            <div className="flex gap-2">
              <a href={`/print/pos/${done.sale._id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><Printer className="h-4 w-4" /> Print receipt</a>
              <Button variant="outline" onClick={() => setDone(null)}>New sale</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Sales() {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const sales = useQuery({ queryKey: ['pos-sales', date], queryFn: async () => (await api<Sale[]>('/pharmacy/sales', { query: { from: date, limit: 200 } })).data });
  const [ret, setRet] = useState<{ sale: Sale; qty: Record<string, number>; reason: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Sale | null>(null);
  const can = useCan();
  const { data: me } = useMe();
  const mpesaEnabled = !!me?.integrations?.mpesa?.enabled && can('pharmacy.sell');
  const doReturn = useMutation({
    mutationFn: async () => (await api<{ message: string }>(`/pharmacy/sales/${ret!.sale._id}/return`, { method: 'POST', body: { reason: ret!.reason, lines: Object.entries(ret!.qty).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity })) } })).data,
    onSuccess: (r) => { setMsg(r.message); setRet(null); qc.invalidateQueries({ queryKey: ['pos-sales'] }); qc.invalidateQueries({ queryKey: ['pos-items'] }); },
  });
  return (
    <Card title="Counter sales" actions={<div className="flex items-center gap-2"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><a href={`/print/z-report?date=${date}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]"><Printer className="h-4 w-4" /> Z-report</a></div>}>
      {msg && <div className="mb-3"><Alert tone="green">{msg}</Alert></div>}
      {sales.isLoading ? <Loading /> : (
        <Table head={['Sale', 'Time', 'Customer', 'Items', 'Total', 'Status', 'By', '']} empty={!sales.data?.length}>
          {sales.data?.map((s) => (
            <tr key={s._id}>
              <Td className="font-mono text-xs">{s.saleNumber}</Td>
              <Td>{fmtDateTime(s.createdAt)}</Td>
              <Td>{s.customerName}{s.walkIn && <span className="muted text-xs"> (walk-in)</span>}</Td>
              <Td className="text-xs">{s.lines.map((l) => `${l.name} × ${l.quantity}`).join(', ')}</Td>
              <Td className="font-semibold">{money(s.total)}</Td>
              <Td><Badge tone={s.status === 'paid' ? 'green' : s.status === 'returned' ? 'gray' : 'amber'}>{s.status === 'awaiting_payment' ? 'Awaiting payment' : s.status === 'paid' ? 'Paid' : 'Returned'}</Badge></Td>
              <Td className="text-xs">{s.soldByName}</Td>
              <Td>
                <div className="flex gap-1">
                  <a href={`/print/pos/${s._id}`} target="_blank" rel="noreferrer" className="rounded p-1.5 hover:bg-[var(--surface-2)]" aria-label="Print receipt"><Printer className="h-4 w-4" /></a>
                  {mpesaEnabled && s.status === 'awaiting_payment' && <button type="button" className="rounded p-1.5 hover:bg-[var(--surface-2)]" onClick={() => setPrompt(s)} aria-label="Send M-Pesa prompt" title="Send M-Pesa prompt"><Smartphone className="h-4 w-4" /></button>}
                  {s.status !== 'returned' && <button type="button" className="rounded p-1.5 hover:bg-[var(--surface-2)]" onClick={() => setRet({ sale: s, qty: {}, reason: '' })} aria-label="Return items"><RotateCcw className="h-4 w-4" /></button>}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!prompt} onClose={() => setPrompt(null)} title={`M-Pesa prompt · ${prompt?.saleNumber ?? ''}`}>
        {prompt && (
          <div className="space-y-3 text-sm">
            <p>{money(prompt.total)} · {prompt.customerName}</p>
            <MpesaPrompt saleId={prompt._id} defaultPhone={prompt.customerPhone} />
          </div>
        )}
      </Modal>
      <Modal open={!!ret} onClose={() => setRet(null)} title={`Return items · ${ret?.sale.saleNumber ?? ''}`}>
        {ret && (
          <div className="space-y-3">
            {ret.sale.lines.map((l) => {
              const left = l.quantity - (l.returnedQuantity ?? 0);
              return (
                <div key={l._id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{l.name} <span className="muted">(up to {left})</span></span>
                  <Input type="number" min={0} max={left} className="w-24" value={ret.qty[l._id] ?? 0} onChange={(e) => setRet({ ...ret, qty: { ...ret.qty, [l._id]: Math.min(left, Math.max(0, Number(e.target.value))) } })} />
                </div>
              );
            })}
            <Field label="Reason *"><Input value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })} /></Field>
            <p className="muted text-xs">Items go back into stock. If the customer had paid, refund them from Billing & Cashier.</p>
            <ErrorText error={doReturn.error} />
            <Button onClick={() => doReturn.mutate()} loading={doReturn.isPending} disabled={ret.reason.trim().length < 5 || !Object.values(ret.qty).some((q) => q > 0)}>Return to stock</Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function PharmacyPosPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('sell');
  if (!can('pharmacy.sell', 'pharmacy.view')) return <Alert tone="amber">You do not have access to pharmacy sales.</Alert>;
  return (
    <div>
      <PageHeader title="Pharmacy POS" subtitle="Counter sales for walk-in customers and outside prescriptions" actions={<Link href="/pharmacy" className="text-sm text-brand-600 hover:underline">Back to dispensing</Link>} />
      <div className="mb-4"><Tabs<Tab> value={tab} onChange={setTab} tabs={[...(can('pharmacy.sell') ? [{ key: 'sell' as const, label: 'New sale' }] : []), { key: 'sales', label: 'Sales & Z-report' }]} /></div>
      {tab === 'sell' && can('pharmacy.sell') ? <Sell canPay={can('billing.create')} /> : <Sales />}
    </div>
  );
}
