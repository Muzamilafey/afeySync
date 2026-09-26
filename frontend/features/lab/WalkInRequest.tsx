'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Button, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { LabTestSelector, type LabSelection } from './LabTestSelector';

type Patient = Parameters<typeof PatientPicker>[0]['value'];

/** Walk-in or outside-doctor lab request, straight at the lab (no consultation needed). */
export function WalkInRequest({ onDone }: { onDone: (orderId: string) => void }) {
  const qc = useQueryClient();
  const [patient, setPatient] = useState<Patient>(null);
  const [sel, setSel] = useState<LabSelection>({ tests: [], packages: [] });
  const [payer, setPayer] = useState<'cash' | 'insurance' | 'corporate' | 'sha'>('cash');
  const [scheme, setScheme] = useState('');
  const [member, setMember] = useState('');
  const [ext, setExt] = useState({ name: '', facility: '', reference: '' });
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: async () => (await api<{ order: { _id: string; orderNumber: string } }>('/laboratory/walk-in', {
      method: 'POST',
      body: { patientId: patient!._id, payer: { type: payer, scheme: scheme || undefined, memberNumber: member || undefined }, tests: sel.tests.map((t) => t.code), packages: sel.packages.map((p) => p.code), priority, clinicalNotes: notes || undefined, externalRequester: ext.name || ext.facility || ext.reference ? ext : undefined },
    })).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['lab-worklist'] }); qc.invalidateQueries({ queryKey: ['lab-counts'] }); onDone(r.order._id); },
  });
  return (
    <div className="space-y-3">
      <Field label="Patient *"><PatientPicker value={patient} onChange={setPatient} /></Field>
      <p className="muted -mt-1 text-xs">New patient? <Link href="/frontdesk" className="text-brand-600 hover:underline">Register them at the front desk</Link> first.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Payer"><Select value={payer} onChange={(e) => setPayer(e.target.value as typeof payer)}><option value="cash">Cash</option><option value="insurance">Insurance</option><option value="corporate">Corporate</option><option value="sha">SHA</option></Select></Field>
        {payer !== 'cash' && payer !== 'sha' && <Field label="Scheme"><Input value={scheme} onChange={(e) => setScheme(e.target.value)} /></Field>}
        {payer !== 'cash' && <Field label="Member number"><Input value={member} onChange={(e) => setMember(e.target.value)} /></Field>}
      </div>
      <Field label="Tests and packages *"><LabTestSelector value={sel} onChange={setSel} /></Field>
      <div className="rounded-lg border border-[var(--border)] p-3">
        <p className="mb-2 text-sm font-semibold">Requested by (outside clinician, optional)</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="Doctor / clinician" value={ext.name} onChange={(e) => setExt({ ...ext, name: e.target.value })} />
          <Input placeholder="Facility" value={ext.facility} onChange={(e) => setExt({ ...ext, facility: e.target.value })} />
          <Input placeholder="Request / referral no." value={ext.reference} onChange={(e) => setExt({ ...ext, reference: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></Select></Field>
        <Field label="Clinical notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {payer === 'sha' && <Alert tone="amber">SHA walk-ins need an SHA eligibility check in the last 24 hours.</Alert>}
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!patient || (!sel.tests.length && !sel.packages.length)}>Register request & bill</Button>
    </div>
  );
}
