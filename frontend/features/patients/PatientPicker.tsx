'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Input } from '@/components/ui';
import { fullName } from '@/lib/utils';
import type { Patient } from '@/types/api';

export function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['patient-picker', q], queryFn: async () => (await api<Patient[]>('/patients/search', { query: { q, limit: 8 } })).data, enabled: q.trim().length >= 2 && !value });
  if (value)
    return (
      <div className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
        <span><strong>{fullName(value)}</strong> · {value.patientNumber}</span>
        <button type="button" className="text-xs text-brand-600" onClick={(e) => { e.preventDefault(); onChange(null); }}>Change</button>
      </div>
    );
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient by name, phone, ID, AFS number" />
      {r.data && q.length >= 2 && (
        <ul className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md shadow-lg">
          {r.data.length === 0 && <li className="muted p-2 text-sm">No patients found</li>}
          {r.data.map((p) => (
            <li key={p._id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]" onClick={(e) => { e.preventDefault(); onChange(p); setQ(''); }}>{fullName(p)} <span className="muted">· {p.patientNumber} {p.phone && `· ${p.phone}`}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
