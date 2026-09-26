'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { age, fmtDateTime } from '@/lib/utils';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import type { Prescription } from '@/features/pharmacy/types';

type Rx = Prescription & { purpose?: 'treatment' | 'discharge'; patient: { patientNumber: string; firstName: string; lastName: string; gender: string; dateOfBirth?: string; allergies?: Array<{ substance: string }> } };
const FREQ: Record<string, string> = { OD: 'once daily', BD: 'twice daily', TDS: 'three times daily', QID: 'four times daily', Q4H: 'every 4 hours', Q6H: 'every 6 hours', Q8H: 'every 8 hours', Q12H: 'every 12 hours', NOCTE: 'at night', MANE: 'in the morning', PRN: 'when required', STAT: 'once, immediately', EOD: 'every other day', WEEKLY: 'once a week' };

/** The prescription note: for the patient to take away (or to another pharmacy), on the facility letterhead. */
export default function PrescriptionPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['rx-print', id], queryFn: async () => (await api<Rx>(`/pharmacy/prescriptions/${id}`)).data });
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const rx = q.data;
  const p = rx.patient;
  const items = rx.items.filter((i) => i.status !== 'cancelled');
  return (
    <div className="space-y-4 text-sm">
      <PrintButton />
      <Letterhead title={rx.purpose === 'discharge' ? 'DISCHARGE PRESCRIPTION' : 'PRESCRIPTION'} meta={<p className="text-xs">{rx.rxNumber}<br />{fmtDateTime(rx.createdAt)}</p>} />
      <div className="grid grid-cols-2 gap-1 rounded border border-slate-300 p-3">
        <p>Patient: <strong>{p.firstName} {p.lastName}</strong></p><p>Patient No: {p.patientNumber}</p>
        <p>Sex / Age: {p.gender} / {age(p.dateOfBirth)}</p>
        <p>Allergies: <strong>{p.allergies?.length ? p.allergies.map((a) => a.substance).join(', ') : 'None recorded'}</strong></p>
      </div>
      <p className="text-2xl font-serif font-bold">℞</p>
      <ol className="space-y-3">
        {items.map((i, n) => (
          <li key={i._id} className="border-b border-slate-200 pb-2">
            <p className="font-semibold">{n + 1}. {i.drugName}</p>
            <p>{[i.dose, i.frequency && (FREQ[i.frequency] ?? i.frequency), i.route, i.durationDays ? `for ${i.durationDays} day(s)` : ''].filter(Boolean).join(' · ')}</p>
            <p className="text-xs">Quantity: {i.quantity}{i.instructions ? ` · ${i.instructions}` : ''}{i.dispensedQuantity ? ` · Dispensed here: ${i.dispensedQuantity}` : ''}</p>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-8 pt-10 text-xs">
        <p className="border-t border-slate-500 pt-1">Prescriber: <strong>{rx.prescriberName}</strong><br />Signature</p>
        <p className="border-t border-slate-500 pt-1">Pharmacist / dispensed by</p>
      </div>
    </div>
  );
}
