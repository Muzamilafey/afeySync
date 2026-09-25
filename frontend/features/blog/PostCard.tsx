import Link from 'next/link';
import { Clock, Newspaper } from 'lucide-react';
import { formatDate, type PostSummary } from './shared';
import { cn } from '@/lib/utils';

export function PostCard({ post, featured = false }: { post: PostSummary; featured?: boolean }) {
  return (
    <Link href={`/blog/${post.slug}`} className={cn('group flex overflow-hidden rounded-3xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900', featured ? 'flex-col lg:col-span-3 lg:grid lg:grid-cols-2' : 'flex-col')}>
      <div className={cn('relative overflow-hidden bg-gradient-to-br from-brand-100 to-emerald-50 dark:from-slate-800 dark:to-slate-900', featured ? 'aspect-[16/9] lg:aspect-auto lg:min-h-80' : 'aspect-[16/9]')}>
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt={post.coverAlt || post.title} loading={featured ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-brand-600/60"><Newspaper className="h-12 w-12" aria-hidden /></div>
        )}
      </div>
      <div className={cn('flex flex-1 flex-col p-6', featured && 'lg:justify-center lg:p-10')}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {post.category && <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300">{post.category}</span>}
          <span className="text-slate-500">{formatDate(post.publishedAt)}</span>
        </div>
        <h3 className={cn('mt-3 font-bold tracking-tight text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-emerald-300', featured ? 'text-2xl sm:text-3xl' : 'text-lg')}>{post.title}</h3>
        {post.excerpt && <p className={cn('mt-2 text-slate-600 dark:text-slate-400', featured ? 'text-base' : 'line-clamp-3 text-sm')}>{post.excerpt}</p>}
        <p className="mt-auto flex items-center gap-1.5 pt-4 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden />{post.readingMinutes} min read · {post.authorName}</p>
      </div>
    </Link>
  );
}
