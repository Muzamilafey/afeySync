'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Fingerprint, RefreshCw, XCircle } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import { HEALTHID_STATUS_URL, type Workstation } from './healthId';

/**
 * Shows whether HealthID is running on this computer with a scanner attached, and collects the values a capture
 * needs (workstation, device, agent ID). Settings are remembered on this computer only.
 */
export function HealthIdCard({ ws }: { ws: Workstation }) {
  const { status, settings: s, update, resolved: w, ready, needDevice } = ws;
  const [manual, setManual] = useState(false);
  const running = status.data?.reachable;
  const devices = status.data?.devices ?? [];
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Fingerprint className="h-6 w-6 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Fingerprint workstation</p>
          <p className="muted text-sm">
            {status.isFetching && !status.data ? 'Looking for HealthID on this computer…' : running ? (devices.length ? `HealthID is running · ${devices.length} scanner${devices.length > 1 ? 's' : ''} found` : 'HealthID is running, but no scanner was found. Plug the scanner in.') : 'HealthID is not reachable on this computer.'}
          </p>
        </div>
        {running && devices.length ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-amber-600" />}
        <Button size="sm" variant="outline" onClick={() => status.refetch()} loading={status.isFetching}><RefreshCw className="h-3.5 w-3.5" /> Check again</Button>
      </div>
      {!running && !status.isFetching && (
        <div className="rounded-md bg-[var(--surface-2)] p-3 text-sm">
          <p className="font-medium">To use fingerprints on this computer:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Install HealthID (Windows or Android) and sign in with the account the HIE team created for you.</li>
            <li>Plug the fingerprint scanner in by USB. HealthID should detect it.</li>
            <li>In HealthID click <strong>Test</strong> and capture a test fingerprint.</li>
            <li>Keep HealthID running (it runs in the background on Windows), then click <strong>Check again</strong>.</li>
          </ol>
          <p className="muted mt-2 text-xs">AfeySync reads {HEALTHID_STATUS_URL} from this browser. If HealthID runs but is still not found, your browser may be blocking local access: enter the workstation ID from HealthID below.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Agent ID number" hint="ID number of the person signed in to HealthID"><Input value={s.agentId} onChange={(e) => update({ agentId: e.target.value.trim() })} placeholder="e.g. 12345678" /></Field>
        {needDevice && (
          <Field label="Scanner">
            {devices.length > 1 ? (
              <Select value={s.deviceId || devices[0].id} onChange={(e) => update({ deviceId: e.target.value })}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name ? `${d.name} · ${d.id}` : d.id}</option>)}</Select>
            ) : <Input value={w.deviceId} readOnly={!manual && !!devices.length} onChange={(e) => update({ deviceId: e.target.value })} placeholder={devices.length ? '' : 'Scanner serial number'} />}
          </Field>
        )}
        <Field label="Workstation ID"><Input value={w.workstationId} readOnly={!manual && !!status.data?.workstationId} onChange={(e) => update({ workstationId: e.target.value.trim() })} placeholder="From HealthID" className="font-mono text-xs" /></Field>
      </div>
      <button type="button" onClick={() => setManual(!manual)} className="muted flex items-center gap-1 text-xs hover:text-brand-700">
        <ChevronDown className={cn('h-3.5 w-3.5 transition', manual && 'rotate-180')} /> {manual ? 'Hide' : 'Show'} advanced settings
      </button>
      {manual && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Device OS"><Select value={s.deviceOs} onChange={(e) => update({ deviceOs: e.target.value as 'windows' | 'android' })}><option value="windows">Windows</option><option value="android">Android</option></Select></Field>
          <Field label="eKYC provider ID (if SHA gave you one)"><Input value={s.ekycProviderId} onChange={(e) => update({ ekycProviderId: e.target.value.trim() })} /></Field>
          <div className="flex items-end"><Button size="sm" variant="ghost" onClick={() => update({ workstationId: '', deviceId: '' })}>Use HealthID values</Button></div>
        </div>
      )}
      {!ready && <p className="text-xs text-amber-700 dark:text-amber-300">{!s.agentId ? 'Enter the agent ID number.' : !w.workstationId ? 'The workstation ID is needed (from HealthID).' : 'Choose the scanner.'}</p>}
    </div>
  );
}
