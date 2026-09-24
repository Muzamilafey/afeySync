'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, statusTone, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import type { Patient } from '@/types/api';

interface Appt { _id: string; appointmentNumber: string; scheduledAt: string; durationMinutes: number; status: string; reason?: string; providerName?: string; department?: string; patientId: { _id: string; patientNumber: string; firstName: string; lastName: string; phone?: string } }

export default function AppointmentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [f, setF] = useState({ scheduledAt: '', durationMinutes: 15, providerId: '', department: '', reason: '' });
  const list = useQuery({ queryKey: ['appointments', from, to], queryFn: async () => (await api<Appt[]>('/appointments', { query: { from, to } })).data });
  const providers = useQuery({ queryKey: ['providers'], queryFn: async () => (await api<Array<{ _id: string; name: string }>>('/appointments/providers')).data, enabled: open });
  const create = useMutation({
    mutationFn: () => api('/appointments', { method: 'POST', body: { patientId: patient!._id, scheduledAt: new Date(f.scheduledAt).toISOString(), durationMinutes: f.durationMinutes, providerId: f.providerId || undefined, department: f.department || undefined, reason: f.reason || undefined } }),
    onSuccess: () => { setOpen(false); setPatient(null); qc.invalidateQueries({ queryKey: ['appointments'] }); },
  });
  const act = useMutation({
    mutationFn: ({ a, action }: { a: Appt; action: string }) => (action === 'checkin' ? api('/visits', { method: 'POST', body: { patientId: a.patientId._id, appointmentId: a._id } }) : api(`/appointments/${a._id}/${action}`, { method: 'POST' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
  return (
    <>
      <PageHeader title="Appointments" crumbs={['Front Desk', 'Appointments']} actions={can('appointments.manage') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Book appointment</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input type="date" className="max-w-44" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <Input type="date" className="max-w-44" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error || act.error} />
        {list.data && (
          <Table head={['Time', 'Patient', 'Provider / Dept', 'Reason', 'Status', '']} empty={list.data.length === 0}>
            {list.data.map((a) => (
              <tr key={a._id}>
                <Td className="whitespace-nowrap">{fmtDateTime(a.scheduledAt)}<span className="muted block text-xs">{a.durationMinutes} min · {a.appointmentNumber}</span></Td>
                <Td>{a.patientId.firstName} {a.patientId.lastName}<span className="muted block text-xs">{a.patientId.patientNumber} · {a.patientId.phone}</span></Td>
                <Td>{a.providerName ?? '—'}<span className="muted block text-xs">{a.department}</span></Td>
                <Td>{a.reason}</Td>
                <Td><Badge tone={statusTone(a.status === 'booked' ? 'pending' : a.status === 'checked_in' ? 'completed' : 'failed')}>{a.status.replace('_', ' ')}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {a.status === 'booked' && can('queue.manage') && <Button size="sm" onClick={() => act.mutate({ a, action: 'checkin' })}>Check in</Button>}{' '}
                  {a.status === 'booked' && can('appointments.manage') && <><Button size="sm" variant="ghost" onClick={() => act.mutate({ a, action: 'no-show' })}>No-show</Button><Button size="sm" variant="ghost" onClick={() => act.mutate({ a, action: 'cancel' })}>Cancel</Button></>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Book appointment" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient" className="col-span-full"><PatientPicker value={patient} onChange={setPatient} /></Field>
          <Field label="Date & time"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
          <Field label="Duration (min)"><Input type="number" min={5} max={240} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} /></Field>
          <Field label="Provider"><Select value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}><option value="">Any</option>{providers.data?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select></Field>
          <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
          <Field label="Reason" className="col-span-full"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <div className="col-span-full space-y-2"><ErrorText error={create.error} /><Button onClick={() => create.mutate()} disabled={!patient || !f.scheduledAt} loading={create.isPending}>Book (SMS confirmation sent)</Button></div>
        </div>
      </Modal>
    </>
  );
}
