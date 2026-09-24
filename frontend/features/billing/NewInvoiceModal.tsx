'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { Button, ErrorText, Field, Input, Modal } from '@/components/ui';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { ServicePicker } from './ServicePicker';
import type { Patient } from '@/types/api';
import type { Invoice, ServiceItem } from './types';

export function NewInvoiceModal({ open, onClose, patient: preset }: { open: boolean; onClose: () => void; patient?: Patient | null }) {
  const router = useRouter();
  const [patient, setPatient] = useState<Patient | null>(preset ?? null);
  const [lines, setLines] = useState<Array<{ s: ServiceItem; quantity: number }>>([]);
  const m = useMutation({
    mutationFn: async () => (await api<Invoice>('/billing/invoices', { method: 'POST', body: { patientId: patient!._id, lines: lines.map((l) => ({ serviceCode: l.s.code, quantity: l.quantity })) } })).data,
    onSuccess: (inv) => router.push(`/billing/invoices/${inv._id}`),
  });
  return (
    <Modal open={open} onClose={onClose} title="New invoice" wide>
      <div className="space-y-4">
        <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field>
        <Field label="Add service"><ServicePicker onPick={(s) => setLines([...lines, { s, quantity: 1 }])} /></Field>
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[1fr_90px_auto] items-center gap-2 text-sm">
              <span>{l.s.code} — {l.s.name}</span>
              <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
        <ErrorText error={m.error} />
        <Button onClick={() => m.mutate()} disabled={!patient || lines.length === 0} loading={m.isPending}>Create invoice</Button>
      </div>
    </Modal>
  );
}
