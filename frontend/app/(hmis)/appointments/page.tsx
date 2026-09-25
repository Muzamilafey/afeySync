'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, Download, List, Plus, Repeat, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, downloadFile } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Table, Tabs, Td } from '@/components/ui';
import { cn } from '@/lib/utils';
import { type Appt, fmtDay, fmtTime, statusBadge, useProviders, useServices } from '@/features/appointments/shared';

type Scope = 'today' | 'upcoming' | 'past' | 'all';
type View = 'list' | 'calendar';

const eatDate = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => eatDate(new Date(Date.parse(`${ymd}T12:00:00+03:00`) + n * 86400_000));
const mondayOf = (ymd: string) => {
  const dow = (new Date(`${ymd}T12:00:00+03:00`).getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
};

function Row({ a, onAction, can }: { a: Appt; onAction: (a: Appt, action: 'checkin' | 'no-show' | 'cancel') => void; can: (...p: string[]) => boolean }) {
  const p = a.patientId;
  const s = statusBadge(a.status);
  return (
    <tr>
      <Td className="whitespace-nowrap"><span className="font-medium">{fmtTime(a.scheduledAt)}</span><span className="muted block text-xs">{fmtDay(a.scheduledAt)} · {a.durationMinutes} min</span></Td>
      <Td><span className="font-medium">{p.firstName} {p.lastName}</span><span className="muted block text-xs">{p.patientNumber}{p.phone ? ` · ${p.phone}` : ''}</span></Td>
      <Td>{a.serviceName ?? <span className="muted">—</span>}{a.courseIndex && <span className="muted block text-xs"><Repeat className="mr-1 inline h-3 w-3" />Session {a.courseIndex} of {a.courseTotal}</span>}</Td>
      <Td>{a.providerName ?? <span className="muted">Any</span>}</Td>
      <Td className="max-w-56 text-sm">{a.reason}</Td>
      <Td><Badge tone={s.tone}>{s.label}</Badge></Td>
      <Td className="whitespace-nowrap text-right">
        {a.status === 'booked' && can('queue.manage') && <Button size="sm" onClick={() => onAction(a, 'checkin')}>Check in</Button>}{' '}
        {a.status === 'booked' && can('appointments.manage') && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onAction(a, 'no-show')}>No-show</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction(a, 'cancel')}>Cancel</Button>
          </>
        )}
      </Td>
    </tr>
  );
}

function Calendar({ weekStart, items }: { weekStart: string; items: Appt[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = eatDate(new Date());
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => {
        const list = items.filter((a) => eatDate(new Date(a.scheduledAt)) === d);
        return (
          <div key={d} className={cn('min-h-40 rounded-lg border border-[var(--border)] p-2', d === today && 'border-brand-500 bg-brand-50/40 dark:bg-brand-900/20')}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide">{new Date(`${d}T12:00:00+03:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })} {list.length > 0 && <span className="muted font-normal">· {list.length}</span>}</p>
            <div className="space-y-1.5">
              {list.map((a) => {
                const s = statusBadge(a.status);
                return (
                  <div key={a._id} className={cn('rounded-md border-l-4 bg-[var(--surface-2)] px-2 py-1 text-xs', a.status === 'booked' ? 'border-brand-600' : a.status === 'checked_in' || a.status === 'completed' ? 'border-emerald-500' : 'border-slate-400 opacity-70')}>
                    <p className="font-semibold">{fmtTime(a.scheduledAt)} · {a.patientId.firstName} {a.patientId.lastName}</p>
                    <p className="muted truncate">{a.serviceName ?? a.providerName ?? a.reason ?? ''}</p>
                    {a.status !== 'booked' && <p className="muted">{s.label}</p>}
                  </div>
                );
              })}
              {list.length === 0 && <p className="muted text-xs">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AppointmentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [scope, setScope] = useState<Scope>('today');
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: '', providerId: '', serviceCode: '' });
  const [weekStart, setWeekStart] = useState(() => mondayOf(eatDate(new Date())));
  const [exportError, setExportError] = useState<unknown>(null);
  const providers = useProviders(showFilters);
  const services = useServices(showFilters);
  const active = Object.values(filters).filter(Boolean).length + (q.trim().length >= 2 ? 1 : 0);
  const query = useMemo(() => {
    const base = { q: q.trim().length >= 2 ? q.trim() : undefined, status: filters.status || undefined, providerId: filters.providerId || undefined, serviceCode: filters.serviceCode || undefined };
    return view === 'calendar' ? { ...base, scope: 'all', from: weekStart, to: addDays(weekStart, 6) } : { ...base, scope };
  }, [q, filters, view, scope, weekStart]);
  const list = useQuery({ queryKey: ['appointments', query], queryFn: async () => (await api<Appt[]>('/appointments', { query })).data, refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: ({ a, action }: { a: Appt; action: 'checkin' | 'no-show' | 'cancel' }) => {
      if (action === 'checkin') return api('/visits', { method: 'POST', body: { patientId: a.patientId._id, appointmentId: a._id } });
      const reason = action === 'cancel' ? window.prompt('Reason for cancelling (optional)') ?? undefined : undefined;
      return api(`/appointments/${a._id}/${action}`, { method: 'POST', body: { reason: reason || undefined } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
  const clear = () => { setQ(''); setFilters({ status: '', providerId: '', serviceCode: '' }); };
  const doExport = async () => {
    setExportError(null);
    try {
      await downloadFile('/appointments/export', `appointments-${view === 'calendar' ? weekStart : scope}.csv`, { query: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, v === undefined ? undefined : String(v)])) });
    } catch (e) {
      setExportError(e);
    }
  };
  const items = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Find all the appointments here"
        crumbs={['Front Desk', 'Appointments']}
        actions={can('appointments.manage') && (
          <>
            <Link href="/appointments/new?mode=course"><Button variant="outline"><Repeat className="h-4 w-4" /> Book a course</Button></Link>
            <Link href="/appointments/new"><Button><Plus className="h-4 w-4" /> New appointment</Button></Link>
          </>
        )}
      />
      <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] p-1" role="tablist" aria-label="View">
        {([['list', 'List', List], ['calendar', 'Calendar', CalendarDays]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', view === k ? 'bg-brand-600 text-white' : 'hover:bg-[var(--surface-2)]')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      <Card>
        {view === 'list' ? (
          <Tabs<Scope> value={scope} onChange={setScope} tabs={[{ key: 'today', label: 'Today' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }, { key: 'all', label: 'All' }]} />
        ) : (
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(mondayOf(eatDate(new Date())))}>This week</Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
            <p className="text-sm font-semibold">{fmtDay(`${weekStart}T12:00:00+03:00`)} – {fmtDay(`${addDays(weekStart, 6)}T12:00:00+03:00`)}</p>
          </div>
        )}
        <div className="my-3 flex flex-wrap gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input className="pl-9" placeholder="Search appointments by patient name, phone number, patient no. or APT no." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="h-4 w-4" /> Filters{Object.values(filters).filter(Boolean).length > 0 && <Badge tone="blue">{Object.values(filters).filter(Boolean).length}</Badge>}</Button>
          <Button variant="outline" onClick={doExport}><Download className="h-4 w-4" /> Export</Button>
        </div>
        {showFilters && (
          <div className="mb-3 grid gap-3 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-3">
            <Field label="Status"><Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Any status</option><option value="booked">Booked</option><option value="checked_in">Checked in</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option></Select></Field>
            <Field label="Practitioner"><Select value={filters.providerId} onChange={(e) => setFilters({ ...filters, providerId: e.target.value })}><option value="">Anyone</option>{providers.data?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select></Field>
            <Field label="Service"><Select value={filters.serviceCode} onChange={(e) => setFilters({ ...filters, serviceCode: e.target.value })}><option value="">Any service</option>{services.data?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
          </div>
        )}
        <ErrorText error={list.error || act.error || exportError} />
        {list.isLoading ? <Loading /> : view === 'calendar' ? (
          <Calendar weekStart={weekStart} items={items} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-50 dark:bg-brand-900/30"><CalendarX2 className="h-10 w-10 text-brand-600" /></span>
            <p className="text-base font-semibold">No appointments found</p>
            <p className="muted max-w-md text-sm">{active ? 'No appointments match your search and filters. Try adjusting them or create a new appointment.' : scope === 'today' ? 'Nothing is booked for today yet.' : 'Nothing here yet.'}</p>
            <div className="flex gap-2">
              {active > 0 && <Button variant="outline" onClick={clear}><X className="h-4 w-4" /> Clear filters</Button>}
              {can('appointments.manage') && <Link href="/appointments/new"><Button><Plus className="h-4 w-4" /> New appointment</Button></Link>}
            </div>
          </div>
        ) : (
          <Table head={['Time', 'Patient', 'Service', 'Practitioner', 'Reason', 'Status', '']}>
            {items.map((a) => <Row key={a._id} a={a} can={can} onAction={(x, action) => act.mutate({ a: x, action })} />)}
          </Table>
        )}
      </Card>
    </>
  );
}
