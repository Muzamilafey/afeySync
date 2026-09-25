'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { fmtDateTime, fullName } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { UtilizationPanel } from '@/features/sha/BenefitsPanel';
import { humanize, isObj, pickStr, unwrapList } from '@/features/sha/hieDisplay';
import { InterventionBadges } from '@/features/sha/InterventionBadges';
import type { Decision, InterventionFlags } from '@/features/sha/shaVisitTypes';
import type { Patient } from '@/types/api';

type Obj = Record<string, unknown>;
const STEPS = ['Patient & eligibility', 'Benefits & interventions', 'Workflow', 'Create visit'];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-[var(--surface-2)]'}`}>{i < step ? '✓' : i + 1}</span>
          <span className={i === step ? 'font-semibold' : 'muted'}>{s}</span>
          {i < STEPS.length - 1 && <ChevronRight className="muted h-4 w-4" />}
        </li>
      ))}
    </ol>
  );
}

const flagsFrom = (o: Obj): InterventionFlags => {
  const b = (k: string) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : undefined);
  const l = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  return {
    code: pickStr(o, 'code', 'interventionCode', 'intervention_code') ?? '', name: pickStr(o, 'name', 'interventionName', 'intervention_name'),
    paymentMechanism: pickStr(o, 'paymentMechanism'), accessPoint: pickStr(o, 'accessPoint'), fund: pickStr(o, 'fund'),
    needsPreauth: b('needsPreauth'), needsManualPreauthApproval: b('needsManualPreauthApproval'), needsDoctorAuthorization: b('needsDoctorAuthorization'), needsMemberAuthorization: b('needsMemberAuthorization'), needApprovalBeforeClaimSubmission: b('needApprovalBeforeClaimSubmission'),
    specialPreauth: ['Surgical', 'Radiology', 'Optical', 'Oncology', 'Renal'].filter((k) => o[`requires${k}Preauth`] === true).map((k) => k.toLowerCase()),
    requiredPreauthDocumentTypes: l('requiredPreauthDocumentTypes'), applicableDocumentTypes: l('applicableDocumentTypes'),
  };
};

function Wizard() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const qc = useQueryClient();
  const [patient, setPatient] = useState<Patient | null>(null);
  const patientId = patient?._id ?? params.get('patientId');
  const [step, setStep] = useState(0);
  const [subBenefit, setSubBenefit] = useState('');
  const [search, setSearch] = useState('');
  const [accessPoint, setAccessPoint] = useState('');
  const [selected, setSelected] = useState<Record<string, InterventionFlags>>({});
  const [emergency, setEmergency] = useState(false);
  const [utilCode, setUtilCode] = useState<string | null>(null);

  const p = useQuery({ queryKey: ['patient', patientId], queryFn: async () => (await api<Patient>(`/patients/${patientId}`)).data, enabled: !!patientId });
  const elig = useMutation({ mutationFn: async () => (await api<Obj>('/sha/eligibility', { method: 'POST', body: { patientId } })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', patientId] }) });
  const pt = p.data;
  const fresh = pt?.sha?.lastCheckedAt && Date.now() - new Date(pt.sha.lastCheckedAt).getTime() < 24 * 3600_000;
  const deceased = pt?.sha?.isAlive === false;
  const ready = !!pt?.clientRegistryId && pt.sha?.status === 'eligible' && fresh && !deceased;

  const benefits = useQuery({ queryKey: ['sha-benefits', patientId], queryFn: async () => (await api<unknown>('/sha/benefits', { query: { patientId } })).data, enabled: step === 1 && !!ready });
  const subs = useQuery({ queryKey: ['sha-subbenefits', patientId], queryFn: async () => (await api<unknown>('/sha/sub-benefits', { query: { patientId } })).data, enabled: step === 1 && !!ready, retry: false });
  const interventions = useQuery({
    queryKey: ['sha-interventions', patientId, subBenefit, search, accessPoint],
    queryFn: async () => (await api<unknown>('/sha/interventions', { query: { patientId, sub_benefit_code: subBenefit, search, access_point: accessPoint, page_size: 50 } })).data,
    enabled: step === 1 && !!ready,
  });
  const decide = useMutation({ mutationFn: async () => (await api<{ interventions: InterventionFlags[]; decision: Decision }>('/sha/workflow', { method: 'POST', body: { patientId, interventionCodes: Object.keys(selected), emergency } })).data, onSuccess: () => setStep(2) });
  const create = useMutation({
    mutationFn: async () => (await api<{ _id: string }>('/sha/visits', { method: 'POST', body: { patientId, interventionCodes: Object.keys(selected), emergency, visitId: params.get('visitId') ?? undefined, admissionId: params.get('admissionId') ?? undefined } })).data,
    onSuccess: (v) => router.push(`/sha/visits/${v._id}`),
  });

  const intList = useMemo(() => unwrapList(interventions.data).map(flagsFrom).filter((i) => i.code), [interventions.data]);
  const subList = unwrapList(subs.data);
  const benList = unwrapList(benefits.data);
  const r = elig.data as Obj | undefined;

  if (!can('sha.authorization')) return <Alert tone="red">You need SHA authorization permission to start SHA visits.</Alert>;
  return (
    <>
      <PageHeader title="Start SHA visit" subtitle="Eligibility → benefits → interventions → workflow → consent → visit" crumbs={['SHA', 'Visits', 'New']} />
      <Stepper step={step} />

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Patient">
            {!patientId ? (
              <div className="space-y-2"><PatientPicker value={patient} onChange={setPatient} /><p className="muted text-xs">Not registered yet? <Link className="text-brand-600" href="/frontdesk">Search the DHA Client Registry</Link> by National ID or another identifier and import the patient first.</p></div>
            ) : p.isLoading ? <Loading /> : pt && (
              <div className="space-y-2 text-sm">
                <p className="text-lg font-semibold">{fullName(pt)}</p>
                <p className="muted">{pt.patientNumber} · {pt.gender}</p>
                <p>Client Registry ID: {pt.clientRegistryId ? <span className="font-mono">{pt.clientRegistryId}</span> : <Badge tone="red">missing</Badge>}</p>
                {!pt.clientRegistryId && <Alert tone="amber">Search this patient in the DHA Client Registry (Front Desk → Search DHA) and link the CR ID before SHA transactions.</Alert>}
                {!params.get('patientId') && <button className="text-xs text-brand-600" onClick={() => setPatient(null)}>Change patient</button>}
              </div>
            )}
          </Card>
          {pt && (
            <Card title="SHA eligibility" actions={<Button size="sm" onClick={() => elig.mutate()} loading={elig.isPending} disabled={!pt.clientRegistryId && !pt.nationalId}><ShieldCheck className="h-4 w-4" /> {fresh ? 'Re-check' : 'Check eligibility'}</Button>}>
              <ErrorText error={elig.error} />
              {deceased && <Alert tone="red" title="Beneficiary reported deceased">SHA eligibility returned isAlive = false. SHA visits, authorizations, preauthorizations, billing and claims are blocked.</Alert>}
              <div className="space-y-2 text-sm">
                <p>Status: <Badge tone={pt.sha?.status === 'eligible' ? 'green' : pt.sha?.status === 'not_eligible' ? 'red' : 'gray'}>{pt.sha?.status === 'eligible' ? 'ACTIVE' : pt.sha?.status === 'not_eligible' ? 'INACTIVE' : 'UNKNOWN'}</Badge> <span className="muted text-xs">{pt.sha?.lastCheckedAt ? `checked ${fmtDateTime(pt.sha.lastCheckedAt)}` : 'never checked'}</span></p>
                {pt.sha?.schemes?.length ? <p>Scheme(s): {pt.sha.schemes.map((s) => s.name ?? s.code).join(', ')}</p> : null}
                <p>OTP available: {pt.sha?.whitelistedForOTP === undefined ? '—' : pt.sha.whitelistedForOTP ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>} · Biometrics required: {pt.sha?.facilityBiometricsEnforced === undefined ? '—' : pt.sha.facilityBiometricsEnforced ? <Badge tone="amber">Yes</Badge> : <Badge>No</Badge>}</p>
                {pt.sha?.pomsf && <Alert tone="blue" title="POMSF cover">Scheme {pt.sha.pomsf.code} · policy {pt.sha.pomsf.policyNumber ?? '—'} · principal CR {pt.sha.pomsf.principalCrId ?? '—'}. Effective coverage is confirmed after consent.</Alert>}
                {r && isObj(r.raw) && <p className="muted text-xs">Name on SHA record: {pickStr(r.raw as Obj, 'fullName', 'full_name') ?? '—'}</p>}
              </div>
              <div className="mt-4">
                {!fresh && <p className="muted mb-2 text-xs">Eligibility must be checked within the last 24 hours.</p>}
                <Button onClick={() => setStep(1)} disabled={!ready}>Continue</Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Benefits">
              {benefits.isLoading ? <Loading /> : <ErrorText error={benefits.error} />}
              {benList.length === 0 && !benefits.isLoading && <p className="muted text-sm">No benefits returned.</p>}
              <ul className="space-y-1 text-sm">{benList.map((b, i) => <li key={i} className="flex justify-between gap-2"><span>{pickStr(b, 'name', 'benefit_name', 'benefitName', 'code')}</span><span className="muted font-mono text-xs">{pickStr(b, 'code', 'benefit_code')}</span></li>)}</ul>
            </Card>
            <Card title="Sub-benefits">
              {subs.isLoading ? <Loading /> : subs.error instanceof ApiError && subs.error.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED' ? <p className="muted text-sm">Sub-benefit lookup is not configured.</p> : <ErrorText error={subs.error} />}
              <Select value={subBenefit} onChange={(e) => setSubBenefit(e.target.value)} aria-label="Filter by sub-benefit">
                <option value="">All sub-benefits</option>
                {subList.map((s, i) => { const code = pickStr(s, 'sub_benefit_code', 'subBenefitCode', 'code') ?? ''; return <option key={i} value={code}>{pickStr(s, 'name', 'sub_benefit_name', 'subBenefitName') ?? code} ({code})</option>; })}
              </Select>
            </Card>
          </div>
          <Card title="Interventions (from SHA)" actions={<div className="flex gap-2"><Select value={accessPoint} onChange={(e) => setAccessPoint(e.target.value)} className="w-28" aria-label="Access point"><option value="">OP + IP</option><option value="OP">OP</option><option value="IP">IP</option></Select><div className="relative"><Search className="muted absolute left-2 top-2.5 h-4 w-4" /><Input className="w-56 pl-8" placeholder="Search interventions" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>}>
            {interventions.isLoading && <Loading />}
            <ErrorText error={interventions.error} />
            {!interventions.isLoading && intList.length === 0 ? <EmptyState title="No interventions returned">Adjust the filters.</EmptyState> : (
              <Table head={['', 'Intervention', 'Workflow flags (from SHA)', '']}>
                {intList.map((i) => (
                  <tr key={i.code}>
                    <Td><input type="checkbox" aria-label={`Select ${i.code}`} checked={!!selected[i.code]} onChange={(e) => { const n = { ...selected }; if (e.target.checked) n[i.code] = i; else delete n[i.code]; setSelected(n); }} /></Td>
                    <Td><span className="font-medium">{i.name ?? i.code}</span><span className="muted block font-mono text-xs">{i.code}</span></Td>
                    <Td><InterventionBadges i={i} /></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setUtilCode(utilCode === i.code ? null : i.code)}>Utilization</Button></Td>
                  </tr>
                ))}
              </Table>
            )}
            {utilCode && patientId && <div className="mt-4"><UtilizationPanel patientId={patientId} initialCode={utilCode} /></div>}
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} /> Emergency</label>
            <Button onClick={() => decide.mutate()} loading={decide.isPending} disabled={!Object.keys(selected).length}>Determine workflow ({Object.keys(selected).length})</Button>
            <ErrorText error={decide.error} />
          </div>
        </div>
      )}

      {step >= 2 && decide.data && (
        <div className="space-y-5">
          <Card title="Applicable SHA workflow">
            <div className="space-y-3 text-sm">
              <p>Service type: <Badge tone="blue">{decide.data.decision.serviceType}</Badge> · Payment: {decide.data.decision.paymentMechanisms.join(', ') || '—'} · Access point: {decide.data.decision.accessPoints.join(', ') || '—'} · Fund: {decide.data.decision.funds.join(', ') || '—'}</p>
              <ol className="flex flex-wrap gap-2">{decide.data.decision.steps.map((s, i) => <li key={s} className="flex items-center gap-1"><Badge tone={/preauth/.test(s) ? 'amber' : 'gray'}>{i + 1}. {humanize(s)}</Badge></li>)}</ol>
              {decide.data.decision.needsPreauth && <Alert tone="amber" title={decide.data.decision.manualApproval ? 'Preauthorization with manual (elective) approval' : 'Preauthorization required'}>For {decide.data.decision.preauthInterventions.join(', ')}{decide.data.decision.specialPreauth.length ? ` (${decide.data.decision.specialPreauth.join(', ')})` : ''}. Claims cannot be submitted until SHA approves.</Alert>}
              {decide.data.decision.requiredDocuments.length > 0 && <p>Required documents (from SHA): {decide.data.decision.requiredDocuments.map((d) => <Badge key={d} className="mr-1">{d}</Badge>)}</p>}
              {decide.data.decision.warnings.map((w) => <p key={w} className="flex items-center gap-1 text-amber-700"><AlertTriangle className="h-4 w-4" />{w}</p>)}
              {!decide.data.decision.needsPreauth && <p className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />No preauthorization required by SHA for the selected interventions.</p>}
            </div>
          </Card>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>Create SHA visit & continue to consent</Button>
          </div>
          <ErrorText error={create.error} />
        </div>
      )}
    </>
  );
}

export default function NewShaVisitPage() {
  return <Suspense><Wizard /></Suspense>;
}
