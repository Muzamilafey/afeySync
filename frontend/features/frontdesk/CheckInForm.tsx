'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, ApiError } from '@/services/api';
import { Alert, Badge, Button, ErrorText, Field, Input, Select, statusTone } from '@/components/ui';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { ServicePicker } from '@/features/billing/ServicePicker';
import type { Patient } from '@/types/api';
import { copayLabel, coverageLabel, type PayerScheme, type ServiceItem } from '@/features/billing/types';
import { STAGES, STAGE_LABEL } from './types';

export function CheckInForm({ preset, onDone }: { preset?: Patient | null; onDone?: () => void }) {
  const router = useRouter();
  const [patient, setPatient] = useState<Patient | null>(preset ?? null);
  const [f, setF] = useState({ type: 'opd', priority: 'normal', payer: 'cash', schemeId: '', scheme: '', memberNumber: '', complaint: '', firstStage: 'triage', referralFrom: '' });
  const [charges, setCharges] = useState<ServiceItem[]>([]);
  const schemeKind = f.payer === 'insurance' || f.payer === 'corporate';
  const schemes = useQuery({ queryKey: ['schemes', 'active'], queryFn: async () => (await api<PayerScheme[]>('/billing/schemes')).data, enabled: schemeKind, staleTime: 60_000 });
  const scheme = schemes.data?.find((s) => s._id === f.schemeId);
  const m = useMutation({
    mutationFn: async () =>
      (
        await api<{ visit: { _id: string; visitNumber: string }; queueEntry: { ticket: string } }>('/visits', {
          method: 'POST',
          body: {
            patientId: patient!._id,
            type: f.type,
            priority: f.priority,
            payer: { type: f.payer, schemeId: schemeKind && f.schemeId ? f.schemeId : undefined, scheme: schemeKind && !f.schemeId ? f.scheme || undefined : undefined, memberNumber: f.memberNumber || undefined },
            complaint: f.complaint || undefined,
            firstStage: f.firstStage,
            referralIn: f.referralFrom ? { from: f.referralFrom } : undefined,
            chargeServiceCodes: charges.map((c) => c.code),
          },
        })
      ).data,
  });
  const openVisit = m.error instanceof ApiError && m.error.code === 'VISIT_OPEN' ? (m.error.details as { visitId: string; visitNumber: string }) : null;
  if (m.data)
    return (
      <div className="space-y-3">
        <Alert tone="green" title={`Checked in — ticket ${m.data.queueEntry.ticket}`}>Visit {m.data.visit.visitNumber} created and queued for {STAGE_LABEL[f.firstStage]}.</Alert>
        <div className="flex gap-2">
          <Button onClick={() => router.push(`/visits/${m.data.visit._id}`)}>Open visit</Button>
          <Button variant="outline" onClick={() => { m.reset(); setPatient(null); setCharges([]); onDone?.(); }}>Next patient</Button>
        </div>
      </div>
    );
  const shaOk = patient?.sha?.status === 'eligible';
  return (
    <div className="space-y-4">
      <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field>
      {patient && <div className="flex gap-2"><Badge tone={statusTone(patient.sha?.status)}>SHA: {(patient.sha?.status ?? 'unknown').replace('_', ' ')}</Badge>{patient.clientRegistryId && <Badge tone="blue">{patient.clientRegistryId}</Badge>}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Visit type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['opd', 'maternity', 'mch', 'dental', 'family_planning', 'walk_in_lab', 'walk_in_pharmacy'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></Select></Field>
        <Field label="Send to"><Select value={f.firstStage} onChange={(e) => setF({ ...f, firstStage: e.target.value })}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select></Field>
        <Field label="Payer"><Select value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value, schemeId: '' })}><option value="cash">Cash</option><option value="sha">SHA</option><option value="insurance">Insurance</option><option value="corporate">Corporate</option></Select></Field>
        {schemeKind && (
          <Field label={f.payer === 'corporate' ? 'Company / scheme' : 'Insurance scheme'} hint={scheme ? `${coverageLabel(scheme.coverage)} · ${copayLabel(scheme.copay)}` : undefined}>
            <Select value={f.schemeId} onChange={(e) => setF({ ...f, schemeId: e.target.value })}>
              <option value="">{(schemes.data ?? []).some((s) => s.kind === f.payer) ? 'Select scheme…' : 'Not listed (type below)'}</option>
              {schemes.data?.filter((s) => s.kind === f.payer).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </Select>
            {!f.schemeId && <Input className="mt-1" placeholder="Scheme name" value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })} />}
          </Field>
        )}
        {f.payer !== 'cash' && <Field label="Member number"><Input value={f.memberNumber} onChange={(e) => setF({ ...f, memberNumber: e.target.value })} /></Field>}
      </div>
      {f.payer === 'sha' && patient && !shaOk && <Alert tone="amber">SHA eligibility must be checked (within 24h) before an SHA visit. <Link className="font-semibold underline" href={`/patients/${patient._id}`}>Check eligibility</Link></Alert>}
      <Field label="Presenting complaint"><Input value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} /></Field>
      <Field label="Referred in from (optional)"><Input value={f.referralFrom} onChange={(e) => setF({ ...f, referralFrom: e.target.value })} /></Field>
      <Field label="Charges at check-in (e.g. registration / consultation fee)"><ServicePicker priceList={f.payer === 'sha' ? 'sha' : f.payer === 'cash' ? 'cash' : scheme?.priceList ?? 'insurance'} onPick={(s) => setCharges([...charges.filter((c) => c.code !== s.code), s])} /></Field>
      {charges.length > 0 && <div className="flex flex-wrap gap-2">{charges.map((c) => <Badge key={c.code}>{c.name} <button onClick={() => setCharges(charges.filter((x) => x.code !== c.code))}>×</button></Badge>)}</div>}
      {openVisit && <Alert tone="amber" title="Patient already has an open visit">{openVisit.visitNumber} <Link className="font-semibold underline" href={`/visits/${openVisit.visitId}`}>Open it</Link></Alert>}
      {!openVisit && <ErrorText error={m.error} />}
      {scheme?.coverage === 'capitation' && <Alert tone="blue">Capitation scheme: the patient pays only the copay ({copayLabel(scheme.copay).replace('Copay ', '')}); the rest is covered by {scheme.name}&apos;s monthly fee.</Alert>}
      <Button onClick={() => m.mutate()} disabled={!patient || (!!f.schemeId && !f.memberNumber)} loading={m.isPending}>Check in</Button>
    </div>
  );
}
