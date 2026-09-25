'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, Select } from '@/components/ui';
import { Flags, isObj, pickStr, RawJson, Scalars, unwrapList, humanize } from './hieDisplay';

function Interventions({ patientId, subBenefitCode, onUtilization }: { patientId: string; subBenefitCode?: string; onUtilization: (code: string) => void }) {
  const [search, setSearch] = useState('');
  const [accessPoint, setAccessPoint] = useState('');
  const [applied, setApplied] = useState({ search: '', accessPoint: '' });
  const q = useQuery({
    queryKey: ['sha-interventions', patientId, subBenefitCode, applied],
    queryFn: async () => (await api('/sha/interventions', { query: { patientId, sub_benefit_code: subBenefitCode, search: applied.search, access_point: applied.accessPoint, page_size: 50 } })).data,
  });
  const items = unwrapList(q.data);
  return (
    <div className="space-y-3 border-l-2 border-brand-200 pl-4">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setApplied({ search, accessPoint }); }}>
        <Input className="max-w-60" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search interventions" />
        <Select className="max-w-32" value={accessPoint} onChange={(e) => setAccessPoint(e.target.value)}>
          <option value="">Any access point</option>
          <option value="OP">OP</option>
          <option value="IP">IP</option>
        </Select>
        <Button size="sm" type="submit" variant="outline">Filter</Button>
      </form>
      {q.isLoading && <Loading />}
      <ErrorText error={q.error} />
      {items.map((it, i) => {
        const code = pickStr(it, 'code', 'intervention_code', 'interventionCode');
        return (
          <div key={code ?? i} className="rounded-lg border border-[var(--border)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{code && <span className="font-mono">{code} — </span>}{pickStr(it, 'name', 'description', 'intervention_name') ?? 'Intervention'}</p>
              {code && <Button size="sm" variant="ghost" onClick={() => onUtilization(code)}>Utilization →</Button>}
            </div>
            <Flags o={it} />
            <div className="mt-2"><Scalars o={it} exclude={['code', 'name']} /></div>
            {Object.entries(it).filter(([, v]) => isObj(v) || Array.isArray(v)).map(([k, v]) => <RawJson key={k} data={v} label={humanize(k)} />)}
          </div>
        );
      })}
      {q.data !== undefined && items.length === 0 && <p className="muted text-sm">No interventions returned.</p>}
      {q.data !== undefined && <RawJson data={q.data} />}
    </div>
  );
}

export function UtilizationPanel({ patientId, initialCode }: { patientId: string; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [applied, setApplied] = useState(initialCode ?? '');
  const q = useQuery({ queryKey: ['sha-utilization', patientId, applied], queryFn: async () => (await api('/sha/utilization', { query: { patientId, interventionCode: applied } })).data, enabled: applied.length >= 2 });
  const d = (isObj(q.data) && isObj((q.data as Record<string, unknown>).data) ? (q.data as Record<string, Record<string, unknown>>).data : q.data) as Record<string, unknown> | undefined;
  // Documented names (individualMaxLimit/individualUtilisedLimit…) with snake_case fallbacks.
  const pairs: Array<[string, string[], string[]]> = [
    ['Individual', ['individualMaxLimit', 'individual_max_limit', 'individual_limit'], ['individualUtilisedLimit', 'individual_utilised_limit', 'individual_used']],
    ['Household', ['householdMaxLimit', 'household_max_limit', 'household_limit'], ['householdUtilisedLimit', 'household_utilised_limit', 'household_used']],
  ];
  const first = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return Number(o[k]); return NaN; };
  return (
    <Card title="Utilization">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(code.trim()); }}>
        <Field label="Intervention code" className="flex-1"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SHA-19-404" /></Field>
        <div className="flex items-end"><Button type="submit" variant="outline">Load</Button></div>
      </form>
      {q.isFetching && <Loading />}
      <ErrorText error={q.error} />
      {isObj(d) && (
        <div className="space-y-4">
          {pairs.map(([label, lk, uk]) => {
            const limit = first(d, lk);
            const used = first(d, uk);
            if (Number.isNaN(limit) || Number.isNaN(used) || limit <= 0) return null;
            const pct = Math.min(100, Math.round((used / limit) * 100));
            return (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{label}</span><span className="muted">Limit KES {limit.toLocaleString()} · Used KES {used.toLocaleString()} · Available KES {(limit - used).toLocaleString()}</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className={`h-full ${pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          {(d.nextAvailability ?? d.next_availability) != null && <p className="text-sm">Next availability: <strong>{String(d.nextAvailability ?? d.next_availability)}</strong></p>}
          <Scalars o={d} />
        </div>
      )}
      {q.data !== undefined && <RawJson data={q.data} />}
    </Card>
  );
}

export function BenefitsPanel({ patientId, hasCrId, initialView }: { patientId: string; hasCrId: boolean; initialView?: string }) {
  const [openBenefit, setOpenBenefit] = useState<string | null>(null);
  const [utilCode, setUtilCode] = useState<string | undefined>(initialView === 'utilization' ? '' : undefined);
  const q = useQuery({ queryKey: ['sha-benefits', patientId], queryFn: async () => (await api('/sha/benefits', { query: { patientId } })).data, enabled: hasCrId });
  if (!hasCrId) return <Alert tone="amber" title="Client Registry ID required">Benefits, interventions and utilization are queried by the patient’s DHA Client Registry ID. Import/match this patient from the DHA Client Registry first.</Alert>;
  const benefits = unwrapList(q.data);
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Card title="Benefits">
        {q.isLoading && <Loading />}
        <ErrorText error={q.error} />
        <div className="space-y-2">
          {benefits.map((b, i) => {
            const code = pickStr(b, 'code', 'benefit_code', 'sub_benefit_code') ?? String(i);
            return (
              <div key={code} className="rounded-lg border border-[var(--border)]">
                <button className="flex w-full items-center justify-between p-3 text-left" onClick={() => setOpenBenefit(openBenefit === code ? null : code)}>
                  <span className="text-sm font-semibold">{pickStr(b, 'name', 'benefit_name', 'description') ?? code} <span className="muted font-mono text-xs">{code}</span></span>
                  <span className="muted text-xs">{openBenefit === code ? 'Hide' : 'Interventions'}</span>
                </button>
                <div className="px-3 pb-3"><Flags o={b} /><Scalars o={b} exclude={['name', 'code']} /></div>
                {openBenefit === code && <div className="p-3 pt-0"><Interventions patientId={patientId} subBenefitCode={code} onUtilization={setUtilCode} /></div>}
              </div>
            );
          })}
          {q.data !== undefined && benefits.length === 0 && <p className="muted text-sm">No benefits returned.</p>}
        </div>
        {q.data !== undefined && <RawJson data={q.data} />}
      </Card>
      <UtilizationPanel key={utilCode} patientId={patientId} initialCode={utilCode} />
    </div>
  );
}
