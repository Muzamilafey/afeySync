'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Siren } from 'lucide-react';
import { api } from '@/services/api';
import { Alert, Button, ErrorText, Field, Input, Select } from '@/components/ui';

export function EmergencyForm() {
  const router = useRouter();
  const [f, setF] = useState({ firstName: '', lastName: '', gender: 'unknown', age: '', phone: '', description: '', broughtBy: '' });
  const m = useMutation({
    mutationFn: async () => (await api<{ visit: { _id: string } }>('/visits/emergency', { method: 'POST', body: { firstName: f.firstName || undefined, lastName: f.lastName || undefined, gender: f.gender, estimatedAgeYears: f.age ? Number(f.age) : undefined, phone: f.phone || undefined, description: f.description || undefined, broughtBy: f.broughtBy || undefined } })).data,
    onSuccess: (d) => router.push(`/visits/${d.visit._id}`),
  });
  return (
    <div className="space-y-4">
      <Alert tone="red" title="Emergency registration">Capture the minimum and treat first. Identify the patient (DHA search / merge) once stable.</Alert>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="First name (if known)"><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
        <Field label="Last name"><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
        <Field label="Sex"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
        <Field label="Estimated age (years)"><Input type="number" min={0} max={120} value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Brought by"><Input value={f.broughtBy} onChange={(e) => setF({ ...f, broughtBy: e.target.value })} /></Field>
      </div>
      <Field label="What happened"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <ErrorText error={m.error} />
      <Button variant="danger" onClick={() => m.mutate()} loading={m.isPending}><Siren className="h-4 w-4" /> Register emergency</Button>
    </div>
  );
}
