'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useMe } from '@/hooks/useMe';
import { visibleApps, type AppDef } from './catalog';

/** The apps the signed-in user may open, respecting permissions and the facility's plan. */
export function useApps(): AppDef[] {
  const { data: me } = useMe();
  return useMemo(() => {
    if (!me) return [];
    const sub = me.subscription;
    return visibleApps({ perms: new Set(me.permissions), modules: !sub || sub.unrestricted ? null : sub.modules });
  }, [me]);
}

/* ------------------------------------------------------------------ Recently viewed apps (per user, this browser) */
const listeners = new Set<() => void>();
const keyFor = (userId?: string) => `afs.recentApps.${userId ?? 'anon'}`;
const read = (userId?: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(userId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const cache = new Map<string, { raw: string | null; list: string[] }>();
function snapshot(userId?: string) {
  let raw: string | null = null;
  try { raw = localStorage.getItem(keyFor(userId)); } catch { /* storage blocked */ }
  const hit = cache.get(keyFor(userId));
  if (hit && hit.raw === raw) return hit.list;
  const list = read(userId);
  cache.set(keyFor(userId), { raw, list });
  return list;
}
const EMPTY: string[] = [];

export function recordRecentApp(userId: string | undefined, appKey: string) {
  const list = [appKey, ...read(userId).filter((k) => k !== appKey)].slice(0, 8);
  try { localStorage.setItem(keyFor(userId), JSON.stringify(list)); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}

/** Recently opened apps, newest first; before anything is opened, the first few apps the user has. */
export function useRecentApps(limit = 6) {
  const { data: me } = useMe();
  const apps = useApps();
  const userId = me?.user.id;
  const keys = useSyncExternalStore(
    (cb) => { listeners.add(cb); window.addEventListener('storage', cb); return () => { listeners.delete(cb); window.removeEventListener('storage', cb); }; },
    () => snapshot(userId),
    () => EMPTY,
  );
  const remove = useCallback((appKey: string) => {
    try { localStorage.setItem(keyFor(userId), JSON.stringify(read(userId).filter((k) => k !== appKey))); } catch { /* storage blocked */ }
    listeners.forEach((l) => l());
  }, [userId]);
  const recent = keys.map((k) => apps.find((a) => a.key === k)).filter((a): a is AppDef => !!a);
  return { apps: (recent.length ? recent : apps).slice(0, limit), isDefault: recent.length === 0, remove };
}
