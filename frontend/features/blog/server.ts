import type { PostFull, PostSummary } from './shared';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

/** Reads the published articles from the API (server side; the API only ever returns published ones). */
export async function fetchPosts(query: { page?: number; q?: string; category?: string; tag?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
  try {
    const res = await fetch(`${API}/api/v1/blog/posts?${qs}`, { headers: { Accept: 'application/json' }, next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { posts: [] as PostSummary[], total: 0, categories: [] as string[], page: 1, limit: 12 };
    const body = (await res.json()) as { data: PostSummary[]; meta: { total: number; categories: string[]; page: number; limit: number } };
    return { posts: body.data, total: body.meta.total, categories: body.meta.categories, page: body.meta.page, limit: body.meta.limit };
  } catch {
    return { posts: [] as PostSummary[], total: 0, categories: [] as string[], page: 1, limit: 12 };
  }
}

export async function fetchPost(slug: string): Promise<PostFull | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  try {
    const res = await fetch(`${API}/api/v1/blog/posts/${slug}`, { headers: { Accept: 'application/json' }, next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return ((await res.json()) as { data: PostFull }).data;
  } catch {
    return null;
  }
}
