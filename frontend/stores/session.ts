'use client';

import { create } from 'zustand';

export type Realm = 'tenant' | 'owner';

interface SessionState {
  /** Access tokens live in memory only; refresh tokens are httpOnly cookies. */
  tokens: Partial<Record<Realm, string>>;
  branchId: string | null;
  setToken: (realm: Realm, token: string) => void;
  clear: (realm: Realm) => void;
  setBranch: (id: string | null) => void;
}

const BRANCH_KEY = 'afs.branch';
const readBranch = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
};

export const useSessionStore = create<SessionState>((set) => ({
  tokens: {},
  branchId: readBranch(),
  setToken: (realm, token) => set((s) => ({ tokens: { ...s.tokens, [realm]: token } })),
  clear: (realm) => set((s) => ({ tokens: { ...s.tokens, [realm]: undefined } })),
  setBranch: (id) => {
    try {
      if (id) window.localStorage.setItem(BRANCH_KEY, id);
      else window.localStorage.removeItem(BRANCH_KEY);
    } catch {
      /* storage unavailable */
    }
    set({ branchId: id });
  },
}));
