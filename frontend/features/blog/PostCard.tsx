import Link from 'next/link';
import { formatDate, type PostSummary } from './shared';
import { cn } from '@/lib/utils';

export function PostCard({ post, featured = false }: { post: PostSummary; featured?: boolean }) {
  return (
    <Link href={`/blog/${post.slug}`} className={cn('group flex flex-col', featured && 'lg:col-span-full lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-10')}>
      {post.coverImageUrl ? (
        <div className={cn('relative overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800', featured ? 'aspect-[16/9]' : 'aspect-[3/2]')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.coverImageUrl} alt={post.coverAlt || post.title} loading={featured ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:opacity-90" />
        </div>
      ) : (
        <div className={cn('flex items-end rounded-lg border border-stone-200 bg-[#f7f6f2] p-5 dark:border-stone-800 dark:bg-stone-900', featured ? 'aspect-[16/9]' : 'aspect-[3/2]')}>
          <span className="font-display text-2xl leading-snug text-stone-400 dark:text-stone-500">{post.category || 'AfeySync journal'}</span>
        </div>
      )}
      <div className={cn('pt-5', featured && 'lg:pt-0')}>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {post.category && <span className="font-medium text-brand-700 dark:text-emerald-300">{post.category}</span>}
          {post.category && <span aria-hidden> · </span>}
          {formatDate(post.publishedAt)}
        </p>
        <h3 className={cn('font-display mt-2 leading-snug text-stone-900 group-hover:underline group-hover:decoration-stone-300 group-hover:underline-offset-4 dark:text-white', featured ? 'text-3xl sm:text-4xl' : 'text-xl')}>{post.title}</h3>
        {post.excerpt && <p className={cn('mt-2 text-stone-600 dark:text-stone-400', featured ? 'text-base leading-relaxed' : 'line-clamp-3 text-sm leading-relaxed')}>{post.excerpt}</p>}
        <p className="mt-3 text-xs text-stone-500">{post.authorName} · {post.readingMinutes} min read</p>
      </div>
    </Link>
  );
}
