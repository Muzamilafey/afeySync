'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, Select } from '@/components/ui';
import { COUNTIES } from '@/features/onboarding/constants';
import type { Patient } from '@/types/api';

type P = Patient & { altPhone?: string; maritalStatus?: string; occupation?: string; nationality?: string; dobEstimated?: boolean };
type Kin = { name: string; relationship: string; phone: string; idNumber: string };
type Allergy = { substance: string; reaction: string; severity: string };
type OtherId = { type: string; value: string };

/** Identifier types kept in their own fields, not in the "other identifiers" list. */
const OWN_FIELD_IDS = ['National ID', 'SHA Number', 'ClientRegistry ID'];
const OTHER_ID_TYPES = ['Birth Certificate', 'Birth Notification', 'Passport', 'Alien ID', 'Refugee ID', 'Mandate Number', 'Insurance Number', 'Other'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Separated', 'Widowed'];
const RELATIONSHIPS = ['Spouse', 'Parent', 'Child', 'Sibling', 'Guardian', 'Relative', 'Friend', 'Other'];

const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <fieldset className="border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0">
    <legend className="text-sm font-semibold">{title}</legend>
    {hint && <p className="muted mt-0.5 text-xs">{hint}</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  </fieldset>
);

function initial(p: P) {
  return {
    firstName: p.firstName ?? '',
    middleName: p.middleName ?? '',
    lastName: p.lastName ?? '',
    gender: p.gender ?? 'unknown',
    dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
    dobEstimated: !!p.dobEstimated,
    maritalStatus: p.maritalStatus ?? '',
    occupation: p.occupation ?? '',
    nationality: p.nationality ?? '',
    nationalId: p.nationalId ?? '',
    shaNumber: p.shaNumber ?? '',
    phone: p.phone ?? '',
    altPhone: p.altPhone ?? '',
    email: p.email ?? '',
    county: p.address?.county ?? '',
    subCounty: p.address?.subCounty ?? '',
    ward: p.address?.ward ?? '',
    village: p.address?.village ?? '',
    physicalAddress: p.address?.physicalAddress ?? '',
    sms: p.consent?.sms !== false,
    dataSharing: !!p.consent?.dataSharing,
    kin: (p.nextOfKin ?? []).map((k) => ({ name: k.name ?? '', relationship: k.relationship ?? '', phone: k.phone ?? '', idNumber: k.idNumber ?? '' })) as Kin[],
    allergies: (p.allergies ?? []).map((a) => ({ substance: a.substance ?? '', reaction: a.reaction ?? '', severity: a.severity ?? '' })) as Allergy[],
    otherIds: (p.identifiers ?? []).filter((i) => !OWN_FIELD_IDS.includes(i.type)).map((i) => ({ type: i.type, value: i.value })) as OtherId[],
  };
}

/** Full demographic editor. Every change is checked on the server and written to the audit trail. */
export function EditPatientForm({ p }: { p: P }) {
  const qc = useQueryClient();
  const start = useMemo(() => initial(p), [p]);
  const [f, setF] = useState(start);
  // After a save the record reloads (the server may tidy values, e.g. phone numbers): show what was stored.
  useEffect(() => setF(start), [start]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const imported = p.dha?.source === 'client_registry';
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const today = new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: async () => {
      const keepIds = (p.identifiers ?? []).filter((i) => i.type === 'ClientRegistry ID').map((i) => ({ type: i.type, value: i.value }));
      const identifiers = [
        ...keepIds,
        ...(f.nationalId.trim() ? [{ type: 'National ID', value: f.nationalId.trim() }] : []),
        ...(f.shaNumber.trim() ? [{ type: 'SHA Number', value: f.shaNumber.trim() }] : []),
        ...f.otherIds.filter((i) => i.value.trim()).map((i) => ({ type: i.type, value: i.value.trim() })),
      ];
      const body: Record<string, unknown> = {
        gender: f.gender,
        dobEstimated: f.dobEstimated,
        maritalStatus: f.maritalStatus,
        occupation: f.occupation.trim(),
        nationality: f.nationality.trim(),
        nationalId: f.nationalId.trim(),
        shaNumber: f.shaNumber.trim(),
        phone: f.phone.trim(),
        altPhone: f.altPhone.trim(),
        email: f.email.trim(),
        address: { county: f.county, subCounty: f.subCounty.trim(), ward: f.ward.trim(), village: f.village.trim(), physicalAddress: f.physicalAddress.trim() },
        consent: { sms: f.sms, dataSharing: f.dataSharing },
        nextOfKin: f.kin.filter((k) => k.name.trim()).map((k) => ({ name: k.name.trim(), relationship: k.relationship, phone: k.phone.trim() || undefined, idNumber: k.idNumber.trim() || undefined })),
        allergies: f.allergies.filter((a) => a.substance.trim()).map((a) => ({ substance: a.substance.trim(), reaction: a.reaction.trim() || undefined, severity: a.severity || undefined })),
        identifiers,
      };
      // Registry-owned fields are only sent for locally registered patients.
      if (!imported) Object.assign(body, { firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim(), dateOfBirth: f.dateOfBirth || undefined });
      return (await api(`/patients/${p._id}`, { method: 'PATCH', body })).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', p._id] }); qc.invalidateQueries({ queryKey: ['patient-timeline', p._id] }); },
  });
  const dupes = save.error instanceof ApiError && save.error.code === 'PATIENT_EXISTS' ? (save.error.details as Array<{ patientNumber: string; name?: string }> | undefined) : undefined;
  const valid = (imported || (f.firstName.trim() && f.lastName.trim())) && (!f.nationalId || /^\d{5,10}$/.test(f.nationalId.trim())) && (!f.email || /^\S+@\S+\.\S+$/.test(f.email.trim()));

  return (
    <Card title="Edit patient details">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Section title="Personal details" hint={imported ? 'Names and date of birth come from the DHA Client Registry and can only be corrected there.' : undefined}>
          <Field label="First name *"><Input value={f.firstName} disabled={imported} onChange={(e) => set('firstName', e.target.value)} /></Field>
          <Field label="Middle name"><Input value={f.middleName} disabled={imported} onChange={(e) => set('middleName', e.target.value)} /></Field>
          <Field label="Last name *"><Input value={f.lastName} disabled={imported} onChange={(e) => set('lastName', e.target.value)} /></Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="unknown">Unknown</option>
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input type="date" max={today} value={f.dateOfBirth} disabled={imported} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.dobEstimated} onChange={(e) => set('dobEstimated', e.target.checked)} /> Date of birth is estimated</label>
          <Field label="Marital status">
            <Select value={f.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value)}>
              <option value="">Not recorded</option>
              {MARITAL.map((m) => <option key={m}>{m}</option>)}
              {f.maritalStatus && !MARITAL.includes(f.maritalStatus) && <option>{f.maritalStatus}</option>}
            </Select>
          </Field>
          <Field label="Occupation"><Input value={f.occupation} onChange={(e) => set('occupation', e.target.value)} /></Field>
          <Field label="Nationality"><Input value={f.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="e.g. Kenyan" /></Field>
        </Section>

        <Section title="Identification" hint="Checked against other patients so the same person is not registered twice.">
          <Field label="National ID"><Input inputMode="numeric" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value.replace(/\s/g, ''))} /></Field>
          <Field label="SHA number"><Input value={f.shaNumber} onChange={(e) => set('shaNumber', e.target.value.trim())} /></Field>
          <Field label="Client Registry ID"><Input value={p.clientRegistryId ?? ''} disabled placeholder="Set when imported from DHA" /></Field>
          <div className="col-span-full space-y-2">
            {f.otherIds.map((id, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
                <Select value={id.type} onChange={(e) => set('otherIds', f.otherIds.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  {OTHER_ID_TYPES.map((t) => <option key={t}>{t}</option>)}
                  {!OTHER_ID_TYPES.includes(id.type) && <option>{id.type}</option>}
                </Select>
                <Input value={id.value} placeholder="Number" onChange={(e) => set('otherIds', f.otherIds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" variant="ghost" aria-label="Remove identifier" onClick={() => set('otherIds', f.otherIds.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {f.otherIds.length < 6 && <Button type="button" size="sm" variant="outline" onClick={() => set('otherIds', [...f.otherIds, { type: 'Birth Certificate', value: '' }])}><Plus className="h-3.5 w-3.5" /> Add another ID (passport, birth certificate…)</Button>}
          </div>
        </Section>

        <Section title="Contact">
          <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="07xx xxx xxx" /></Field>
          <Field label="Alternative phone"><Input inputMode="tel" value={f.altPhone} onChange={(e) => set('altPhone', e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        </Section>

        <Section title="Address">
          <Field label="County">
            <Select value={f.county} onChange={(e) => set('county', e.target.value)}>
              <option value="">Not recorded</option>
              {COUNTIES.map((c) => <option key={c}>{c}</option>)}
              {f.county && !(COUNTIES as readonly string[]).includes(f.county) && <option>{f.county}</option>}
            </Select>
          </Field>
          <Field label="Sub-county"><Input value={f.subCounty} onChange={(e) => set('subCounty', e.target.value)} /></Field>
          <Field label="Ward"><Input value={f.ward} onChange={(e) => set('ward', e.target.value)} /></Field>
          <Field label="Village / estate"><Input value={f.village} onChange={(e) => set('village', e.target.value)} /></Field>
          <Field label="Physical address" className="sm:col-span-2"><Input value={f.physicalAddress} onChange={(e) => set('physicalAddress', e.target.value)} placeholder="Street, building, landmark" /></Field>
        </Section>

        <Section title="Next of kin">
          <div className="col-span-full space-y-2">
            {f.kin.map((k, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input value={k.name} placeholder="Full name" onChange={(e) => set('kin', f.kin.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Select value={k.relationship} onChange={(e) => set('kin', f.kin.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)))}>
                  <option value="">Relationship</option>
                  {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                  {k.relationship && !RELATIONSHIPS.includes(k.relationship) && <option>{k.relationship}</option>}
                </Select>
                <Input value={k.phone} inputMode="tel" placeholder="Phone" onChange={(e) => set('kin', f.kin.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                <Input value={k.idNumber} placeholder="ID number" onChange={(e) => set('kin', f.kin.map((x, j) => (j === i ? { ...x, idNumber: e.target.value } : x)))} />
                <Button type="button" variant="ghost" aria-label="Remove next of kin" onClick={() => set('kin', f.kin.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {f.kin.length < 5 && <Button type="button" size="sm" variant="outline" onClick={() => set('kin', [...f.kin, { name: '', relationship: '', phone: '', idNumber: '' }])}><Plus className="h-3.5 w-3.5" /> Add next of kin</Button>}
          </div>
        </Section>

        <Section title="Allergies" hint="Shown to clinicians and checked when prescribing and dispensing. Leave empty for no known allergies.">
          <div className="col-span-full space-y-2">
            {f.allergies.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_160px_auto]">
                <Input value={a.substance} placeholder="Substance, e.g. Penicillin" onChange={(e) => set('allergies', f.allergies.map((x, j) => (j === i ? { ...x, substance: e.target.value } : x)))} />
                <Input value={a.reaction} placeholder="Reaction, e.g. rash" onChange={(e) => set('allergies', f.allergies.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)))} />
                <Select value={a.severity} onChange={(e) => set('allergies', f.allergies.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))}>
                  <option value="">Severity</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
                </Select>
                <Button type="button" variant="ghost" aria-label="Remove allergy" onClick={() => set('allergies', f.allergies.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => set('allergies', [...f.allergies, { substance: '', reaction: '', severity: '' }])}><Plus className="h-3.5 w-3.5" /> Add allergy</Button>
          </div>
        </Section>

        <Section title="Consent">
          <label className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sms} onChange={(e) => set('sms', e.target.checked)} /> Patient agrees to receive SMS (appointment reminders, receipts, results notices, health messages)</label>
          <label className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" checked={f.dataSharing} onChange={(e) => set('dataSharing', e.target.checked)} /> Patient agrees to share records with SHA, DHA and referral facilities as required for care</label>
        </Section>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          {dupes?.length ? <Alert tone="red" title="Another patient already has one of these IDs">{dupes.map((d) => `${d.patientNumber}${d.name ? ` (${d.name})` : ''}`).join(', ')}. Check the ID numbers before saving.</Alert> : <ErrorText error={save.error} />}
          {save.isSuccess && !dirty && <Alert tone="green">Saved. The change is recorded in the patient&rsquo;s history.</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending} disabled={!dirty || !valid}>Save changes</Button>
            <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setF(start); save.reset(); }}>Discard changes</Button>
            {!dirty && !save.isSuccess && <span className="muted self-center text-xs">No changes yet.</span>}
          </div>
        </div>
      </form>
    </Card>
  );
}
