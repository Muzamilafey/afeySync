'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import { amountsFor, DOSE_UNITS, fmtAmount, unitLabel } from './dosing';

/** Strength-based amounts first (½, 1 and 2 of the item's strength), then the standard list. */
function amountOptions(unit: string, strength?: string | null) {
  const base = amountsFor(unit);
  const m = (strength ?? '').replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)(mg|g|mcg|ml)$/i);
  const extra = m && m[2].toLowerCase() === unit.toLowerCase() ? [0.5, 1, 2].map((k) => Math.round(Number(m[1]) * k * 1000) / 1000) : [];
  return [...new Set([...extra, ...base])].sort((a, b) => a - b);
}

/**
 * Dose as amount + unit, both chosen from lists. "Other…" allows an exact amount (still a number,
 * checked by the server) for doses that are not on the list.
 */
export function DosePicker({ amount, unit, strength, onChange, invalid }: { amount: number | ''; unit: string; strength?: string | null; onChange: (v: { amount: number | ''; unit: string }) => void; invalid?: boolean }) {
  const options = amountOptions(unit, strength);
  const [other, setOther] = useState(amount !== '' && !options.includes(amount));
  return (
    <div className="flex gap-1">
      {other ? (
        <Input type="number" min={0} step="any" aria-label="Dose amount" className={`min-w-0 flex-1 ${invalid ? 'border-red-500' : ''}`} value={amount} autoFocus onChange={(e) => onChange({ amount: e.target.value === '' ? '' : Number(e.target.value), unit })} onBlur={() => amount === '' && setOther(false)} />
      ) : (
        <Select aria-label="Dose amount" className={`min-w-0 flex-1 ${invalid ? 'border-red-500' : ''}`} value={amount === '' ? '' : String(amount)} onChange={(e) => (e.target.value === 'other' ? (setOther(true), onChange({ amount: '', unit })) : onChange({ amount: e.target.value === '' ? '' : Number(e.target.value), unit }))}>
          <option value="">Dose…</option>
          {options.map((a) => <option key={a} value={a}>{fmtAmount(a)}</option>)}
          <option value="other">Other…</option>
        </Select>
      )}
      <Select aria-label="Dose unit" className="w-[6.5rem] shrink-0" value={unit} onChange={(e) => { setOther(false); onChange({ amount: '', unit: e.target.value }); }}>
        {DOSE_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u, typeof amount === 'number' ? amount : 1)}</option>)}
      </Select>
    </div>
  );
}
