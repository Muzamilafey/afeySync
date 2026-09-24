'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Me } from '@/types/api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: async () => (await api<Me>('/auth/me')).data, retry: false, staleTime: 60_000 });
}

export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (...perms: string[]) => perms.some((p) => set.has(p));
}
