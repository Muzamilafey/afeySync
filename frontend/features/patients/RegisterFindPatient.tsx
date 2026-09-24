'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Search, UserPlus, Database, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan, useMe } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Modal, Select } from '@/components/ui';
import { IDENTIFICATION_TYPES, type Patient, type RegistryPatient } from '@/types/api';
import { fmtDate } from '@/lib/utils';
import { NewPatientForm } from './NewPatientForm';

type Dupe = { id?: string; patientNumber: string; name?: string; clientRegistryId?: string; accessible: boolean };

function ExistingPatient({ dupes }: { dupes: Dupe[] }) {
  return (
    <Alert tone="amber" title="PATIENT ALREADY EXISTS">
      {dupes.map((d) => (
        <div key={d.patientNumber} className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-sm">
            <p>
              AfeySync Patient: <strong>{d.patientNumber}</strong> {d.name && `— ${d.name}`}
            </p>
            {d.clientRegistryId && <p>DHA CR ID: <strong>{d.clientRegistryId}</strong></p>}
            {!d.accessible && <p className="text-xs">Registered in another branch. Use “Link to my branch” from the patient search with a matching identifier.</p>}
          </div>
          {d.accessible && d.id && (
            <Link href={`/patients/${d.id}`}>
              <Button size="sm">OPEN PATIENT</Button>
            </Link>
          )}
        </div>
      ))}
    </Alert>
  );
}

export function RegisterFindPatient() {
  const router = useRouter();
  const can = useCan();
  const { data: me } = useMe();
  const dhaEnabled = me?.integrations.dha.enabled;
  const [idType, setIdType] = useState<string>('National ID');
  const [idNumber, setIdNumber] = useState('');
  const [details, setDetails] = useState<RegistryPatient | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(true);

  const search = useMutation({
    mutationFn: async () => (await api<{ found: boolean; results: RegistryPatient[] }>('/dha/registries/patients', { query: { identification_type: idType, identification_number: idNumber.trim() } })).data,
  });

  const importMut = useMutation({
    mutationFn: async (index: number) =>
      (await api<Patient>('/patients/import-dha', { method: 'POST', body: { identificationType: idType, identificationNumber: idNumber.trim(), resultIndex: index, phone: phone || undefined, consent: { dataSharing: consent, sms: true } } })).data,
    onSuccess: (p) => router.push(`/patients/${p._id}?registered=1`),
  });

  const importDupes = importMut.error instanceof ApiError && importMut.error.code === 'PATIENT_EXISTS' ? (importMut.error.details as Dupe[]) : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card title="Register / Find Patient">
          <p className="label mb-3 flex items-center gap-2 !text-sm !normal-case">
            <Database className="h-4 w-4 text-brand-600" /> Find existing national record (DHA Client Registry)
          </p>
          {!dhaEnabled && <div className="mb-3"><Alert tone="amber">{me?.integrations.dha.message ?? 'DHA HIE integration is not enabled for this facility.'} You can still search AfeySync and register locally.</Alert></div>}
          <form
            className="grid gap-3 md:grid-cols-[220px_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              setDetails(null);
              importMut.reset();
              if (idNumber.trim().length >= 3) search.mutate();
            }}
          >
            <Field label="Identification Type">
              <Select value={idType} onChange={(e) => setIdType(e.target.value)}>
                {IDENTIFICATION_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Identification Number">
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="e.g. 12345678" inputMode="text" autoFocus />
            </Field>
            <div className="flex items-end">
              <Button type="submit" loading={search.isPending} disabled={!dhaEnabled || !can('dha.registry') || idNumber.trim().length < 3} className="w-full md:w-auto">
                <Search className="h-4 w-4" /> SEARCH DHA
              </Button>
            </div>
          </form>
          <div className="my-4 flex items-center gap-3 text-xs">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="muted font-semibold">OR</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <Link href={idNumber ? `/patients?q=${encodeURIComponent(idNumber)}` : '/patients'}>
            <Button variant="outline">
              <Search className="h-4 w-4" /> Search AfeySync Patients
            </Button>
          </Link>
        </Card>

        {search.error && <ErrorText error={search.error} />}

        {search.data && (
          <Card title="DHA / HIE Result" actions={<Badge tone={search.data.found ? 'green' : 'gray'}>{search.data.found ? `${search.data.results.length} record(s)` : 'Not found'}</Badge>}>
            {!search.data.found && (
              <div className="space-y-3">
                <p className="text-sm">No national record was found for {idType} {idNumber}.</p>
                {can('patients.create') && (
                  <Button onClick={() => setShowNew(true)}>
                    <UserPlus className="h-4 w-4" /> CREATE NEW PATIENT
                  </Button>
                )}
              </div>
            )}
            {search.data.results.map((r, i) => (
              <div key={i} className="space-y-4 border-b border-[var(--border)] pb-4 last:border-0 last:pb-0">
                <KV
                  items={[
                    ['Name', <span key="n" className="uppercase">{r.fullName ?? [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ')}</span>],
                    ['DOB', fmtDate(r.dateOfBirth)],
                    ['Gender', r.gender],
                    ['Phone', r.phone],
                    ['County', r.county],
                    ['CR ID', r.clientRegistryId],
                  ]}
                />
                {r.existingPatient ? (
                  <ExistingPatient dupes={[r.existingPatient]} />
                ) : (
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Contact phone (confirm / update)">
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={r.phone ?? '07XXXXXXXX'} />
                      </Field>
                      <label className="flex items-center gap-2 pt-5 text-sm">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Patient consents to HIE data sharing
                      </label>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button variant="outline" onClick={() => setDetails(r)}>VIEW DETAILS</Button>
                      {can('patients.create') && (
                        <Button onClick={() => importMut.mutate(i)} loading={importMut.isPending}>
                          USE THIS RECORD
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {importDupes ? <div className="mt-3"><ExistingPatient dupes={importDupes} /></div> : importMut.error && <div className="mt-3"><ErrorText error={importMut.error} /></div>}
          </Card>
        )}

        {showNew && (
          <Card title="New Patient Registration">
            <NewPatientForm defaults={{ idType, idNumber }} onCancel={() => setShowNew(false)} />
          </Card>
        )}
      </div>

      <aside className="space-y-4">
        <Card title="Workflow">
          <ol className="space-y-2 text-sm">
            {['Search DHA Client Registry', 'Import / match patient', 'Check SHA eligibility', 'Benefits & interventions', 'Authorization / visit consent', 'Queue → triage → consultation'].map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Not found nationally?">
          <p className="muted mb-3 text-sm">If no national record exists (or policy permits), register the patient locally. Identifiers are checked across all branches to prevent duplicates.</p>
          {can('patients.create') && (
            <Button variant="outline" onClick={() => setShowNew(true)} className="w-full">
              <UserPlus className="h-4 w-4" /> CREATE NEW PATIENT
            </Button>
          )}
        </Card>
        <Card title="SHA">
          <p className="muted text-sm flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" /> After registration, check SHA eligibility from the patient profile. The ClientRegistry ID is used when available.</p>
        </Card>
      </aside>

      <Modal open={!!details} onClose={() => setDetails(null)} title="Client Registry record" wide>
        {details && (
          <div className="space-y-4">
            <KV items={[['Full name', details.fullName], ['CR ID', details.clientRegistryId], ['National ID', details.nationalId], ['Gender', details.gender], ['DOB', fmtDate(details.dateOfBirth)], ['Phone', details.phone], ['County', details.county]]} />
            {details.identifiers.length > 0 && (
              <div>
                <p className="label">Other identifiers</p>
                <div className="flex flex-wrap gap-2">{details.identifiers.map((i) => <Badge key={i.type + i.value}>{i.type}: {i.value}</Badge>)}</div>
              </div>
            )}
            {details.dependants.length > 0 && (
              <div>
                <p className="label">Dependants</p>
                <ul className="text-sm">{details.dependants.map((d, i) => <li key={i}>{d.name} {d.relationship && `(${d.relationship})`} {d.clientRegistryId}</li>)}</ul>
              </div>
            )}
            <details>
              <summary className="muted cursor-pointer text-xs">Raw registry response</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs">{JSON.stringify(details.raw, null, 2)}</pre>
            </details>
          </div>
        )}
      </Modal>
    </div>
  );
}
