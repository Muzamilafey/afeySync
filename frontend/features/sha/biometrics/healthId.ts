'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

/**
 * HealthID is the desktop app on the workstation the fingerprint scanner is plugged into. It exposes a local status
 * endpoint that lists the connected devices and this workstation's ID; both are needed to create a biometric
 * authorization or dispatch a minors capture. The browser on that workstation reads it directly (it is not
 * reachable from our servers).
 */
export const HEALTHID_STATUS_URL = 'http://localhost:18065/status';

export interface HealthIdDevice { id: string; name?: string }
export interface HealthIdStatus { reachable: boolean; workstationId?: string; devices: HealthIdDevice[]; raw?: unknown }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  for (const k of keys) if (typeof o[k] === 'number') return String(o[k]);
  return undefined;
};
const WS_KEYS = ['workstationID', 'workstationId', 'workstation_id', 'workStationId', 'work_station_id', 'workStationID'];
const ID_KEYS = ['serial', 'serialNumber', 'serial_number', 'deviceId', 'device_id', 'deviceID', 'id', 'name'];
const NAME_KEYS = ['name', 'model', 'product', 'description', 'type'];

/** Reads the status defensively: the field layout is HealthID's, so we look for the documented values by name. */
export function parseHealthId(raw: unknown): HealthIdStatus {
  const roots = [raw, ...(isObj(raw) ? Object.values(raw).filter(isObj) : [])].filter(isObj);
  const workstationId = roots.map((o) => str(o, ...WS_KEYS)).find(Boolean);
  const lists: unknown[] = [];
  for (const o of roots) for (const k of ['devices', 'connectedDevices', 'connected_devices', 'deviceList', 'device_list', 'scanners', 'readers']) if (Array.isArray(o[k])) lists.push(...(o[k] as unknown[]));
  if (!lists.length) for (const o of roots) for (const k of ['device', 'scanner', 'reader']) if (isObj(o[k])) lists.push(o[k]);
  const devices = lists.map((d) => (isObj(d) ? { id: str(d, ...ID_KEYS) ?? '', name: str(d, ...NAME_KEYS) } : { id: String(d) })).filter((d) => d.id);
  return { reachable: true, workstationId, devices, raw };
}

export function useHealthIdStatus(enabled = true) {
  return useQuery({
    queryKey: ['healthid-status'],
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    queryFn: async (): Promise<HealthIdStatus> => {
      try {
        const r = await fetch(HEALTHID_STATUS_URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!r.ok) return { reachable: false, devices: [] };
        return parseHealthId(await r.json().catch(() => null));
      } catch {
        return { reachable: false, devices: [] };
      }
    },
  });
}

/** Per-workstation settings kept in this browser: the agent's ID number, device OS and any manual overrides. */
export interface WorkstationSettings { agentId: string; deviceOs: 'windows' | 'android'; workstationId: string; deviceId: string; ekycProviderId: string }
const KEY = 'afs.healthid.settings';
const DEFAULTS: WorkstationSettings = { agentId: '', deviceOs: 'windows', workstationId: '', deviceId: '', ekycProviderId: '' };

export function useWorkstationSettings() {
  const [s, setS] = useState<WorkstationSettings>(DEFAULTS);
  useEffect(() => {
    try { setS({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }); } catch { /* storage blocked */ }
  }, []);
  const update = useCallback((patch: Partial<WorkstationSettings>) => {
    setS((cur) => {
      const next = { ...cur, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  }, []);
  return [s, update] as const;
}

/** The values to send: what HealthID reports, unless the user entered an override. */
export function resolveWorkstation(status: HealthIdStatus | undefined, s: WorkstationSettings) {
  const workstationId = s.workstationId || status?.workstationId || '';
  const deviceId = s.deviceId || status?.devices[0]?.id || '';
  return { workstationId, deviceId, agentId: s.agentId, deviceOs: s.deviceOs, ekycProviderId: s.ekycProviderId, ready: !!workstationId && !!s.agentId };
}

/** Everything a capture screen needs about this workstation, shared between the card and the action buttons. */
export function useWorkstation(needDevice = true) {
  const status = useHealthIdStatus();
  const [settings, update] = useWorkstationSettings();
  const resolved = resolveWorkstation(status.data, settings);
  return { status, settings, update, resolved, ready: resolved.ready && (!needDevice || !!resolved.deviceId), needDevice };
}
export type Workstation = ReturnType<typeof useWorkstation>;
