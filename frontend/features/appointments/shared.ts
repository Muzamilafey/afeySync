'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface Appt {
  _id: string;
  appointmentNumber: string;
  scheduledAt: string;
  durationMinutes: number;
  status: 'booked' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  reason?: string;
  providerName?: string;
  department?: string;
  serviceCode?: string;
  serviceName?: string;
  courseId?: string;
  courseIndex?: number;
  courseTotal?: number;
  patientId: { _id: string; patientNumber: string; firstName: string; lastName: string; phone?: string };
}
export interface Provider { _id: string; name: string; cadre?: string | null; roles?: string[] }
export interface BookableService { code: string; name: string; category: string; department?: string }

/** Times are shown in Kenya time whatever the device's time zone. */
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' });
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });

export function statusBadge(s: Appt['status']): { label: string; tone: 'blue' | 'green' | 'gray' | 'amber' | 'red' } {
  return { booked: { label: 'Booked', tone: 'blue' as const }, checked_in: { label: 'Checked in', tone: 'green' as const }, completed: { label: 'Completed', tone: 'green' as const }, cancelled: { label: 'Cancelled', tone: 'gray' as const }, no_show: { label: 'No-show', tone: 'amber' as const } }[s] ?? { label: s, tone: 'gray' };
}

export const useProviders = (enabled = true) => useQuery({ queryKey: ['appt-providers'], enabled, staleTime: 5 * 60_000, queryFn: async () => (await api<Provider[]>('/appointments/providers')).data });
export const useServices = (enabled = true) => useQuery({ queryKey: ['appt-services'], enabled, staleTime: 5 * 60_000, queryFn: async () => (await api<BookableService[]>('/appointments/services')).data });
