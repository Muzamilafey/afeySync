export type AnnouncementCategory = 'feature' | 'improvement' | 'fix' | 'maintenance' | 'notice';
export interface Announcement { id: string; title: string; body: string; category: AnnouncementCategory; coverImageUrl: string | null; pinned: boolean; publishedAt: string | null; authorName: string; unread?: boolean }

export const CATEGORY_META: Record<AnnouncementCategory, { label: string; className: string }> = {
  feature: { label: 'New feature', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' },
  improvement: { label: 'Improvement', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300' },
  fix: { label: 'Fix', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300' },
  maintenance: { label: 'Maintenance', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
  notice: { label: 'Notice', className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200' },
};
