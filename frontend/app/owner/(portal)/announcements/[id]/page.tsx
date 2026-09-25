'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Alert, Button, ErrorText, Field, Input, Loading, Select, Tabs } from '@/components/ui';
import { Markdown } from '@/features/site/Markdown';
import { uploadOwnerImage } from '@/features/blog/uploadImage';
import { CATEGORY_META, type Announcement, type AnnouncementCategory } from '@/features/announcements/shared';
import { cn } from '@/lib/utils';

interface Loaded extends Announcement { status: 'draft' | 'published'; audience: 'all' | 'facilities'; tenantIds: string[]; coverImageId: string | null }
interface Tenant { id: string; name: string; slug: string }
interface Draft { title: string; body: string; category: AnnouncementCategory; coverImageId: string | null; coverImageUrl: string | null; audience: 'all' | 'facilities'; tenantIds: string[]; pinned: boolean; status: 'draft' | 'published' }
const EMPTY: Draft = { title: '', body: '', category: 'feature', coverImageId: null, coverImageUrl: null, audience: 'all', tenantIds: [], pinned: false, status: 'draft' };

export default function AnnouncementEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(EMPTY);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState<'cover' | 'inline' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [facilityQ, setFacilityQ] = useState('');
  const text = useRef<HTMLTextAreaElement>(null);

  const loaded = useQuery({ queryKey: ['owner-announcement', id], enabled: !isNew, queryFn: async () => (await ownerApi<Loaded>(`/announcements/${id}`)).data });
  const tenants = useQuery({ queryKey: ['owner-tenants-all'], queryFn: async () => (await ownerApi<Tenant[]>('/tenants', { query: { limit: 100 } })).data });
  useEffect(() => {
    const a = loaded.data;
    if (a) setD({ title: a.title, body: a.body, category: a.category, coverImageId: a.coverImageId, coverImageUrl: a.coverImageUrl, audience: a.audience, tenantIds: a.tenantIds, pinned: a.pinned, status: a.status });
  }, [loaded.data]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('saved');
    if (q) setSaved(q === 'published' ? 'Published. Facilities can see it now.' : 'Draft saved.');
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setSaved(null); };
  const save = useMutation({
    mutationFn: async (status: 'draft' | 'published') => (await ownerApi<{ id: string }>(isNew ? '/announcements' : `/announcements/${id}`, { method: isNew ? 'POST' : 'PUT', body: { title: d.title, body: d.body, category: d.category, coverImageId: d.coverImageId, audience: d.audience, tenantIds: d.audience === 'facilities' ? d.tenantIds : [], pinned: d.pinned, status } })).data,
    onSuccess: (r, status) => {
      setD((x) => ({ ...x, status }));
      setSaved(status === 'published' ? 'Published. Facilities can see it now.' : 'Draft saved.');
      qc.invalidateQueries({ queryKey: ['owner-announcements'] });
      if (isNew) router.replace(`/owner/announcements/${r.id}?saved=${status}`);
    },
  });
  const remove = useMutation({ mutationFn: () => ownerApi(`/announcements/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-announcements'] }); router.replace('/owner/announcements'); } });

  const addImage = async (e: ChangeEvent<HTMLInputElement>, kind: 'cover' | 'inline') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(kind); setErr(null);
    try {
      const img = await uploadOwnerImage(file);
      if (kind === 'cover') setD((x) => ({ ...x, coverImageId: img.id, coverImageUrl: img.url }));
      else {
        const pos = text.current?.selectionEnd ?? d.body.length;
        const before = d.body.slice(0, pos);
        set('body', `${before}${before && !before.endsWith('\n\n') ? '\n\n' : ''}![Screenshot](${img.url})\n\n${d.body.slice(pos)}`);
      }
    } catch (x) { setErr(x instanceof Error ? x.message : 'Upload failed'); } finally { setUploading(null); }
  };

  const shownTenants = useMemo(() => (tenants.data ?? []).filter((t) => `${t.name} ${t.slug}`.toLowerCase().includes(facilityQ.toLowerCase())), [tenants.data, facilityQ]);
  if (!isNew && loaded.isLoading) return <Loading />;
  if (!isNew && loaded.error) return <ErrorText error={loaded.error} />;
  const live = d.status === 'published' && !isNew;

  return (
    <div className="pb-20">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/owner/announcements" className="rounded-md p-1.5 hover:bg-[var(--surface-2)]" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-xl font-semibold">{isNew ? 'New announcement' : d.title || 'Edit announcement'}</h1>
          <p className="muted text-xs">{live ? 'Published: visible in facilities’ What’s new panel' : 'Draft: facilities cannot see it yet'}</p>
        </div>
      </div>
      {save.error && <div className="mb-3"><ErrorText error={save.error} /></div>}
      {err && <div className="mb-3"><Alert tone="red">{err}</Alert></div>}
      {saved && <div className="mb-3"><Alert tone="green">{saved}</Alert></div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="surface space-y-4 rounded-xl p-4">
            <Field label="Title *"><Input value={d.title} maxLength={160} className="text-lg font-semibold" placeholder="e.g. Faster admissions and a new bed board" onChange={(e) => set('title', e.target.value)} /></Field>
          </div>
          <div className="surface rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
              <Tabs<'write' | 'preview'> tabs={[{ key: 'write', label: 'Write' }, { key: 'preview', label: 'Preview' }]} value={view} onChange={setView} />
              {view === 'write' && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                  {uploading === 'inline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Add screenshot
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => addImage(e, 'inline')} />
                </label>
              )}
            </div>
            {view === 'write' ? (
              <textarea ref={text} value={d.body} onChange={(e) => set('body', e.target.value)} placeholder={'What changed and why it matters.\n\n## A. Inpatient\n\n1. Admissions are faster…\n2. …\n\nUse **bold**, lists and screenshots.'} className="min-h-[420px] w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none" />
            ) : (
              <div className="p-5">
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', CATEGORY_META[d.category].className)}>{CATEGORY_META[d.category].label}</span>
                <h2 className="mt-2 text-lg font-bold">{d.title || 'Untitled'}</h2>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {d.coverImageUrl && <img src={d.coverImageUrl} alt="" className="mt-3 w-full rounded-xl" />}
                {d.body.trim() ? <Markdown source={d.body} className="prose-article prose-compact mt-3" /> : <p className="muted mt-3">Nothing written yet.</p>}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="surface space-y-3 rounded-xl p-4">
            <Field label="Type">
              <Select value={d.category} onChange={(e) => set('category', e.target.value as AnnouncementCategory)}>
                {(Object.keys(CATEGORY_META) as AnnouncementCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.pinned} onChange={(e) => set('pinned', e.target.checked)} /> Pin to the top</label>
            <div className="grid gap-2">
              <Button onClick={() => save.mutate('published')} loading={save.isPending && save.variables === 'published'} disabled={d.title.trim().length < 3}>{live ? 'Update' : 'Publish'}</Button>
              <Button variant="outline" onClick={() => save.mutate('draft')} loading={save.isPending && save.variables === 'draft'} disabled={d.title.trim().length < 3}>{live ? 'Unpublish (back to draft)' : 'Save draft'}</Button>
            </div>
          </div>

          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Who sees it</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(['all', 'facilities'] as const).map((a) => (
                <button key={a} type="button" onClick={() => set('audience', a)} className={cn('rounded-lg border px-3 py-2', d.audience === a ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-slate-800 dark:text-emerald-300' : 'border-[var(--border)]')}>{a === 'all' ? 'All facilities' : 'Chosen facilities'}</button>
              ))}
            </div>
            {d.audience === 'facilities' && (
              <div>
                <Input placeholder="Search facilities" value={facilityQ} onChange={(e) => setFacilityQ(e.target.value)} />
                <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                  {shownTenants.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[var(--surface-2)]">
                      <input type="checkbox" checked={d.tenantIds.includes(t.id)} onChange={(e) => set('tenantIds', e.target.checked ? [...d.tenantIds, t.id] : d.tenantIds.filter((x) => x !== t.id))} />
                      <span className="truncate">{t.name}</span>
                    </label>
                  ))}
                </div>
                <p className="muted mt-1 text-xs">{d.tenantIds.length} chosen</p>
              </div>
            )}
          </div>

          <div className="surface space-y-3 rounded-xl p-4">
            <p className="text-sm font-semibold">Banner picture (optional)</p>
            {d.coverImageUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.coverImageUrl} alt="" className="w-full rounded-lg" />
                <button type="button" onClick={() => setD((x) => ({ ...x, coverImageId: null, coverImageUrl: null }))} className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white" aria-label="Remove picture"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-4 py-6 text-center text-sm hover:border-brand-500">
                {uploading === 'cover' ? <Loader2 className="h-6 w-6 animate-spin text-brand-600" /> : <Upload className="h-6 w-6 text-brand-600" />}
                Upload a picture
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => addImage(e, 'cover')} />
              </label>
            )}
          </div>

          {!isNew && <Button variant="danger" className="w-full" loading={remove.isPending} onClick={() => { if (confirm('Delete this announcement? Facilities will no longer see it.')) remove.mutate(); }}><Trash2 className="h-4 w-4" /> Delete</Button>}
        </aside>
      </div>
    </div>
  );
}
