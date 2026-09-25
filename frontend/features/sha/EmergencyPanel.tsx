'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, Select } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

interface Emergency { protocols?: Array<{ code: string; name?: string; notes?: string; addedAt: string }>; doctors?: Array<{ name: string; registrationNumber: string; addedAt: string }> }
interface Doctor { _id: string; name: string; cadre?: string; registrationNumber: string | null }

/** Rows from SHA's protocol list, whatever its exact shape (the HIE contract defines it). */
function protocolOptions(data: unknown): Array<{ code: string; name: string }> {
  const arr = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown })?.data) ? (data as { data: unknown[] }).data : [];
  return arr.map((p) => {
    const o = p as Record<string, unknown>;
    return { code: String(o.code ?? o.protocol_code ?? o.id ?? ''), name: String(o.name ?? o.description ?? o.title ?? o.code ?? '') };
  }).filter((p) => p.code);
}

export function EmergencyPanel({ txId, emergency, editable }: { txId: string; emergency?: Emergency; editable: boolean }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['sha-tx-detail', txId] });
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [doctor, setDoctor] = useState('');
  const protocols = useQuery({ queryKey: ['sha-protocols'], queryFn: async () => (await api<unknown>('/sha/emergency/protocols')).data, enabled: editable, retry: false });
  const doctors = useQuery({ queryKey: ['sha-er-doctors'], queryFn: async () => (await api<Doctor[]>('/sha/emergency/doctors')).data, enabled: editable });
  const addProtocol = useMutation({ mutationFn: () => api(`/sha/transactions/${txId}/emergency/protocols`, { method: 'POST', body: { code, name: protocolOptions(protocols.data).find((p) => p.code === code)?.name, notes: notes || undefined } }), onSuccess: () => { setCode(''); setNotes(''); refresh(); } });
  const addDoctor = useMutation({ mutationFn: () => api(`/sha/transactions/${txId}/emergency/doctors`, { method: 'POST', body: { userId: doctor } }), onSuccess: () => { setDoctor(''); refresh(); } });
  const removeDoctor = useMutation({ mutationFn: (reg: string) => api(`/sha/transactions/${txId}/emergency/doctors/${encodeURIComponent(reg)}`, { method: 'DELETE' }), onSuccess: refresh });
  const opts = protocolOptions(protocols.data);
  const listErr = protocols.error instanceof ApiError && protocols.error.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED';
  return (
    <Card title="Emergency protocols & attending doctors">
      <div className="space-y-5">
        <div>
          <p className="label">Protocols</p>
          <ul className="mb-2 space-y-1 text-sm">{(emergency?.protocols ?? []).map((p) => <li key={p.code}><span className="font-mono text-xs">{p.code}</span> {p.name} <span className="muted text-xs">{fmtDateTime(p.addedAt)}</span>{p.notes && <span className="muted block text-xs">{p.notes}</span>}</li>)}</ul>
          {!(emergency?.protocols ?? []).length && <p className="muted mb-2 text-sm">None added.</p>}
          {editable && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              {opts.length ? (
                <Select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Protocol"><option value="">Select SHA protocol…</option>{opts.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</Select>
              ) : <Input placeholder="Protocol code" value={code} onChange={(e) => setCode(e.target.value)} />}
              <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button size="sm" onClick={() => addProtocol.mutate()} loading={addProtocol.isPending} disabled={!code}>Add</Button>
            </div>
          )}
          {listErr && <p className="mt-1 text-xs text-amber-700">SHA protocol list operation is not configured yet; enter the code manually.</p>}
          <ErrorText error={addProtocol.error} />
        </div>
        <div>
          <p className="label">Attending doctors</p>
          <ul className="mb-2 space-y-1 text-sm">
            {(emergency?.doctors ?? []).map((d) => (
              <li key={d.registrationNumber} className="flex items-center justify-between">
                <span>{d.name} <span className="muted font-mono text-xs">{d.registrationNumber}</span></span>
                {editable && <Button size="sm" variant="ghost" aria-label="Remove doctor" onClick={() => removeDoctor.mutate(d.registrationNumber)}><Trash2 className="h-4 w-4" /></Button>}
              </li>
            ))}
          </ul>
          {editable && (
            <div className="flex gap-2">
              <Field label="" className="flex-1">
                <Select value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor">
                  <option value="">Select doctor…</option>
                  {doctors.data?.map((d) => <option key={d._id} value={d._id} disabled={!d.registrationNumber}>{d.name}{d.cadre ? ` (${d.cadre})` : ''}{d.registrationNumber ? ` · ${d.registrationNumber}` : ' · no licence on profile'}</option>)}
                </Select>
              </Field>
              <Button size="sm" className="self-end" onClick={() => addDoctor.mutate()} loading={addDoctor.isPending} disabled={!doctor}>Add</Button>
            </div>
          )}
          <ErrorText error={addDoctor.error ?? removeDoctor.error} />
        </div>
        {!editable && <Alert tone="blue">Protocols and doctors can be added after the emergency claim is submitted to SHA.</Alert>}
      </div>
    </Card>
  );
}
