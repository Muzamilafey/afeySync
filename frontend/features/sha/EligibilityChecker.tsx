'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/services/api';
import { useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Select } from '@/components/ui';
import { IDENTIFICATION_TYPES, type Patient } from '@/types/api';
import { fmtDateTime, fullName } from '@/lib/utils';
import { RawJson } from './hieDisplay';

export interface EligibilityResult {
  id: string;
  status: 'eligible' | 'not_eligible' | 'error';
  eligible: boolean | null;
  identificationType: string;
  statusText?: string;
  memberName?: string;
  clientRegistryId?: string;
  scheme?: string;
  reason?: string;
  raw?: unknown;
  checkedAt: string;
}

export function EligibilityResultCard({ r, patientId }: { r: EligibilityResult; patientId?: string }) {
  const ok = r.status === 'eligible';
  return (
    <Card title="Result">
      <div className="mb-4 flex items-center gap-3">
        {ok ? <ShieldCheck className="h-8 w-8 text-emerald-600" /> : <ShieldX className="h-8 w-8 text-red-600" />}
        <div>
          <p className={`text-lg font-bold ${ok ? 'text-emerald-600' : 'text-red-600'}`}>● {ok ? 'ELIGIBLE' : r.status === 'not_eligible' ? 'NOT ELIGIBLE' : 'UNDETERMINED'}</p>
          <p className="muted text-xs">Checked {fmtDateTime(r.checkedAt)} using {r.identificationType}</p>
        </div>
      </div>
      <KV items={[['Member', r.memberName], ['CR ID', r.clientRegistryId], ['Scheme', r.scheme ?? 'SHA'], ['Status', r.statusText], ...(r.reason ? [['Reason', r.reason] as [string, string]] : [])]} />
      {patientId && ok && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/patients/${patientId}?tab=sha`}><Button variant="outline">VIEW BENEFITS</Button></Link>
          <Link href={`/patients/${patientId}?tab=sha&view=utilization`}><Button variant="outline">VIEW UTILIZATION</Button></Link>
        </div>
      )}
      <RawJson data={r.raw} />
    </Card>
  );
}

export function EligibilityChecker() {
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [idType, setIdType] = useState('ClientRegistry ID');
  const [idNumber, setIdNumber] = useState('');
  const search = useQuery({ queryKey: ['elig-patient-search', q], queryFn: async () => (await api<Patient[]>('/patients/search', { query: { q, limit: 6 } })).data, enabled: q.trim().length >= 2 && !patient });
  const check = useMutation({
    mutationFn: async () => (await api<EligibilityResult>('/sha/eligibility', { method: 'POST', body: patient ? { patientId: patient._id } : { identificationType: idType, identificationNumber: idNumber.trim() } })).data,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="SHA Eligibility">
        {!me?.integrations.sha.enabled && <div className="mb-3"><Alert tone="amber">{me?.integrations.sha.message ?? 'SHA integration is not enabled.'}</Alert></div>}
        <div className="space-y-4">
          <Field label="Patient" hint="Search an AfeySync patient — the ClientRegistry ID is used when available.">
            {patient ? (
              <div className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <span><strong>{fullName(patient)}</strong> · {patient.patientNumber} {patient.clientRegistryId && `· ${patient.clientRegistryId}`}</span>
                <button className="text-xs text-brand-600" onClick={() => { setPatient(null); check.reset(); }}>Change</button>
              </div>
            ) : (
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient…" />
            )}
          </Field>
          {!patient && search.data && search.data.length > 0 && (
            <ul className="surface divide-y divide-[var(--border)] rounded-md text-sm">
              {search.data.map((p) => (
                <li key={p._id}><button className="w-full px-3 py-2 text-left hover:bg-[var(--surface-2)]" onClick={() => setPatient(p)}>{fullName(p)} <span className="muted">· {p.patientNumber} {p.clientRegistryId && `· ${p.clientRegistryId}`}</span></button></li>
              ))}
            </ul>
          )}
          {!patient && (
            <>
              <p className="muted text-center text-xs font-semibold">OR CHECK BY IDENTIFICATION</p>
              <div className="grid grid-cols-[180px_1fr] gap-2">
                <Select value={idType} onChange={(e) => setIdType(e.target.value)}>{IDENTIFICATION_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Identification number" />
              </div>
            </>
          )}
          <Button onClick={() => check.mutate()} loading={check.isPending} disabled={!me?.integrations.sha.enabled || (!patient && idNumber.trim().length < 3)}>CHECK</Button>
          {patient && !patient.clientRegistryId && <Badge tone="amber">No CR ID — a fallback identifier will be used</Badge>}
          <ErrorText error={check.error} />
        </div>
      </Card>
      {check.data && <EligibilityResultCard r={check.data} patientId={patient?._id} />}
    </div>
  );
}
