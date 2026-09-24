'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Badge, Button, ErrorText, Field, Input, Select } from '@/components/ui';

const FIELDS: Array<[string, string, number?, number?]> = [
  ['temperatureC', 'Temp (°C)', 25, 45],
  ['pulse', 'Pulse (bpm)', 20, 250],
  ['respiratoryRate', 'Resp. rate', 4, 80],
  ['systolic', 'Systolic', 40, 300],
  ['diastolic', 'Diastolic', 20, 200],
  ['spo2', 'SpO₂ (%)', 40, 100],
  ['weightKg', 'Weight (kg)', 0.3, 400],
  ['heightCm', 'Height (cm)', 20, 250],
  ['muacCm', 'MUAC (cm)', 5, 60],
  ['painScore', 'Pain (0-10)', 0, 10],
  ['bloodGlucose', 'RBS (mmol/L)', 0.5, 60],
];

export interface VitalsRow { _id: string; recordedAt: string; recordedByName?: string; temperatureC?: number; pulse?: number; respiratoryRate?: number; systolic?: number; diastolic?: number; spo2?: number; weightKg?: number; heightCm?: number; bmi?: number; muacCm?: number; painScore?: number; bloodGlucose?: number; triageCategory?: string; flags?: string[]; notes?: string }

export function VitalsForm({ visitId, admissionId, onSaved }: { visitId?: string; admissionId?: string; onSaved?: (v: VitalsRow) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  const [triage, setTriage] = useState('');
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { visitId, admissionId, notes: notes || undefined, triageCategory: triage || undefined };
      for (const [k] of FIELDS) if (v[k]) body[k] = Number(v[k]);
      return (await api<VitalsRow>('/opd/vitals', { method: 'POST', body })).data;
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['visit'] }); qc.invalidateQueries({ queryKey: ['vitals'] }); onSaved?.(row); },
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIELDS.map(([k, label, min, max]) => <Field key={k} label={label}><Input type="number" step="any" min={min} max={max} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
        {visitId && <Field label="Triage category"><Select value={triage} onChange={(e) => setTriage(e.target.value)}><option value="">Auto-suggest</option><option value="emergency">Emergency</option><option value="priority">Priority</option><option value="queue">Queue</option></Select></Field>}
      </div>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={m.error} />
      {m.data && <Alert tone={m.data.flags?.length ? 'amber' : 'green'} title={`Saved — triage: ${m.data.triageCategory}`}>{m.data.flags?.map((f) => <Badge key={f} tone="red" className="mr-1">{f}</Badge>)}{m.data.bmi && ` BMI ${m.data.bmi}`}</Alert>}
      <Button onClick={() => m.mutate()} loading={m.isPending}>Save vitals</Button>
    </div>
  );
}
