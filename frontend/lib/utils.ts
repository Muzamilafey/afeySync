import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, differenceInYears } from 'date-fns';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fmtDate = (d?: string | Date | null, f = 'dd MMM yyyy') => (d ? format(new Date(d), f) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? format(new Date(d), 'dd MMM yyyy HH:mm') : '—');
export const ago = (d?: string | Date | null) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : 'never');
export const age = (dob?: string | null) => (dob ? `${differenceInYears(new Date(), new Date(dob))} yrs` : '—');
export const fullName = (p: { firstName?: string; middleName?: string; lastName?: string }) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
export const money = (n?: number | null) => (n == null ? '—' : `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`);
