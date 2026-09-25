'use client';

import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';

export interface OwnerPlan { key: string; name: string; active: boolean; prices: { monthly: number; quarterly: number; annual: number }; maxBranches: number; maxUsers: number; trialDays: number }
export const useOwnerPlans = () => useQuery({ queryKey: ['owner-plans'], queryFn: async () => (await ownerApi<OwnerPlan[]>('/plans')).data, staleTime: 60_000 });
