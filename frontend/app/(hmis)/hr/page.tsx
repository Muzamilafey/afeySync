'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, statusTone } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

interface Staff { _id: string; employeeNumber: string; fullName: string; userId?: string; branchId?: { _id: string; branchName: string } | string; department?: string; cadre?: string; jobTitle?: string; employmentType: string; hireDate?: string; licenseNumber?: string; licenseBody?: string; licenseExpiry?: string; phone?: string; email?: string; nationalId?: string; status: string }
interface Leave { _id: string; staffId: { _id: string; fullName: string; employeeNumber: string; department?: string }; type: string; startDate: string; endDate: string; days: number; reason?: string; status: string }
interface Shift { _id: string; staffId: { _id: string; fullName: string; cadre?: string }; branchId: string; date: string; shift: string; department?: string }
interface UserLite { _id: string; name: string; email: string }

type Tab = 'staff' | 'leave' | 'roster' | 'licences';
const SHIFTS = ['morning', 'afternoon', 'day', 'night', 'on_call'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const daysLeft = (d?: string) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400_000) : null);

const emptyStaff = { fullName: '', userId: '', branchId: '', department: '', cadre: '', jobTitle: '', employmentType: 'permanent', hireDate: '', licenseNumber: '', licenseBody: '', licenseExpiry: '', phone: '', email: '', nationalId: '', kraPin: '' };

function StaffForm({ initial, onDone }: { initial?: Staff; onDone: () => void }) {
  const me = useMe();
  const users = useQuery({ queryKey: ['users-lite'], queryFn: async () => (await api<UserLite[]>('/users', { query: { limit: 500 } })).data, retry: false });
  const [f, setF] = useState(() => (initial ? { ...emptyStaff, ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? (/(Date|Expiry)$/.test(k) ? v.slice(0, 10) : v) : k === 'branchId' && v ? (v as { _id: string })._id : ''])) } : emptyStaff));
  const set = (k: keyof typeof emptyStaff) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' && k in emptyStaff));
      return initial ? api(`/hr/staff/${initial._id}`, { method: 'PATCH', body }) : api('/hr/staff', { method: 'POST', body });
    },
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Full name" className="sm:col-span-2"><Input value={f.fullName} onChange={set('fullName')} /></Field>
      <Field label="System user (optional)">
        <Select value={f.userId} onChange={set('userId')} disabled={!!initial?.userId}>
          <option value="">— none —</option>
          {users.data?.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.email})</option>)}
        </Select>
      </Field>
      <Field label="Branch"><Select value={f.branchId} onChange={set('branchId')}><option value="">—</option>{me.data?.branches.map((b) => <option key={b._id} value={b._id}>{b.branchName}</option>)}</Select></Field>
      <Field label="Department"><Input value={f.department} onChange={set('department')} /></Field>
      <Field label="Cadre"><Input value={f.cadre} onChange={set('cadre')} placeholder="e.g. Clinical Officer" /></Field>
      <Field label="Job title"><Input value={f.jobTitle} onChange={set('jobTitle')} /></Field>
      <Field label="Employment"><Select value={f.employmentType} onChange={set('employmentType')}>{['permanent', 'contract', 'locum', 'intern', 'volunteer'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Hire date"><Input type="date" value={f.hireDate} onChange={set('hireDate')} /></Field>
      <Field label="Licence number"><Input value={f.licenseNumber} onChange={set('licenseNumber')} /></Field>
      <Field label="Regulatory body"><Input value={f.licenseBody} onChange={set('licenseBody')} placeholder="e.g. KMPDC, NCK, COC" /></Field>
      <Field label="Licence expiry"><Input type="date" value={f.licenseExpiry} onChange={set('licenseExpiry')} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="National ID"><Input value={f.nationalId} onChange={set('nationalId')} /></Field>
      <Field label="KRA PIN"><Input value={f.kraPin} onChange={set('kraPin')} /></Field>
      {initial && <Field label="Status"><Select value={(f as Record<string, string>).status ?? initial.status} onChange={(e) => setF({ ...f, status: e.target.value } as typeof f)}>{['active', 'on_leave', 'terminated'].map((x) => <option key={x}>{x}</option>)}</Select></Field>}
      <div className="space-y-2 sm:col-span-3"><ErrorText error={save.error} /><Button onClick={() => save.mutate()} loading={save.isPending} disabled={f.fullName.trim().length < 2}>{initial ? 'Save changes' : 'Add staff'}</Button></div>
    </div>
  );
}

export default function HrPage() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('staff');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  const [leaveStatus, setLeaveStatus] = useState('pending');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [lv, setLv] = useState({ staffId: '', type: 'annual', startDate: iso(new Date()), endDate: iso(new Date()), reason: '' });
  const [week, setWeek] = useState(() => monday(new Date()));
  const [branchId, setBranchId] = useState('');
  const [shiftOpen, setShiftOpen] = useState<{ date: string } | null>(null);
  const [sh, setSh] = useState({ staffId: '', shift: 'day', department: '' });
  const [verify, setVerify] = useState<{ staff: Staff; result?: unknown; error?: unknown } | null>(null);

  const staff = useQuery({ queryKey: ['hr-staff', q], queryFn: async () => (await api<Staff[]>('/hr/staff', { query: { q } })).data });
  const leave = useQuery({ queryKey: ['hr-leave', leaveStatus], queryFn: async () => (await api<Leave[]>('/hr/leave', { query: { status: leaveStatus } })).data, enabled: tab === 'leave' });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const shifts = useQuery({ queryKey: ['hr-shifts', iso(week), branchId], queryFn: async () => (await api<Shift[]>('/hr/shifts', { query: { from: iso(week), to: iso(addDays(week, 6)), branchId } })).data, enabled: tab === 'roster' });
  const alerts = useQuery({ queryKey: ['hr-licences'], queryFn: async () => (await api<Staff[]>('/hr/staff/license-alerts', { query: { days: 90 } })).data });

  const decide = useMutation({ mutationFn: ({ id, d }: { id: string; d: string }) => api(`/hr/leave/${id}/${d}`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leave'] }) });
  const requestLeave = useMutation({
    mutationFn: () => api('/hr/leave', { method: 'POST', body: { ...lv, staffId: lv.staffId || undefined, reason: lv.reason || undefined } }),
    onSuccess: () => { setLeaveOpen(false); qc.invalidateQueries({ queryKey: ['hr-leave'] }); },
  });
  const addShift = useMutation({
    mutationFn: () => api('/hr/shifts', { method: 'POST', body: { staffId: sh.staffId, branchId: branchId || me.data?.activeBranch?.id, date: shiftOpen!.date, shift: sh.shift, department: sh.department || undefined } }),
    onSuccess: () => { setShiftOpen(null); qc.invalidateQueries({ queryKey: ['hr-shifts'] }); },
  });
  const runVerify = async (s: Staff) => {
    setVerify({ staff: s });
    try {
      setVerify({ staff: s, result: (await api(`/hr/staff/${s._id}/verify-registry`, { method: 'POST' })).data });
    } catch (e) {
      setVerify({ staff: s, error: e });
    }
  };
  const active = (staff.data ?? []).filter((s) => s.status !== 'terminated');

  return (
    <>
      <PageHeader title="Human Resources" crumbs={['Administration', 'HR']} actions={can('hr.manage') && tab === 'staff' && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add staff</Button>} />
      {(alerts.data ?? []).length > 0 && tab !== 'licences' && (
        <Alert tone="amber" title="Practising licences need attention">{alerts.data!.length} staff member(s) have a licence expired or expiring within 90 days. <button className="underline" onClick={() => setTab('licences')}>Review</button></Alert>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'staff', label: 'Staff' }, { key: 'leave', label: 'Leave' }, { key: 'roster', label: 'Duty roster' }, { key: 'licences', label: 'Licences' }]} />

      {tab === 'staff' && (
        <Card actions={<Input placeholder="Search name or employee no." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />}>
          {staff.isLoading && <Loading />}
          <Table head={['Emp. no.', 'Name', 'Cadre / title', 'Department', 'Branch', 'Licence', 'Status', '']} empty={(staff.data ?? []).length === 0}>
            {staff.data?.map((s) => {
              const left = daysLeft(s.licenseExpiry);
              return (
                <tr key={s._id}>
                  <Td className="font-mono text-xs">{s.employeeNumber}</Td>
                  <Td className="font-medium">{s.fullName}<span className="muted block text-xs">{s.employmentType}</span></Td>
                  <Td>{s.cadre ?? '—'}<span className="muted block text-xs">{s.jobTitle}</span></Td>
                  <Td>{s.department ?? '—'}</Td>
                  <Td>{typeof s.branchId === 'object' ? s.branchId.branchName : '—'}</Td>
                  <Td className="text-xs">{s.licenseNumber ?? '—'}{s.licenseExpiry && <span className={left! < 0 ? 'block text-red-600' : left! < 60 ? 'block text-amber-600' : 'muted block'}>exp. {fmtDate(s.licenseExpiry)}</span>}</Td>
                  <Td><Badge tone={statusTone(s.status)}>{s.status.replace('_', ' ')}</Badge></Td>
                  <Td className="whitespace-nowrap text-right">
                    {can('hr.manage') && <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                      {(s.licenseNumber || s.nationalId) && <Button size="sm" variant="ghost" onClick={() => runVerify(s)}>Verify</Button>}
                    </>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {tab === 'leave' && (
        <Card actions={<div className="flex gap-2"><Select value={leaveStatus} onChange={(e) => setLeaveStatus(e.target.value)} className="w-36"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select><Button size="sm" onClick={() => setLeaveOpen(true)}><Plus className="h-4 w-4" /> Leave request</Button></div>}>
          <ErrorText error={decide.error} />
          {leave.isLoading && <Loading />}
          <Table head={['Staff', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', '']} empty={(leave.data ?? []).length === 0}>
            {leave.data?.map((l) => (
              <tr key={l._id}>
                <Td className="font-medium">{l.staffId?.fullName}<span className="muted block text-xs">{l.staffId?.employeeNumber} {l.staffId?.department && `· ${l.staffId.department}`}</span></Td>
                <Td className="capitalize">{l.type}</Td><Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                <Td className="max-w-56 truncate text-xs">{l.reason ?? '—'}</Td>
                <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td>
                <Td className="whitespace-nowrap text-right">{l.status === 'pending' && can('hr.manage') && <>
                  <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: l._id, d: 'approve' })}>Approve</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: l._id, d: 'reject' })}>Reject</Button>
                </>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'roster' && (
        <Card
          title={`Week of ${fmtDate(week)}`}
          actions={
            <div className="flex items-center gap-2">
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-44"><option value="">All branches</option>{me.data?.branches.map((b) => <option key={b._id} value={b._id}>{b.branchName}</option>)}</Select>
              <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setWeek(monday(new Date()))}>This week</Button>
              <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          }
        >
          {shifts.isLoading && <Loading />}
          <div className="grid gap-2 overflow-x-auto sm:grid-cols-7">
            {days.map((d) => {
              const list = (shifts.data ?? []).filter((s) => s.date.slice(0, 10) === iso(d));
              return (
                <div key={iso(d)} className="min-h-40 rounded-lg border border-[var(--border)] p-2">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                    <span>{d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    {can('hr.manage') && <button className="text-brand-600" onClick={() => { addShift.reset(); setShiftOpen({ date: iso(d) }); }} aria-label="Add shift"><Plus className="h-3.5 w-3.5" /></button>}
                  </div>
                  <ul className="space-y-1">
                    {list.map((s) => (
                      <li key={s._id} className="rounded bg-[var(--surface-2)] px-2 py-1 text-xs">
                        <span className="font-medium">{s.staffId?.fullName}</span>
                        <span className="muted block capitalize">{s.shift.replace('_', ' ')}{s.department && ` · ${s.department}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === 'licences' && (
        <Card title="Licences expired or expiring within 90 days">
          <Table head={['Staff', 'Cadre', 'Licence', 'Body', 'Expiry', '']} empty={(alerts.data ?? []).length === 0}>
            {alerts.data?.map((s) => {
              const left = daysLeft(s.licenseExpiry)!;
              return (
                <tr key={s._id}>
                  <Td className="font-medium">{s.fullName}</Td><Td>{s.cadre ?? '—'}</Td><Td>{s.licenseNumber ?? '—'}</Td><Td>{s.licenseBody ?? '—'}</Td>
                  <Td>{fmtDate(s.licenseExpiry)} <Badge tone={left < 0 ? 'red' : 'amber'}>{left < 0 ? `expired ${-left}d ago` : `${left}d left`}</Badge></Td>
                  <Td>{can('hr.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Update</Button>}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' || !editing ? 'Add staff member' : `Edit ${editing.fullName}`} wide>
        {editing && <StaffForm key={editing === 'new' ? 'new' : editing._id} initial={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['hr-staff'] }); qc.invalidateQueries({ queryKey: ['hr-licences'] }); }} />}
      </Modal>

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave request">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Staff member" className="sm:col-span-2" hint="Leave blank to request your own leave">
            <Select value={lv.staffId} onChange={(e) => setLv({ ...lv, staffId: e.target.value })}><option value="">Myself</option>{active.map((s) => <option key={s._id} value={s._id}>{s.fullName} ({s.employeeNumber})</option>)}</Select>
          </Field>
          <Field label="Type"><Select value={lv.type} onChange={(e) => setLv({ ...lv, type: e.target.value })}>{['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <div />
          <Field label="From"><Input type="date" value={lv.startDate} onChange={(e) => setLv({ ...lv, startDate: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={lv.endDate} onChange={(e) => setLv({ ...lv, endDate: e.target.value })} /></Field>
          <Field label="Reason" className="sm:col-span-2"><Input value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} /></Field>
          <div className="space-y-2 sm:col-span-2"><ErrorText error={requestLeave.error} /><Button onClick={() => requestLeave.mutate()} loading={requestLeave.isPending}>Submit</Button></div>
        </div>
      </Modal>

      <Modal open={!!shiftOpen} onClose={() => setShiftOpen(null)} title={`Assign shift — ${shiftOpen ? fmtDate(shiftOpen.date) : ''}`}>
        <div className="space-y-3">
          {!branchId && !me.data?.activeBranch && <Alert tone="amber">Select a branch filter first.</Alert>}
          <Field label="Staff"><Select value={sh.staffId} onChange={(e) => setSh({ ...sh, staffId: e.target.value })}><option value="">Select…</option>{active.map((s) => <option key={s._id} value={s._id}>{s.fullName}{s.cadre && ` — ${s.cadre}`}</option>)}</Select></Field>
          <Field label="Shift"><Select value={sh.shift} onChange={(e) => setSh({ ...sh, shift: e.target.value })}>{SHIFTS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></Field>
          <Field label="Department / ward"><Input value={sh.department} onChange={(e) => setSh({ ...sh, department: e.target.value })} /></Field>
          <ErrorText error={addShift.error} />
          <Button onClick={() => addShift.mutate()} loading={addShift.isPending} disabled={!sh.staffId || (!branchId && !me.data?.activeBranch)}>Assign</Button>
        </div>
      </Modal>

      <Modal open={!!verify} onClose={() => setVerify(null)} title={`Health Worker Registry — ${verify?.staff.fullName ?? ''}`}>
        {verify && (verify.error ? <ErrorText error={verify.error} /> : verify.result === undefined ? <Loading label="Querying DHA registry…" /> : (
          Array.isArray(verify.result) && verify.result.length === 0
            ? <Alert tone="amber"><AlertTriangle className="mr-1 inline h-4 w-4" />No matching record was returned by the registry.</Alert>
            : <pre className="max-h-96 overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(verify.result, null, 2)}</pre>
        ))}
      </Modal>
    </>
  );
}
