'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Button, ErrorText, Field, Input, Select } from '@/components/ui';
import type { BirthNotification } from './types';

const clean = (s: string) => s.trim() || undefined;

/**
 * Registers the baby's names and issues the birth notification, or corrects an issued one
 * (a correction needs a reason and is kept in the record's history).
 */
export function BirthNotificationForm({ deliveryId, babyIndex, babyLabel, existing, onDone }: { deliveryId: string; babyIndex: number; babyLabel: string; existing?: BirthNotification; onDone: (bn: BirthNotification) => void }) {
  const [f, setF] = useState({
    firstName: existing?.child.firstName ?? '',
    otherName: existing?.child.otherName ?? '',
    fatherName: existing?.child.fatherName ?? '',
    motherIdNumber: existing?.mother.idNumber ?? '',
    relationship: existing?.issuedTo.relationship ?? 'mother',
    issuedToName: existing?.issuedTo.name ?? '',
    issuedToId: existing?.issuedTo.idNumber ?? '',
    crsSerialNumber: existing?.crsSerialNumber ?? '',
    reason: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        child: { firstName: f.firstName.trim(), otherName: clean(f.otherName), fatherName: clean(f.fatherName) },
        motherIdNumber: f.motherIdNumber.trim(),
        issuedTo: { relationship: f.relationship, name: clean(f.issuedToName), idNumber: clean(f.issuedToId) },
        crsSerialNumber: f.crsSerialNumber.trim(),
      };
      return existing
        ? (await api<BirthNotification>(`/maternity/birth-notifications/${existing._id}`, { method: 'PATCH', body: { ...body, reason: f.reason } })).data
        : (await api<BirthNotification>(`/maternity/deliveries/${deliveryId}/birth-notifications`, { method: 'POST', body: { ...body, babyIndex } })).data;
    },
    onSuccess: onDone,
  });
  return (
    <div className="space-y-4">
      <p className="text-sm">{babyLabel}. Sex, date, type and nature of birth, and the place of birth are taken from the delivery record.</p>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="label mb-1">1. Name of child</legend>
        <Field label="First name"><Input value={f.firstName} onChange={set('firstName')} autoFocus /></Field>
        <Field label="Other name" hint="Optional"><Input value={f.otherName} onChange={set('otherName')} /></Field>
        <Field label="Father's name" hint="Optional (surname)"><Input value={f.fatherName} onChange={set('fatherName')} /></Field>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mother's ID no." hint="Left blank, the ID on her patient record is used"><Input value={f.motherIdNumber} onChange={set('motherIdNumber')} inputMode="numeric" /></Field>
        <Field label="Notification issued to">
          <Select value={f.relationship} onChange={set('relationship')}><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="other">Other</option></Select>
        </Field>
        <Field label="Their ID no." hint={f.relationship === 'mother' ? 'Blank = mother’s ID' : 'Optional'}><Input value={f.issuedToId} onChange={set('issuedToId')} inputMode="numeric" /></Field>
        {f.relationship !== 'mother' && <Field label="Their name" className="sm:col-span-2"><Input value={f.issuedToName} onChange={set('issuedToName')} /></Field>}
        <Field label="Official Form B1 serial no." hint="Only if you also filled the government Form B1 book"><Input value={f.crsSerialNumber} onChange={set('crsSerialNumber')} placeholder="e.g. BG 933306" /></Field>
      </div>
      {existing && <Field label="Reason for the correction"><Input value={f.reason} onChange={set('reason')} placeholder="e.g. Spelling corrected by the mother" /></Field>}
      {existing && <Alert tone="blue">The previous details are kept in the record&apos;s correction history. The baby&apos;s patient record is renamed too.</Alert>}
      <ErrorText error={save.error} />
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.firstName.trim() || (!!existing && f.reason.trim().length < 5)}>
        {existing ? 'Save correction' : 'Register baby & issue notification'}
      </Button>
    </div>
  );
}
