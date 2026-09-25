'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useSessionStore, type Realm } from '@/stores/session';
import { Alert, Loading } from '@/components/ui';
import { MfaChallenge } from './MfaChallenge';
import { authBase, type LoginResult, type MfaChallengeData } from './types';

const ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  GOOGLE_NOT_LINKED: 'This Google account is not linked to a user here. Sign in with your password, then link Google from your account page.',
  GOOGLE_EMAIL_UNVERIFIED: 'Your Google email address is not verified.',
  GOOGLE_DOMAIN_NOT_ALLOWED: 'This Google account is not from an allowed domain.',
  GOOGLE_ALREADY_LINKED: 'This Google account is already linked to another user.',
  GOOGLE_STATE_INVALID: 'This sign-in has expired. Please try again.',
};

function Inner({ realm }: { realm: Realm }) {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const setToken = useSessionStore((s) => s.setToken);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const ran = useRef(false);
  const home = realm === 'owner' ? '/owner' : '/dashboard';
  const account = realm === 'owner' ? '/owner/security' : '/account/security';
  const loginPath = realm === 'owner' ? '/owner/login' : '/login';

  const finish = (r: LoginResult, dest?: string) => {
    setToken(realm, r.accessToken!);
    qc.clear();
    router.replace(r.mfaEnrollmentRequired ? (realm === 'owner' ? '/owner/setup-2fa' : '/setup-2fa') : r.mustChangePassword ? '/account?first=1' : dest ?? home);
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const err = params.get('error');
    const code = params.get('code');
    if (err || !code) {
      setError(ERRORS[err ?? ''] ?? 'Google sign-in failed. Please try again.');
      return;
    }
    api<LoginResult & Partial<MfaChallengeData> & { linked?: boolean; next?: string }>(`${authBase(realm)}/google/complete`, { method: 'POST', body: { code }, auth: false, realm })
      .then((r) => {
        if (r.data.linked) return router.replace(`${account}?google=linked`);
        setNext(r.data.next);
        if (r.data.mfaRequired) return setChallenge(r.data as MfaChallengeData);
        finish(r.data, r.data.next);
      })
      .catch((e) => setError(e instanceof ApiError ? ERRORS[e.code] ?? e.message : 'Google sign-in failed.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="surface w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2"><Activity className="h-6 w-6 text-brand-600" /><p className="font-semibold">AfeySync</p></div>
        {error ? (
          <div className="space-y-4"><Alert tone="red">{error}</Alert><Link className="text-sm text-brand-600" href={loginPath}>Back to sign in</Link></div>
        ) : challenge ? (
          <MfaChallenge realm={realm} challenge={challenge} onSuccess={(r) => finish(r, next)} onCancel={() => router.replace(loginPath)} />
        ) : <Loading label="Completing Google sign-in…" />}
      </div>
    </div>
  );
}

export function GoogleComplete({ realm }: { realm: Realm }) {
  return <Suspense><Inner realm={realm} /></Suspense>;
}
