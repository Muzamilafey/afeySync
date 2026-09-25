'use client';

import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import { api } from '@/services/api';
import { useSessionStore, type Realm } from '@/stores/session';
import { MfaSettings } from './MfaSettings';

/** Standalone page for sessions that must enroll a second factor before using the system. */
export function SetupPage({ realm }: { realm: Realm }) {
  const router = useRouter();
  const clear = useSessionStore((s) => s.clear);
  const home = realm === 'owner' ? '/owner' : '/dashboard';
  const signOut = async () => {
    await api(realm === 'owner' ? '/owner/auth/logout' : '/auth/logout', { method: 'POST', realm }).catch(() => null);
    clear(realm);
    router.replace(realm === 'owner' ? '/owner/login' : '/login');
  };
  return (
    <div className="min-h-screen bg-[var(--bg)] p-4">
      <div className="mx-auto max-w-xl space-y-4 pt-10">
        <div className="flex items-center gap-2"><Activity className="h-6 w-6 text-brand-600" /><p className="text-lg font-semibold">Secure your account</p></div>
        <p className="muted text-sm">Two-step verification protects patient data even if your password is stolen. Choose at least one method below.</p>
        <MfaSettings realm={realm} onEnrollmentComplete={() => router.replace(home)} />
        <button className="muted text-sm underline" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
