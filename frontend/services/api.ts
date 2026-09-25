'use client';

import { useSessionStore, type Realm } from '@/stores/session';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const refreshPath: Record<Realm, string> = { tenant: '/api/v1/auth/refresh', owner: '/api/v1/owner/auth/refresh' };
const inflight: Partial<Record<Realm, Promise<string | null>>> = {};

/** Exchange the httpOnly refresh cookie for a new in-memory access token (rotation happens server-side). */
export async function refreshAccessToken(realm: Realm): Promise<string | null> {
  if (!inflight[realm]) {
    inflight[realm] = (async () => {
      try {
        const res = await fetch(refreshPath[realm], { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'AfeySync' } });
        if (!res.ok) return null;
        const body = await res.json();
        useSessionStore.getState().setToken(realm, body.data.accessToken);
        return body.data.accessToken as string;
      } catch {
        return null;
      } finally {
        setTimeout(() => delete inflight[realm], 0);
      }
    })();
  }
  return inflight[realm]!;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  realm?: Realm;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const realm = opts.realm ?? 'tenant';
  const url = new URL(path.startsWith('/api') ? path : `/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const doFetch = async (token: string | null) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const branch = useSessionStore.getState().branchId;
    if (realm === 'tenant' && branch) headers['X-Branch-Id'] = branch;
    return fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: 'same-origin' });
  };

  let token = opts.auth === false ? null : useSessionStore.getState().tokens[realm] ?? null;
  if (opts.auth !== false && !token) token = await refreshAccessToken(realm);
  let res = await doFetch(token);
  if (res.status === 401 && opts.auth !== false) {
    const fresh = await refreshAccessToken(realm);
    if (fresh) res = await doFetch(fresh);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    if (res.status === 401 && opts.auth !== false) useSessionStore.getState().clear(realm);
    // Server-enforced: a session restricted to MFA enrollment can only reach the setup page.
    if (body?.error?.code === 'MFA_ENROLLMENT_REQUIRED' && typeof window !== 'undefined') {
      const target = realm === 'owner' ? '/owner/setup-2fa' : '/setup-2fa';
      if (window.location.pathname !== target) window.location.assign(target);
    }
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
  }
  return body;
}

export const ownerApi = <T = unknown>(path: string, opts: Omit<ApiOptions, 'realm'> = {}) => api<T>(`/owner${path}`, { ...opts, realm: 'owner' });

/** Authenticated request that is not JSON: multipart uploads and file downloads (CSV, documents). */
export async function apiRaw(path: string, opts: { method?: string; form?: FormData; query?: Record<string, string | undefined> } = {}): Promise<Response> {
  const url = new URL(path.startsWith('/api') ? path : `/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);
  const doFetch = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const branch = useSessionStore.getState().branchId;
    if (branch) headers['X-Branch-Id'] = branch;
    return fetch(url, { method: opts.method ?? (opts.form ? 'POST' : 'GET'), headers, body: opts.form, credentials: 'same-origin' });
  };
  let token = useSessionStore.getState().tokens.tenant ?? (await refreshAccessToken('tenant'));
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refreshAccessToken('tenant');
    if (token) res = await doFetch(token);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
  }
  return res;
}

/** Download (or open) an authenticated file without exposing the token in a URL. */
export async function downloadFile(path: string, fileName: string, opts: { query?: Record<string, string | undefined>; open?: boolean } = {}) {
  const res = await apiRaw(path, { query: opts.query });
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  if (opts.open) window.open(href, '_blank', 'noopener');
  else {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
