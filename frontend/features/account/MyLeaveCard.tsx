'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table, Td, statusTone } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

interface MyLeave { staff: { fullName: string; employeeNumber: string } | null; items: Array<{ _id: string; type: string; startDate: string; endDate: string; days: number; status: string }> }

/** Self-service leave: request and track your own leave (approval is by HR, never by yourself). */
export function MyLeaveCard() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: 'annual', startDate: today, endDate: today, reason: '' });
  const q = useQuery({ queryKey: ['my-leave'], queryFn: async () => (await api<MyLeave>('/hr/leave/mine')).data });
  const m = useMutation({ mutationFn: () => api('/hr/leave', { method: 'POST', body: { ...f, reason: f.reason || undefined } }), onSuccess: () => { setF({ ...f, reason: '' }); qc.invalidateQueries({ queryKey: ['my-leave'] }); } });
  if (!q.data?.staff) return null;
  return (
    <Card title={`My leave — ${q.data.staff.fullName} (${q.data.staff.employeeNumber})`} className="">
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="From"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="space-y-2 sm:col-span-4"><ErrorText error={m.error} /><Button size="sm" onClick={() => m.mutate()} loading={m.isPending}>Request leave</Button></div>
      </div>
      <Table head={['Type', 'From', 'To', 'Days', 'Status']} empty={q.data.items.length === 0}>
        {q.data.items.map((l) => <tr key={l._id}><Td className="capitalize">{l.type}</Td><Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td><Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td></tr>)}
      </Table>
    </Card>
  );
}

