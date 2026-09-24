'use client';

import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useMe } from '@/hooks/useMe';
import { Alert, Button, ErrorText, Field, Input, Select } from '@/components/ui';
import type { Patient } from '@/types/api';
import Link from 'next/link';

const ID_TYPES = ['National ID', 'ClientRegistry ID', 'Birth Notification', 'Birth Certificate', 'Alien ID', 'Refugee ID', 'Mandate Number', 'Passport', 'SHA Number', 'Insurance Number', 'Other'] as const;

const schema = z.object({
  firstName: z.string().trim().min(1, 'Required'),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, 'Required'),
  gender: z.enum(['male', 'female', 'other', 'unknown']),
  dateOfBirth: z.string().optional(),
  phone: z.string().regex(/^(\+?254|0)?[17]\d{8}$/, 'Enter a valid Kenyan phone number').optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  nationalId: z.string().regex(/^\d{5,10}$/, 'Digits only').optional().or(z.literal('')),
  shaNumber: z.string().optional(),
  identifiers: z.array(z.object({ type: z.enum(ID_TYPES), value: z.string().min(2) })),
  county: z.string().optional(),
  subCounty: z.string().optional(),
  ward: z.string().optional(),
  village: z.string().optional(),
  kinName: z.string().optional(),
  kinRelationship: z.string().optional(),
  kinPhone: z.string().optional(),
  insuranceProvider: z.string().optional(),
  insuranceMember: z.string().optional(),
  consentSharing: z.boolean(),
  consentSms: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function NewPatientForm({ defaults, onCancel }: { defaults?: { idType?: string; idNumber?: string }; onCancel?: () => void }) {
  const router = useRouter();
  const { data: me } = useMe();
  const preset = defaults?.idNumber?.trim();
  const { register, handleSubmit, control, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      gender: 'female',
      consentSharing: true,
      consentSms: true,
      nationalId: defaults?.idType === 'National ID' ? preset : '',
      identifiers: preset && defaults?.idType && defaults.idType !== 'National ID' ? [{ type: defaults.idType as (typeof ID_TYPES)[number], value: preset }] : [],
    },
  });
  const ids = useFieldArray({ control, name: 'identifiers' });
  const create = useMutation({
    mutationFn: async (v: Values) =>
      (
        await api<Patient>('/patients', {
          method: 'POST',
          body: {
            firstName: v.firstName,
            middleName: v.middleName || undefined,
            lastName: v.lastName,
            gender: v.gender,
            dateOfBirth: v.dateOfBirth || undefined,
            phone: v.phone || undefined,
            email: v.email || undefined,
            nationalId: v.nationalId || undefined,
            shaNumber: v.shaNumber || undefined,
            identifiers: v.identifiers,
            address: { county: v.county, subCounty: v.subCounty, ward: v.ward, village: v.village },
            nextOfKin: v.kinName ? [{ name: v.kinName, relationship: v.kinRelationship ?? '', phone: v.kinPhone }] : undefined,
            insurance: v.insuranceProvider && v.insuranceMember ? [{ provider: v.insuranceProvider, memberNumber: v.insuranceMember }] : undefined,
            consent: { dataSharing: v.consentSharing, sms: v.consentSms },
          },
        })
      ).data,
    onSuccess: (p) => router.push(`/patients/${p._id}?registered=1`),
  });
  const dupes = create.error instanceof ApiError && create.error.code === 'PATIENT_EXISTS' ? (create.error.details as Array<{ id?: string; patientNumber: string; name?: string; accessible: boolean }>) : null;
  const e = formState.errors;

  const section = (title: string) => <h3 className="col-span-full mt-2 border-b border-[var(--border)] pb-1 text-sm font-semibold">{title}</h3>;

  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {section('Personal information')}
      <Field label="First name *" error={e.firstName?.message}><Input {...register('firstName')} /></Field>
      <Field label="Middle name"><Input {...register('middleName')} /></Field>
      <Field label="Last name *" error={e.lastName?.message}><Input {...register('lastName')} /></Field>
      <Field label="Sex *">
        <Select {...register('gender')}>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
          <option value="unknown">Unknown</option>
        </Select>
      </Field>
      <Field label="Date of birth"><Input type="date" max={new Date().toISOString().slice(0, 10)} {...register('dateOfBirth')} /></Field>

      {section('Contact')}
      <Field label="Phone" error={e.phone?.message}><Input placeholder="07XXXXXXXX" {...register('phone')} /></Field>
      <Field label="Email" error={e.email?.message}><Input type="email" {...register('email')} /></Field>

      {section('Identification')}
      <Field label="National ID" error={e.nationalId?.message}><Input inputMode="numeric" {...register('nationalId')} /></Field>
      <Field label="SHA number"><Input {...register('shaNumber')} /></Field>
      <div className="col-span-full space-y-2">
        {ids.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[200px_1fr_auto] gap-2">
            <Select {...register(`identifiers.${i}.type` as const)}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
            <Input placeholder="Identifier value" {...register(`identifiers.${i}.value` as const)} />
            <Button type="button" variant="ghost" onClick={() => ids.remove(i)} aria-label="Remove identifier"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => ids.append({ type: 'Passport', value: '' })}><Plus className="h-3 w-3" /> Add identifier</Button>
      </div>

      {section('Next of kin')}
      <Field label="Name"><Input {...register('kinName')} /></Field>
      <Field label="Relationship"><Input {...register('kinRelationship')} /></Field>
      <Field label="Phone"><Input {...register('kinPhone')} /></Field>

      {section('Address')}
      <Field label="County"><Input {...register('county')} /></Field>
      <Field label="Sub-county"><Input {...register('subCounty')} /></Field>
      <Field label="Ward / Village"><Input {...register('ward')} /></Field>

      {section('Insurance')}
      <Field label="Insurance provider"><Input {...register('insuranceProvider')} /></Field>
      <Field label="Member number"><Input {...register('insuranceMember')} /></Field>

      {section('Consent & branch')}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('consentSharing')} /> Consents to HIE data sharing</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('consentSms')} /> Consents to SMS notifications</label>
      <p className="muted text-sm">Branch: <strong>{me?.activeBranch?.name ?? '—'}</strong></p>

      <div className="col-span-full space-y-3">
        {dupes && (
          <Alert tone="amber" title="PATIENT ALREADY EXISTS">
            {dupes.map((d) => (
              <p key={d.patientNumber}>
                {d.patientNumber} {d.name} {d.accessible && d.id ? <Link className="font-semibold underline" href={`/patients/${d.id}`}>Open patient</Link> : '(another branch)'}
              </p>
            ))}
          </Alert>
        )}
        {create.error && !dupes && <ErrorText error={create.error} />}
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>Register patient</Button>
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    </form>
  );
}
