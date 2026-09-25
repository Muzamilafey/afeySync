'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Eye, EyeOff, Repeat, Search, Stethoscope, UserRound, UserRoundSearch, X } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { age, cn } from '@/lib/utils';
import { fmtDay, fmtTime, useProviders, useServices } from '@/features/appointments/shared';
import type { Patient } from '@/types/api';

type Mode = 'single' | 'course';
type P = Patient & { email?: string; dateOfBirth?: string };
interface Slot { at: string; label: string; available: boolean; reason: string | null; serviceBookings?: number }

const eatDate = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => eatDate(new Date(Date.parse(`${ymd}T12:00:00+03:00`) + n * 86400_000));
const maskPhone = (p?: string) => (p && p.length > 6 ? `${p.slice(0, -6).replace(/(\+?\d{3})(\d{3})/, '$1 $2')} *** ${p.slice(-3)}` : p ?? '');
const fullName = (p: P) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
const REASONS = ['New consultation', 'Review / follow-up', 'Results review', 'Procedure', 'Dressing / wound care', 'Antenatal visit', 'Immunization', 'Physiotherapy', 'Dental care', 'Other'];

/* ------------------------------------------------------------------ Step 1: find the patient */
function SelectPatient({ mode }: { mode: Mode }) {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ['appt-patient-search', term, all], enabled: term.length >= 2, queryFn: async () => (await api<P[]>('/patients/search', { query: { q: term, limit: all ? 50 : 6 } })).data });
  const pick = (p: P) => router.push(`/appointments/new?patientId=${p._id}${mode === 'course' ? '&mode=course' : ''}`);
  const line = (p: P) => [p.gender && p.gender[0].toUpperCase() + p.gender.slice(1), p.dateOfBirth && `${fmtDay(p.dateOfBirth).replace(/^\w+, /, '')} (${age(p.dateOfBirth)})`, p.phone].filter(Boolean).join(' · ');
  return (
    <Card>
      <div className="relative">
        <Search className="muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input className="h-12 pl-10 pr-10 text-base" autoFocus placeholder="Search by patient no., name, phone number or national ID" value={q} onChange={(e) => { setQ(e.target.value); setAll(false); }} />
        {q && <button type="button" aria-label="Clear search" className="muted absolute right-3 top-1/2 -translate-y-1/2" onClick={() => { setQ(''); setAll(false); }}><X className="h-4 w-4" /></button>}
        {!all && term.length >= 2 && results.data && (
          <div className="surface absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-lg">
            {results.data.length === 0 && <p className="muted p-4 text-sm">No patient matches “{term}”.{can('patients.create') && <> <Link href="/patients/register" className="text-brand-600 underline">Register a new patient</Link></>}</p>}
            {results.data.map((p) => (
              <button key={p._id} type="button" onClick={() => pick(p)} className="block w-full border-b border-[var(--border)] px-4 py-2.5 text-left hover:bg-[var(--surface-2)]">
                <span className="font-medium">{fullName(p)}</span> <span className="muted font-mono text-xs">{p.patientNumber}</span>
                <span className="muted block text-xs">{line(p)}</span>
              </button>
            ))}
            {results.data.length > 0 && <button type="button" onClick={() => setAll(true)} className="w-full bg-[var(--surface-2)] py-2.5 text-sm font-medium text-brand-600">Show all results</button>}
          </div>
        )}
      </div>
      {all && term.length >= 2 ? (
        <div className="mt-5">
          <p className="muted mb-2 text-sm">Showing results for “{term}”</p>
          {results.isLoading ? <Loading /> : (
            <Table head={['Name', 'Patient no.', 'Date of birth', 'Phone number', '']} empty={(results.data ?? []).length === 0}>
              {results.data?.map((p) => (
                <tr key={p._id}>
                  <Td className="font-medium">{fullName(p)}<span className="muted block text-xs capitalize">{p.gender}</span></Td>
                  <Td className="font-mono text-xs">{p.patientNumber}</Td>
                  <Td>{p.dateOfBirth ? `${fmtDay(p.dateOfBirth).replace(/^\w+, /, '')} (${age(p.dateOfBirth)})` : '—'}</Td>
                  <Td>{p.phone ?? '—'}</Td>
                  <Td className="text-right"><Button size="sm" variant="outline" onClick={() => pick(p)}>Book</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      ) : term.length < 2 && (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-50 dark:bg-brand-900/30"><UserRoundSearch className="h-10 w-10 text-brand-600" /></span>
          <p className="font-semibold">Patient search</p>
          <p className="muted max-w-md text-sm">Search for the patient by entering their patient number, phone number, national ID or name.</p>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Step 2: appointment details */
function PatientSummary({ p, onRemove }: { p: P; onRemove: () => void }) {
  const [show, setShow] = useState(false);
  const initials = `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();
  return (
    <div className="flex flex-wrap items-start gap-5 border-b border-[var(--border)] pb-5">
      <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-brand-600 text-2xl font-bold text-white">{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold text-brand-700 dark:text-brand-200">{fullName(p)} <span className="muted text-sm font-normal capitalize">{p.gender}{p.dateOfBirth ? `, ${age(p.dateOfBirth)}` : ''}</span></p>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <div><p className="muted text-xs">Patient no.</p><p className="font-mono">{p.patientNumber}</p></div>
          <div><p className="muted text-xs">Date of birth</p><p>{p.dateOfBirth ? fmtDay(p.dateOfBirth).replace(/^\w+, /, '') : 'Not added'}</p></div>
          <div><p className="muted text-xs">Email</p><p className={p.email ? '' : 'text-amber-600'}>{p.email || 'Not added'}</p></div>
          <div><p className="muted text-xs">Phone no.</p><p className="flex items-center gap-1.5">{p.phone ? (show ? p.phone : maskPhone(p.phone)) : <span className="text-amber-600">Not added</span>}{p.phone && <button type="button" aria-label={show ? 'Hide phone number' : 'Show phone number'} onClick={() => setShow(!show)} className="muted">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}</p></div>
        </div>
      </div>
      <Button variant="outline" className="border-red-300 text-red-600" onClick={onRemove}>Remove</Button>
    </div>
  );
}

function BookingForm({ patientId, mode }: { patientId: string; mode: Mode }) {
  const router = useRouter();
  const patient = useQuery({ queryKey: ['patient', patientId], queryFn: async () => (await api<P>(`/patients/${patientId}`)).data });
  const services = useServices();
  const providers = useProviders();
  const [bookBy, setBookBy] = useState<'service' | 'practitioner'>('service');
  const [f, setF] = useState({ serviceCode: '', providerId: '', durationMinutes: 30, date: eatDate(new Date()), at: '', reason: '', notes: '', notifyPatient: true, sessions: 6, everyDays: 7 });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, ...('date' in p || 'durationMinutes' in p || 'providerId' in p ? { at: '' } : {}) }));
  const ready = bookBy === 'service' ? !!f.serviceCode : !!f.providerId;
  const slots = useQuery({
    queryKey: ['appt-slots', f.date, f.durationMinutes, f.providerId, f.serviceCode, patientId],
    enabled: ready && !!f.date,
    queryFn: async () => (await api<{ open: string; close: string; slots: Slot[] }>('/appointments/slots', { query: { date: f.date, durationMinutes: f.durationMinutes, providerId: f.providerId || undefined, serviceCode: f.serviceCode || undefined, patientId } })).data,
  });
  const byCategory = useMemo(() => {
    const g = new Map<string, NonNullable<typeof services.data>>();
    for (const s of services.data ?? []) g.set(s.category, [...(g.get(s.category) ?? []), s]);
    return [...g];
  }, [services.data]);
  const courseDates = mode === 'course' && f.at ? Array.from({ length: f.sessions }, (_, i) => new Date(new Date(f.at).getTime() + i * f.everyDays * 86400_000)) : [];
  const book = useMutation({
    mutationFn: async () => {
      const body = { patientId, scheduledAt: f.at, durationMinutes: f.durationMinutes, serviceCode: f.serviceCode || undefined, providerId: f.providerId || undefined, reason: f.reason || undefined, notes: f.notes.trim() || undefined, notifyPatient: f.notifyPatient };
      if (mode === 'course') return (await api<{ appointments: Array<{ appointmentNumber: string }> }>('/appointments/course', { method: 'POST', body: { ...body, sessions: f.sessions, everyDays: f.everyDays } })).data.appointments;
      return [(await api<{ appointmentNumber: string }>('/appointments', { method: 'POST', body })).data];
    },
  });

  if (patient.isLoading) return <Loading />;
  if (!patient.data) return <ErrorText error={patient.error} />;
  const p = patient.data;
  const svc = services.data?.find((s) => s.code === f.serviceCode);
  const prov = providers.data?.find((x) => x._id === f.providerId);

  if (book.data) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40"><CalendarCheck2 className="h-8 w-8 text-emerald-600" /></span>
          <p className="text-lg font-semibold">{book.data.length > 1 ? `${book.data.length} appointments booked` : `Appointment ${book.data[0].appointmentNumber} booked`}</p>
          <p className="muted text-sm">{fullName(p)} · {svc?.name ?? prov?.name} · {fmtDay(f.at)} at {fmtTime(f.at)}{book.data.length > 1 ? `, then every ${f.everyDays} day(s)` : ''}</p>
          {f.notifyPatient && p.phone && <p className="muted text-xs">An SMS confirmation is on its way, with a reminder the day before{book.data.length > 1 ? ' each session' : ''}.</p>}
          <div className="flex gap-2">
            <Link href="/appointments"><Button variant="outline">Back to appointments</Button></Link>
            <Button onClick={() => router.push(mode === 'course' ? '/appointments/new?mode=course' : '/appointments/new')}>Book another</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <p className="label mb-2">Patient summary</p>
      <PatientSummary p={p} onRemove={() => router.push(mode === 'course' ? '/appointments/new?mode=course' : '/appointments/new')} />

      <div className="mt-5 space-y-5">
        <p className="label">Appointment details</p>
        <div>
          <p className="muted mb-1.5 text-sm">Book by</p>
          <div className="inline-flex rounded-lg border border-[var(--border)] p-1" role="radiogroup" aria-label="Book by">
            {([['service', 'Service', Stethoscope], ['practitioner', 'Practitioner', UserRound]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" role="radio" aria-checked={bookBy === k} onClick={() => { setBookBy(k); set({ at: '' }); }} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', bookBy === k ? 'bg-brand-600 text-white' : 'hover:bg-[var(--surface-2)]')}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bookBy === 'service' ? 'Service *' : 'Service (optional)'}>
            <Select value={f.serviceCode} onChange={(e) => set({ serviceCode: e.target.value })}>
              <option value="">{bookBy === 'service' ? 'Select a service' : 'No specific service'}</option>
              {byCategory.map(([cat, list]) => <optgroup key={cat} label={cat[0].toUpperCase() + cat.slice(1)}>{list.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</optgroup>)}
            </Select>
          </Field>
          <Field label={bookBy === 'practitioner' ? 'Practitioner *' : 'Practitioner (optional)'}>
            <Select value={f.providerId} onChange={(e) => set({ providerId: e.target.value })}>
              <option value="">{bookBy === 'practitioner' ? 'Select a practitioner' : 'Any available'}</option>
              {providers.data?.map((x) => <option key={x._id} value={x._id}>{x.name}{x.cadre ? ` · ${x.cadre}` : x.roles?.length ? ` · ${x.roles[0]}` : ''}</option>)}
            </Select>
          </Field>
          {services.data?.length === 0 && bookBy === 'service' && <p className="text-xs text-amber-600 sm:col-span-2">No bookable services yet. Add consultations or procedures in Billing → Services &amp; Prices, or book by practitioner.</p>}
        </div>

        {ready && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
              <Field label="Date"><Input type="date" min={eatDate(new Date())} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
              <Field label="Duration">
                <Select value={f.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}</Select>
              </Field>
              <div className="flex flex-wrap items-end gap-1.5">
                {[['Today', 0], ['Tomorrow', 1], ['In 1 week', 7], ['In 2 weeks', 14], ['In 1 month', 30]].map(([label, n]) => (
                  <button key={label} type="button" onClick={() => set({ date: addDays(eatDate(new Date()), n as number) })} className={cn('rounded-full border px-3 py-1 text-xs', f.date === addDays(eatDate(new Date()), n as number) ? 'border-brand-600 bg-brand-600 text-white' : 'border-[var(--border)]')}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="muted mb-1.5 text-sm">Time {slots.data && <span className="text-xs">(clinic hours {slots.data.open}–{slots.data.close}, Kenya time)</span>}</p>
              {slots.isLoading ? <Loading /> : <ErrorText error={slots.error} />}
              {slots.data && (slots.data.slots.some((s) => s.available) ? (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
                  {slots.data.slots.map((s) => (
                    <button
                      key={s.at}
                      type="button"
                      disabled={!s.available}
                      title={s.reason ?? (s.serviceBookings ? `${s.serviceBookings} already booked for this service` : 'Free')}
                      onClick={() => set({ at: s.at })}
                      className={cn('rounded-md border px-2 py-1.5 text-sm', f.at === s.at ? 'border-brand-600 bg-brand-600 font-semibold text-white' : s.available ? 'border-[var(--border)] hover:border-brand-500' : 'cursor-not-allowed border-dashed border-[var(--border)] opacity-40 line-through')}
                    >
                      {s.label}{!!s.serviceBookings && f.at !== s.at && <span className="block text-[10px] text-amber-600">{s.serviceBookings} booked</span>}
                    </button>
                  ))}
                </div>
              ) : <Alert tone="amber">No free times on this day{prov ? ` for ${prov.name}` : ''}. Choose another date.</Alert>)}
            </div>

            {mode === 'course' && (
              <div className="grid gap-3 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-3">
                <Field label="Number of sessions"><Select value={f.sessions} onChange={(e) => set({ sessions: Number(e.target.value) })}>{Array.from({ length: 29 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} sessions</option>)}</Select></Field>
                <Field label="Repeat every"><Select value={f.everyDays} onChange={(e) => set({ everyDays: Number(e.target.value) })}>{[[1, 'Day'], [2, '2 days'], [3, '3 days'], [7, 'Week'], [14, '2 weeks'], [21, '3 weeks'], [28, '4 weeks']].map(([n, l]) => <option key={n} value={n}>{l}</option>)}</Select></Field>
                <div className="text-xs sm:row-span-2">
                  <p className="muted mb-1"><Repeat className="mr-1 inline h-3 w-3" />Sessions</p>
                  {courseDates.length ? <ol className="max-h-40 list-decimal space-y-0.5 overflow-y-auto pl-5">{courseDates.map((d) => <li key={d.toISOString()}>{fmtDay(d)} · {fmtTime(d)}</li>)}</ol> : <p className="muted">Pick the first session&apos;s time.</p>}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reason for visit"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="">Choose…</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Notes (optional)"><Input value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. bring previous X-ray" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.notifyPatient} disabled={!p.phone} onChange={(e) => setF({ ...f, notifyPatient: e.target.checked })} /> Send the patient an SMS confirmation and a reminder the day before{p.phone ? ` (${maskPhone(p.phone)})` : ' (no phone number on record)'}</label>
            <ErrorText error={book.error} />
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
              <Button onClick={() => book.mutate()} loading={book.isPending} disabled={!f.at || !f.reason}>{mode === 'course' ? `Book ${f.sessions} sessions` : 'Book appointment'}</Button>
              {f.at ? <p className="text-sm">{svc?.name ?? 'Appointment'}{prov ? ` with ${prov.name}` : ''} · <strong>{fmtDay(f.at)} at {fmtTime(f.at)}</strong> · {f.durationMinutes} min</p> : <p className="muted text-sm">Choose a time{!f.reason ? ' and a reason' : ''} to book.</p>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function NewAppointment() {
  const params = useSearchParams();
  const mode: Mode = params.get('mode') === 'course' ? 'course' : 'single';
  const patientId = params.get('patientId');
  return (
    <>
      <PageHeader title={mode === 'course' ? 'Book a course' : 'Book appointment'} subtitle={patientId ? 'Enter appointment details' : `Select a patient to book ${mode === 'course' ? 'a course of sessions' : 'an appointment'}`} crumbs={['Appointments', patientId ? (mode === 'course' ? 'Book a course' : 'Book appointment') : 'Select patient']} />
      {patientId ? <BookingForm key={patientId} patientId={patientId} mode={mode} /> : <SelectPatient mode={mode} />}
    </>
  );
}

export default function NewAppointmentPage() {
  return <Suspense><NewAppointment /></Suspense>;
}
