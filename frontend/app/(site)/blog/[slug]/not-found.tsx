import Link from 'next/link';

export default function ArticleNotFound() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Article not found</h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">It may have been moved or unpublished.</p>
      <Link href="/blog" className="mt-8 inline-flex rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Browse all articles</Link>
    </section>
  );
}
