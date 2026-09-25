'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bold, ExternalLink, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Minus, Quote, Table2, Trash2, Upload, X } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { uploadOwnerImage } from '@/features/blog/uploadImage';
import { Alert, Button, ErrorText, Field, Input, Loading, Select, Tabs, Textarea } from '@/components/ui';
import { Markdown } from '@/features/site/Markdown';
import { websiteUrl, formatDate, type OwnerPost } from '@/features/blog/shared';
import { cn } from '@/lib/utils';

interface Draft { title: string; slug: string; excerpt: string; content: string; coverImageId: string | null; coverImageUrl: string | null; coverAlt: string; category: string; tags: string; status: 'draft' | 'published'; publishedAt: string; seoTitle: string; seoDescription: string }
const EMPTY: Draft = { title: '', slug: '', excerpt: '', content: '', coverImageId: null, coverImageUrl: null, coverAlt: '', category: '', tags: '', status: 'draft', publishedAt: '', seoTitle: '', seoDescription: '' };
const CATEGORIES = ['News', 'Guides', 'Product updates', 'SHA & insurance', 'Health facility management', 'Customer stories'];

const uploadImage = uploadOwnerImage;

const toLocalInput = (d: string | null | undefined) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

export default function BlogEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState<'cover' | 'inline' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const inlineInput = useRef<HTMLInputElement>(null);

  const post = useQuery({ queryKey: ['owner-blog-post', id], enabled: !isNew, queryFn: async () => (await ownerApi<OwnerPost>(`/blog/posts/${id}`)).data });
  useEffect(() => {
    const p = post.data;
    if (!p) return;
    setD({ title: p.title, slug: p.slug, excerpt: p.excerpt, content: p.content, coverImageId: p.coverImageId, coverImageUrl: p.coverImageUrl, coverAlt: p.coverAlt, category: p.category ?? '', tags: p.tags.join(', '), status: p.status, publishedAt: toLocalInput(p.publishedAt), seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '' });
    setDirty(false);
  }, [post.data]);

  // A new article opens at its own address after the first save; keep the confirmation.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('saved');
    if (q === 'published') setSaved('Published. It is now live on the website.');
    else if (q === 'draft') setSaved('Draft saved.');
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setDirty(true); setSaved(null); };

  const save = useMutation({
    mutationFn: async (status: 'draft' | 'published') => {
      const body = {
        title: d.title, slug: d.slug || null, excerpt: d.excerpt, content: d.content, coverImageId: d.coverImageId, coverAlt: d.coverAlt,
        category: d.category, tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10), status,
        publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null, seoTitle: d.seoTitle, seoDescription: d.seoDescription,
      };
      return (await ownerApi<{ id: string; slug: string }>(isNew ? '/blog/posts' : `/blog/posts/${id}`, { method: isNew ? 'POST' : 'PUT', body })).data;
    },
    onSuccess: (r, status) => {
      setDirty(false);
      setD((x) => ({ ...x, slug: r.slug, status }));
      setSaved(status === 'published' ? 'Published. It is now live on the website.' : 'Draft saved.');
      qc.invalidateQueries({ queryKey: ['owner-blog'] });
      qc.invalidateQueries({ queryKey: ['owner-blog-post', r.id] });
      if (isNew) router.replace(`/owner/blog/${r.id}?saved=${status}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => ownerApi(`/blog/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['owner-blog'] }); router.replace('/owner/blog'); },
  });

  /** Wraps the selection (or inserts a template) in the content box. */
  const wrap = (before: string, after = '', placeholder = '') => {
    const el = textRef.current;
    const start = el?.selectionStart ?? d.content.length;
    const end = el?.selectionEnd ?? d.content.length;
    const selected = d.content.slice(start, end) || placeholder;
    const next = d.content.slice(0, start) + before + selected + after + d.content.slice(end);
    set('content', next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };
  const linePrefix = (prefix: string, placeholder: string) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? d.content.length;
    const lineStart = d.content.lastIndexOf('\n', start - 1) + 1;
    const current = d.content.slice(lineStart, el?.selectionEnd ?? start);
    const text = current || placeholder;
    const lines = text.split('\n').map((l, i) => (prefix === '1. ' ? `${i + 1}. ` : prefix) + l.replace(/^(#{1,4}\s|>\s|[-*]\s|\d+\.\s)/, '')).join('\n');
    set('content', d.content.slice(0, lineStart) + lines + d.content.slice(el?.selectionEnd ?? start));
    requestAnimationFrame(() => el?.focus());
  };
  const insertBlock = (block: string) => {
    const el = textRef.current;
    const pos = el?.selectionEnd ?? d.content.length;
    const before = d.content.slice(0, pos);
    const pad = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    set('content', `${before}${pad}${block}\n\n${d.content.slice(pos).replace(/^\n+/, '')}`);
    requestAnimationFrame(() => el?.focus());
  };

  const onCover = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading('cover'); setUploadError(null);
    try {
      const img = await uploadImage(file);
      setD((x) => ({ ...x, coverImageId: img.id, coverImageUrl: img.url, coverAlt: x.coverAlt || d.title }));
      setDirty(true);
    } catch (err) { setUploadError(err instanceof Error ? err.message : 'Upload failed'); } finally { setUploading(null); }
  };
  const onInline = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setUploading('inline'); setUploadError(null);
    try {
      for (const file of files) {
        const img = await uploadImage(file);
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '');
        insertBlock(`![${alt}](${img.url} "${alt}")`);
      }
    } catch (err) { setUploadError(err instanceof Error ? err.message : 'Upload failed'); } finally { setUploading(null); }
  };
  // Paste or drop an image straight into the text.
  const onPasteOrDrop = async (files: FileList | null | undefined, prevent: () => void) => {
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    prevent();
    setUploading('inline'); setUploadError(null);
    try {
      for (const f of images) { const img = await uploadImage(f); insertBlock(`![Image](${img.url})`); }
    } catch (err) { setUploadError(err instanceof Error ? err.message : 'Upload failed'); } finally { setUploading(null); }
  };

  if (!isNew && post.isLoading) return <Loading />;
  if (!isNew && post.error) return <ErrorText error={post.error} />;

  const tools: Array<{ icon: typeof Bold; label: string; run: () => void }> = [
    { icon: Heading2, label: 'Heading', run: () => linePrefix('## ', 'Section heading') },
    { icon: Heading3, label: 'Sub-heading', run: () => linePrefix('### ', 'Sub-heading') },
    { icon: Bold, label: 'Bold', run: () => wrap('**', '**', 'bold text') },
    { icon: Italic, label: 'Italic', run: () => wrap('*', '*', 'italic text') },
    { icon: Link2, label: 'Link', run: () => wrap('[', '](https://)', 'link text') },
    { icon: List, label: 'Bullet list', run: () => linePrefix('- ', 'List item') },
    { icon: ListOrdered, label: 'Numbered list', run: () => linePrefix('1. ', 'Step') },
    { icon: Quote, label: 'Quote', run: () => linePrefix('> ', 'Quote') },
    { icon: Table2, label: 'Table', run: () => insertBlock('| Column | Column |\n| --- | --- |\n| Value | Value |') },
    { icon: Minus, label: 'Divider', run: () => insertBlock('---') },
  ];
  const words = d.content.split(/\s+/).filter(Boolean).length;
  const live = d.status === 'published' && !isNew;

  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/owner/blog" className="rounded-md p-1.5 hover:bg-[var(--surface-2)]" aria-label="Back to articles"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{isNew ? 'New article' : d.title || 'Edit article'}</h1>
            <p className="muted text-xs">{live ? <>Live at <a className="text-brand-600 hover:underline" href={websiteUrl(`/blog/${d.slug}`)} target="_blank" rel="noreferrer">{websiteUrl(`/blog/${d.slug}`).replace(/^https?:\/\//, '')}</a></> : 'Draft: only visible here until you publish'} · {words} words · about {Math.max(1, Math.round(words / 200))} min read</p>
          </div>
        </div>
        {live && <a href={websiteUrl(`/blog/${d.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">View on website <ExternalLink className="h-3.5 w-3.5" /></a>}
      </div>

      {save.error && <div className="mb-3"><ErrorText error={save.error} /></div>}
      {uploadError && <div className="mb-3"><Alert tone="red">{uploadError}</Alert></div>}
      {saved && <div className="mb-3"><Alert tone="green">{saved}</Alert></div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="surface space-y-4 rounded-xl p-4">
            <Field label="Title *"><Input value={d.title} maxLength={160} placeholder="e.g. How to prepare your facility for SHA claims" className="text-lg font-semibold" onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Summary" hint="One or two sentences shown on the blog list and in Google results."><Textarea rows={2} maxLength={300} value={d.excerpt} onChange={(e) => set('excerpt', e.target.value)} /></Field>
          </div>

          <div className="surface rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
              <Tabs<'write' | 'preview'> tabs={[{ key: 'write', label: 'Write' }, { key: 'preview', label: 'Preview' }]} value={view} onChange={setView} />
              {view === 'write' && (
                <div className="flex flex-wrap items-center gap-0.5">
                  {tools.map(({ icon: Icon, label, run }) => (
                    <button key={label} type="button" title={label} aria-label={label} onClick={run} className="rounded-md p-2 hover:bg-[var(--surface-2)]"><Icon className="h-4 w-4" /></button>
                  ))}
                  <button type="button" onClick={() => inlineInput.current?.click()} disabled={uploading === 'inline'} className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                    {uploading === 'inline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Add image
                  </button>
                  <input ref={inlineInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={onInline} />
                </div>
              )}
            </div>
            {view === 'write' ? (
              <textarea
                ref={textRef}
                value={d.content}
                onChange={(e) => set('content', e.target.value)}
                onPaste={(e) => onPasteOrDrop(e.clipboardData?.files, () => e.preventDefault())}
                onDrop={(e) => onPasteOrDrop(e.dataTransfer?.files, () => e.preventDefault())}
                placeholder={'Write your article here.\n\n## A section heading\n\nParagraphs are separated by an empty line. Use the buttons above for **bold**, lists, links and images, or paste / drag a picture straight in.'}
                className="min-h-[520px] w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
              />
            ) : (
              <div className="p-6">
                {d.coverImageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={d.coverImageUrl} alt={d.coverAlt} className="mb-6 aspect-[16/8] w-full rounded-xl object-cover" />}
                <h1 className="mb-2 text-3xl font-bold tracking-tight">{d.title || 'Untitled article'}</h1>
                {d.excerpt && <p className="muted mb-6 text-lg">{d.excerpt}</p>}
                {d.content.trim() ? <Markdown source={d.content} /> : <p className="muted">Nothing written yet.</p>}
              </div>
            )}
          </div>
          <p className="muted text-xs">Tip: paste or drag pictures into the text. Images (PNG, JPEG, WebP or GIF, up to 5 MB) appear full width with the caption in quotes: <code>![Alt text](link &quot;Caption&quot;)</code>.</p>
        </div>

        <aside className="space-y-4">
          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Publish</p>
            <Field label="Status">
              <div className={cn('rounded-md px-3 py-2 text-sm font-medium', d.status === 'published' && !isNew ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-[var(--surface-2)]')}>{d.status === 'published' && !isNew ? 'Published' : 'Draft'}</div>
            </Field>
            <Field label="Publish date" hint="Leave empty to use the moment you publish. A future date schedules it."><Input type="datetime-local" value={d.publishedAt} onChange={(e) => set('publishedAt', e.target.value)} /></Field>
            {d.publishedAt && d.status === 'published' && <p className="muted text-xs">Shows as {formatDate(d.publishedAt)}.</p>}
            <div className="grid gap-2">
              <Button onClick={() => save.mutate('published')} loading={save.isPending && save.variables === 'published'} disabled={d.title.trim().length < 3}>{d.status === 'published' && !isNew ? 'Update article' : 'Publish'}</Button>
              <Button variant="outline" onClick={() => save.mutate('draft')} loading={save.isPending && save.variables === 'draft'} disabled={d.title.trim().length < 3}>{d.status === 'published' && !isNew ? 'Unpublish (back to draft)' : 'Save draft'}</Button>
            </div>
            {dirty && <p className="text-xs text-amber-600">You have unsaved changes.</p>}
          </div>

          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Cover image</p>
            {d.coverImageUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.coverImageUrl} alt={d.coverAlt} className="aspect-[16/9] w-full rounded-lg object-cover" />
                <button type="button" onClick={() => { setD((x) => ({ ...x, coverImageId: null, coverImageUrl: null })); setDirty(true); }} className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white" aria-label="Remove cover"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-4 py-8 text-center text-sm hover:border-brand-500">
                {uploading === 'cover' ? <Loader2 className="h-6 w-6 animate-spin text-brand-600" /> : <Upload className="h-6 w-6 text-brand-600" />}
                <span>Upload a cover picture</span>
                <span className="muted text-xs">Wide pictures work best (1600 × 900)</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onCover} />
              </label>
            )}
            {d.coverImageUrl && <Field label="Describe the picture" hint="Read aloud by screen readers and used by Google."><Input value={d.coverAlt} maxLength={160} onChange={(e) => set('coverAlt', e.target.value)} /></Field>}
          </div>

          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Organise</p>
            <Field label="Category">
              <Select value={CATEGORIES.includes(d.category) || !d.category ? d.category : '__custom'} onChange={(e) => set('category', e.target.value === '__custom' ? d.category || 'Other' : e.target.value)}>
                <option value="">None</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                {!CATEGORIES.includes(d.category) && d.category && <option value="__custom">{d.category}</option>}
              </Select>
            </Field>
            <Field label="Tags" hint="Separate with commas, e.g. SHA, billing"><Input value={d.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
            <Field label="Web address" hint={`${websiteUrl('/blog/').replace(/^https?:\/\//, '')}${d.slug || 'made-from-the-title'}`}><Input value={d.slug} placeholder="made-from-the-title" onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></Field>
          </div>

          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Google search</p>
            <Field label="Search title" hint={`${d.seoTitle.length}/70 · leave empty to use the title`}><Input value={d.seoTitle} maxLength={70} onChange={(e) => set('seoTitle', e.target.value)} /></Field>
            <Field label="Search description" hint={`${d.seoDescription.length}/170 · leave empty to use the summary`}><Textarea rows={3} maxLength={170} value={d.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} /></Field>
            <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">{websiteUrl(`/blog/${d.slug || 'article'}`).replace(/^https?:\/\//, '')}</p>
              <p className="truncate font-medium text-blue-700 dark:text-blue-400">{d.seoTitle || d.title || 'Article title'}</p>
              <p className="muted line-clamp-2 text-xs">{d.seoDescription || d.excerpt || 'The summary appears here.'}</p>
            </div>
          </div>

          {!isNew && (
            <Button variant="danger" className="w-full" loading={remove.isPending} onClick={() => { if (confirm('Delete this article permanently? It will disappear from the website.')) remove.mutate(); }}>
              <Trash2 className="h-4 w-4" /> Delete article
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
