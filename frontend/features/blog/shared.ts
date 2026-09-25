export interface PostSummary { id: string; title: string; slug: string; excerpt: string; coverImageUrl: string | null; coverAlt: string; category: string | null; tags: string[]; publishedAt: string | null; authorName: string; readingMinutes: number }
export interface PostFull extends PostSummary { content: string; seoTitle: string | null; seoDescription: string | null; updatedAt: string | null; related?: PostSummary[] }
export interface OwnerPostRow extends PostSummary { status: 'draft' | 'published'; updatedAt: string; updatedByName: string | null }
export interface OwnerPost extends PostFull { status: 'draft' | 'published'; coverImageId: string | null }

const DOMAIN = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost';

/** An address on the public website (afey.co.ke), from the owner portal which lives on another address. */
export const websiteUrl = (path: string) => (DOMAIN === 'localhost' ? `http://localhost:3000${path}` : `https://${DOMAIN}${path}`);

export const formatDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
