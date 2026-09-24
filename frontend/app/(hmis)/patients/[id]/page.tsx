'use client';

import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Tabs, statusTone } from '@/components/ui';
import { EligibilityResultCard, type EligibilityResult } from '@/features/sha/EligibilityChecker';
import { BenefitsPanel } from '@/features/sha/BenefitsPanel';
import { CheckInForm } from '@/features/frontdesk/CheckInForm';
import { Modal, Table, Td, statusTone as tone } from '@/components/ui';
import Link from 'next/link';
import type { Visit } from '@/features/frontdesk/types';
import { age, fmtDate, fmtDateTime, fullName } from '@/lib/utils';
import type { Patient } from '@/types/api';

type Full = Patient & { lastEligibility?: { status: string; createdAt: string; summary?: { scheme?: string } } };
type TabKey = 'overview' | 'visits' | 'sha' | 'insurance' | 'edit';

function EditPatient({ p }: { p: Full }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ phone: p.phone ?? '', email: p.email ?? '', county: p.address?.county ?? '', subCounty: p.address?.subCounty ?? '', ward: p.address?.ward ?? '' });
  const m = useMutation({
    mutationFn: () => api(`/patients/${p._id}`, { method: 'PATCH', body: { phone: form.phone || undefined, email: form.email || undefined, address: { county: form.county, subCounty: form.subCounty, ward: form.ward } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', p._id] }),
  });
  return (
    <Card title="Update contact & address">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {(['phone', 'email', 'county', 'subCounty', 'ward'] as const).map((k) => (
          <Field key={k} label={k}><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
        ))}
        <div className="col-span-full space-y-2">
          {p.dha?.source === 'client_registry' && <p className="muted text-xs">Names, date of birth and CR ID were imported from the DHA Client Registry and are not edited locally.</p>}
          <ErrorText error={m.error} />
          {m.isSuccess && <Alert tone="green">Saved.</Alert>}
          <Button type="submit" loading={m.isPending}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

function Profile({ id }: { id: string }) {
  const params = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>((params.get('tab') as TabKey) || 'overview');
  const [checkIn, setCheckIn] = useState(false);
  const visits = useQuery({ queryKey: ['patient-visits', id], queryFn: async () => (await api<Visit[]>('/visits', { query: { patientId: id, limit: 50 } })).data, enabled: tab === 'visits' && can('queue.view', 'opd.view', 'consultation.view') });
  const { data: p, isLoading, error } = useQuery({ queryKey: ['patient', id], queryFn: async () => (await api<Full>(`/patients/${id}`)).data });
  const timeline = useQuery({ queryKey: ['patient-timeline', id], queryFn: async () => (await api<Array<{ at: string; title: string; type: string; by?: string }>>(`/patients/${id}/timeline`)).data, enabled: !!p });
  const elig = useMutation({
    mutationFn: async () => (await api<EligibilityResult>('/sha/eligibility', { method: 'POST', body: { patientId: id } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', id] });
      qc.invalidateQueries({ queryKey: ['patient-timeline', id] });
    },
  });

  if (isLoading) return <Loading />;
  if (error || !p) return <ErrorText error={error} />;
  const shaStatus = p.sha?.status ?? 'unknown';

  return (
    <div className="space-y-5">
      {params.get('registered') && <Alert tone="green" title="Patient registered">{p.patientNumber} created{p.dha?.source === 'client_registry' ? ' from the DHA Client Registry' : ''}.</Alert>}
      <section className="surface rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold uppercase">{fullName(p)}</h1>
            <p className="muted mt-1 text-sm capitalize">
              {p.gender} | {age(p.dateOfBirth)} {p.clientRegistryId && <>| <span className="font-mono normal-case">{p.clientRegistryId}</span></>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={statusTone(shaStatus)}>SHA: {shaStatus === 'unknown' ? 'Not checked' : shaStatus.replace('_', ' ').toUpperCase()}</Badge>
              {p.dha?.source === 'client_registry' && <Badge tone="blue">DHA Client Registry</Badge>}
              {p.allergies?.length ? <Badge tone="red">Allergies: {p.allergies.map((a) => a.substance).join(', ')}</Badge> : <Badge>No known allergies</Badge>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold">{p.patientNumber}</p>
            <p className="muted text-xs">Registered {fmtDate(p.createdAt)}</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {can('queue.manage') && <Button size="sm" variant="outline" onClick={() => setCheckIn(true)}>Check in</Button>}
              {can('sha.eligibility') && <Button size="sm" onClick={() => elig.mutate()} loading={elig.isPending}><ShieldCheck className="h-4 w-4" /> Check SHA eligibility</Button>}
            </div>
          </div>
        </div>
      </section>
      <ErrorText error={elig.error} />
      {elig.data && <EligibilityResultCard r={elig.data} patientId={id} />}

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          ...(can('queue.view', 'opd.view', 'consultation.view') ? [{ key: 'visits' as const, label: 'Visits' }] : []),
          ...(can('sha.eligibility') ? [{ key: 'sha' as const, label: 'SHA Benefits' }] : []),
          { key: 'insurance', label: 'Insurance' },
          ...(can('patients.edit') ? [{ key: 'edit' as const, label: 'Edit' }] : []),
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <Card title="Demographics">
              <KV items={[['Date of birth', fmtDate(p.dateOfBirth)], ['Phone', p.phone], ['Email', p.email], ['National ID', p.nationalId], ['SHA number', p.shaNumber], ['County', p.address?.county], ['Sub-county', p.address?.subCounty], ['Branches', p.branches?.map((b) => b.branchName).join(', ')]]} />
            </Card>
            <Card title="Identifiers">
              <div className="flex flex-wrap gap-2">
                {(p.identifiers ?? []).length === 0 && <p className="muted text-sm">No additional identifiers.</p>}
                {p.identifiers?.map((i) => <Badge key={i.type + i.value} tone={i.source === 'dha' ? 'blue' : 'gray'}>{i.type}: {i.value}</Badge>)}
              </div>
            </Card>
            <Card title="Next of kin">
              {(p.nextOfKin ?? []).length === 0 ? <p className="muted text-sm">None recorded.</p> : p.nextOfKin!.map((k) => <p key={k.name} className="text-sm">{k.name} ({k.relationship}) {k.phone}</p>)}
            </Card>
          </div>
          <Card title="Patient timeline">
            {timeline.isLoading && <Loading />}
            <ol className="relative space-y-4 border-l border-[var(--border)] pl-4">
              {timeline.data?.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-500" />
                  <p className="muted text-xs">{fmtDateTime(e.at)}</p>
                  <p className="font-medium capitalize">{e.title}</p>
                  {e.by && <p className="muted text-xs">by {e.by}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
      {tab === 'sha' && <BenefitsPanel patientId={id} hasCrId={!!p.clientRegistryId} initialView={params.get('view') ?? undefined} />}
      {tab === 'insurance' && (
        <Card title="Insurance">
          {(p.insurance ?? []).length === 0 ? <p className="muted text-sm">No private insurance recorded.</p> : p.insurance!.map((i) => <KV key={i.memberNumber} items={[['Provider', i.provider], ['Scheme', i.scheme], ['Member number', i.memberNumber]]} />)}
          <div className="mt-4"><KV items={[['SHA status', shaStatus], ['Last SHA check', fmtDateTime(p.sha?.lastCheckedAt)]]} /></div>
        </Card>
      )}
      {tab === 'edit' && <EditPatient p={p} />}
      {tab === 'visits' && (
        <Card title="Visits">
          <Table head={['Visit', 'Type', 'Payer', 'Status', 'Date']} empty={(visits.data ?? []).length === 0}>
            {visits.data?.map((v) => (
              <tr key={v._id}><Td><Link href={`/visits/${v._id}`} className="font-mono text-xs font-semibold text-brand-600">{v.visitNumber}</Link></Td><Td className="capitalize">{v.type.replace(/_/g, ' ')}</Td><Td className="uppercase">{v.payer?.type}</Td><Td><Badge tone={tone(v.status === 'closed' ? 'completed' : 'pending')}>{v.status}</Badge></Td><Td>{fmtDateTime(v.createdAt)}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
      <Modal open={checkIn} onClose={() => setCheckIn(false)} title="Check in patient" wide>
        <CheckInForm preset={p} onDone={() => setCheckIn(false)} />
      </Modal>
    </div>
  );
}

export default function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Profile id={id} />
    </Suspense>
  );
}
