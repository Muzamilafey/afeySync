'use client';

import { use, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { PrintButton } from '@/components/PrintButton';
import { Letterhead } from '@/features/branding/Letterhead';
import type { BirthNotification } from '@/features/maternity/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A value written on a dotted line, with the small caption printed under it (as on the paper form). */
function Line({ value, caption, className = '' }: { value?: string | number | null; caption?: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 flex-1 flex-col ${className}`}>
      <span className="min-h-[1.35em] border-b border-dotted border-black px-1 font-semibold uppercase tracking-wide">{value ?? ''}</span>
      {caption && <span className="text-[9px] leading-tight">{caption}</span>}
    </span>
  );
}

function Box({ label, checked }: { label: string; checked: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {label}
      <span className="inline-grid h-[14px] w-[14px] place-items-center border border-black text-[12px] font-bold leading-none">{checked ? '✓' : ''}</span>
    </span>
  );
}

function Copy({ bn, kind, duplicate }: { bn: BirthNotification; kind: 'parent' | 'facility'; duplicate: boolean }) {
  const d = new Date(bn.dateOfBirth);
  const issuedToName = bn.issuedTo.relationship === 'mother' ? 'Mother' : bn.issuedTo.relationship === 'father' ? `Father${bn.issuedTo.name ? ` · ${bn.issuedTo.name}` : ''}` : bn.issuedTo.name ?? bn.issuedTo.relationship;
  const issuedToId = bn.issuedTo.idNumber ?? (bn.issuedTo.relationship === 'mother' ? bn.mother.idNumber : undefined);
  return (
    <section className="birth-copy relative flex flex-col border-2 border-black p-3 text-[12px] leading-snug">
      <Letterhead className="!mb-2 !pb-2" meta={<p className="rounded border-2 border-black px-2 py-0.5 text-xs font-bold tracking-wider">{kind === 'parent' ? "PARENT'S COPY" : 'FACILITY COPY'}</p>} />
      <div className="text-center">
        <p className="text-[14px] font-bold tracking-wide">ACKNOWLEDGEMENT OF BIRTH NOTIFICATION {kind === 'parent' ? '(FOR PARENTS)' : '(FACILITY RECORD)'}</p>
        <p className="text-[10px]">Birth notified by the health institution under the Births and Deaths Registration Act (Cap. 149)</p>
      </div>
      <div className="mt-2 flex justify-between gap-3 text-[11px]">
        <span>Notification No. <strong className="font-mono text-[13px]">{bn.notificationNumber}</strong></span>
        <span>Form B1 Serial No. <strong className="font-mono">{bn.crsSerialNumber ?? '________________'}</strong></span>
      </div>
      {duplicate && <p className="absolute right-3 top-[45%] -rotate-12 border-2 border-black px-2 text-sm font-bold tracking-widest opacity-60">DUPLICATE</p>}

      <div className="mt-2 space-y-2.5">
        <div className="flex items-end gap-3">
          <span className="w-4 shrink-0">1.</span>
          <span className="shrink-0">NAME</span>
          <Line value={bn.child.firstName} caption="First name" />
          <Line value={bn.child.otherName} caption="Other name" />
          <Line value={bn.child.fatherName} caption="Father's name" />
          <span className="shrink-0 pl-2">2. DATE OF BIRTH</span>
          <Line value={d.getDate()} caption="Day" className="max-w-10" />
          <Line value={MONTHS[d.getMonth()]} caption="Month" className="max-w-24" />
          <Line value={d.getFullYear()} caption="Year" className="max-w-14" />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="flex items-center gap-2"><span className="w-4">3.</span> SEX: <Box label="Male" checked={bn.sex === 'male'} /> <Box label="Female" checked={bn.sex === 'female'} /></span>
          <span className="flex items-center gap-2">4. TYPE OF BIRTH: <Box label="Single" checked={bn.typeOfBirth === 'single'} /> <Box label="Twin" checked={bn.typeOfBirth === 'twin'} /> <span>Other, specify <u className="font-semibold">{bn.typeOfBirth === 'triplet' ? 'Triplet' : bn.typeOfBirth === 'other' ? bn.typeOfBirthOther : ' '.repeat(10)}</u></span></span>
          <span className="flex items-center gap-2">5. NATURE OF BIRTH: <Box label="Born alive" checked={bn.natureOfBirth === 'born_alive'} /> <Box label="Born dead" checked={bn.natureOfBirth === 'born_dead'} /></span>
        </div>
        <div className="flex items-end gap-3">
          <span className="w-4 shrink-0">6.</span>
          <span className="shrink-0">WEIGHT AT BIRTH</span>
          <Line value={bn.birthWeightGrams ? `${(bn.birthWeightGrams / 1000).toFixed(2)} kg` : ''} className="max-w-32" />
          <span className="shrink-0 pl-2">7. PLACE OF BIRTH</span>
          <Line value={bn.placeOfBirth} caption="Sub location or Estate and Town or health institution" />
        </div>
        <div className="flex items-end gap-3">
          <span className="w-4 shrink-0">8.</span>
          <span className="shrink-0">NAME OF MOTHER</span>
          <Line value={bn.mother.firstName} caption="First name" />
          <Line value={bn.mother.middleName} caption="Middle name" />
          <Line value={bn.mother.lastName} caption="Father's name" />
        </div>
        <div className="flex items-end gap-3">
          <span className="shrink-0">NOTIFICATION ISSUED TO</span>
          <Line value={issuedToName} />
          <span className="shrink-0">ID No.</span>
          <Line value={issuedToId} className="max-w-40" />
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 pt-3 text-[11px]">
        <div className="space-y-3">
          <p>Issued by: <strong>{bn.issuedByName}</strong> &nbsp; Date: <strong>{new Date(bn.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></p>
          <p>Signature: ______________________ &nbsp; {kind === 'facility' ? 'Received by (parent) signature: ____________________' : ''}</p>
        </div>
        <div className="grid h-16 w-28 shrink-0 place-items-center border border-dashed border-black text-[10px]">Facility stamp</div>
      </div>
      <p className="mt-2 border-t border-black pt-1 text-[9.5px] italic">
        {kind === 'parent'
          ? 'This is not a birth certificate. Take this acknowledgement to the Civil Registration office to register the birth and obtain the birth certificate.'
          : 'Facility copy: file with the maternity records. Birth register entry for the Civil Registration return.'}
      </p>
    </section>
  );
}

export default function BirthNotificationPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['birth-notification', id], queryFn: async () => (await api<BirthNotification>(`/maternity/birth-notifications/${id}`)).data });
  const logged = useRef(false);
  // Every print (the button or Ctrl+P) is recorded, so reprints are traceable.
  useEffect(() => {
    const onPrint = () => {
      if (logged.current) return;
      logged.current = true;
      api(`/maternity/birth-notifications/${id}/printed`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: ['birth-notifications'] }))
        .catch(() => {})
        .finally(() => setTimeout(() => (logged.current = false), 3000));
    };
    window.addEventListener('beforeprint', onPrint);
    return () => window.removeEventListener('beforeprint', onPrint);
  }, [id, qc]);
  if (!q.data) return <p>{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const bn = q.data;
  const duplicate = bn.printCount > 0;
  return (
    <div>
      <style>{`@page { size: A4 portrait; margin: 8mm; } @media print { .birth-copy { height: 136mm; break-inside: avoid; } }`}</style>
      <div className="print:hidden">
        <PrintButton />
        <p className="muted mb-4 text-sm">Prints the parent&apos;s copy and the facility copy together on one A4 portrait page. Cut along the dashed line.{duplicate ? ` Already printed ${bn.printCount} time${bn.printCount > 1 ? 's' : ''}: this print is marked DUPLICATE.` : ''}</p>
      </div>
      <Copy bn={bn} kind="parent" duplicate={duplicate} />
      <div className="my-2 flex items-center gap-2 text-[10px]"><span>✂</span><span className="flex-1 border-t border-dashed border-black" /><span>cut here</span><span className="flex-1 border-t border-dashed border-black" /></div>
      <Copy bn={bn} kind="facility" duplicate={duplicate} />
    </div>
  );
}
