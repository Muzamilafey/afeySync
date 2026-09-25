import type { Realm } from '@/stores/session';

export type MfaMethod = 'totp' | 'email' | 'sms';
export interface MfaChallengeData { mfaRequired: true; challengeToken: string; methods: MfaMethod[]; preferred?: MfaMethod; recoveryAvailable: boolean; email: string; phone?: string }
export interface LoginResult { accessToken?: string; mustChangePassword?: boolean; mfaEnrollmentRequired?: boolean; mfaRequired?: boolean }
export const authBase = (realm: Realm) => (realm === 'owner' ? '/owner/auth' : '/auth');
export const METHOD_LABEL: Record<MfaMethod, string> = { totp: 'Authenticator app', email: 'Email code', sms: 'SMS code' };
