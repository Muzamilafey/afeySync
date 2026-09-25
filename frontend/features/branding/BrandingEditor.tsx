'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImageUp, Trash2 } from 'lucide-react';
import { Alert, Button, Card, ErrorText, Field, Input, Loading, Textarea } from '@/components/ui';
import { api, ownerApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { BrandMark, type Branding } from './branding';

type EditorBranding = Branding & { logoDataUrl: string | null };

const PRESETS = ['#0b8a72', '#1d4ed8', '#7c3aed', '#be123c', '#c2410c', '#0369a1', '#15803d', '#334155'];
const MAX_BYTES = 512 * 1024;

/** WCAG contrast of white text on a colour (buttons use white text on the brand colour). */
function contrastWithWhite(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05);
}

/**
 * Edits a facility's branding. `tenantId` set → the owner portal edits that facility; otherwise the
 * signed-in facility edits its own.
 */
export function BrandingEditor({ tenantId, address }: { tenantId?: string; address?: string }) {
  const qc = useQueryClient();
  const call = <T,>(path: string, opts: Parameters<typeof api>[1] = {}) => (tenantId ? ownerApi<T>(`/tenants/${tenantId}/branding${path}`, opts) : api<T>(`/admin/branding${path}`, opts));
  const key = ['branding-editor', tenantId ?? 'self'];
  const q = useQuery({ queryKey: key, queryFn: async () => (await call<EditorBranding>('')).data });
  const [form, setForm] = useState({ displayName: '', tagline: '', welcomeMessage: '', primaryColor: '' });
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setForm({ displayName: q.data.name === q.data.legalName ? '' : q.data.name, tagline: q.data.tagline ?? '', welcomeMessage: q.data.welcomeMessage ?? '', primaryColor: q.data.primaryColor ?? '' });
  }, [q.data]);

  const done = (data: EditorBranding) => {
    qc.setQueryData(key, data);
    if (!tenantId) qc.invalidateQueries({ queryKey: ['host-context'] });
  };
  const save = useMutation({
    mutationFn: async () => (await call<EditorBranding>('', { method: 'PUT', body: form })).data,
    onSuccess: (d) => { done(d); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
      return (await call<EditorBranding>('/logo', { method: 'PUT', body: { dataBase64 } })).data;
    },
    onSuccess: done,
  });
  const removeLogo = useMutation({ mutationFn: async () => (await call<EditorBranding>('/logo', { method: 'DELETE' })).data, onSuccess: done });

  const pick = (f?: File) => {
    setFileError(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type)) return setFileError('Choose a PNG or JPEG image.');
    if (f.size > MAX_BYTES) return setFileError('The logo must be 512 KB or smaller.');
    upload.mutate(f);
  };

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;

  const color = /^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : '';
  const tooLight = color ? contrastWithWhite(color) < 3 : false;
  const shown = color || '#0b8a72';
  const preview: Branding = { ...q.data, name: form.displayName.trim() || q.data.legalName, tagline: form.tagline.trim() || null, welcomeMessage: form.welcomeMessage.trim() || null, primaryColor: color || null, logoUrl: q.data.logoDataUrl };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <Card title="Logo">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)]">
              {q.data.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.data.logoDataUrl} alt="Current logo" className="h-16 w-16 object-contain" />
              ) : (
                <ImageUp className="h-7 w-7 text-slate-400" />
              )}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => fileRef.current?.click()} loading={upload.isPending}><ImageUp className="h-4 w-4" /> {q.data.logoDataUrl ? 'Replace logo' : 'Upload logo'}</Button>
                {q.data.logoDataUrl && <Button size="sm" variant="outline" onClick={() => removeLogo.mutate()} loading={removeLogo.isPending}><Trash2 className="h-4 w-4" /> Remove</Button>}
              </div>
              <p className="muted text-xs">Square PNG with a transparent background works best (at least 256×256, up to 512 KB). It appears on the sign-in page, the app header and the browser tab.</p>
            </div>
          </div>
          {fileError && <p className="mt-2 text-sm text-red-600">{fileError}</p>}
          <div className="mt-2"><ErrorText error={upload.error || removeLogo.error} /></div>
        </Card>

        <Card title="Name and message">
          <div className="space-y-4">
            <Field label="Display name" hint={`Leave empty to use the registered name, “${q.data.legalName}”.`}>
              <Input value={form.displayName} maxLength={80} placeholder={q.data.legalName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>
            <Field label="Tagline" hint="A short line under the name, e.g. “Quality care, close to home”.">
              <Input value={form.tagline} maxLength={120} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
            </Field>
            <Field label="Sign-in message" hint="Optional note for staff on the sign-in page (no patient information).">
              <Textarea rows={2} value={form.welcomeMessage} maxLength={300} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Brand colour">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((c) => (
              <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => setForm({ ...form, primaryColor: c })} className={cn('grid h-9 w-9 place-items-center rounded-full ring-offset-2 ring-offset-[var(--surface)] transition', shown.toLowerCase() === c && 'ring-2 ring-slate-400')} style={{ background: c }}>
                {shown.toLowerCase() === c && <Check className="h-4 w-4 text-white" />}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-2 text-sm">
              <input type="color" value={shown} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent" />
              <Input value={form.primaryColor} placeholder="#0b8a72" className="w-28 font-mono" onChange={(e) => setForm({ ...form, primaryColor: e.target.value.trim() })} />
            </label>
            {form.primaryColor && <button type="button" className="muted text-xs underline" onClick={() => setForm({ ...form, primaryColor: '' })}>Use AfeySync green</button>}
          </div>
          {tooLight && <div className="mt-3"><Alert tone="amber">This colour is too light for white text on buttons. Choose a darker shade.</Alert></div>}
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={tooLight || (!!form.primaryColor && !color)}>Save branding</Button>
          {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> Saved</span>}
        </div>
        <ErrorText error={save.error} />
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <p className="muted mb-2 text-xs font-medium uppercase tracking-wide">Preview{address ? ` · ${address}` : ''}</p>
        <div className="overflow-hidden rounded-2xl p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${shown} 45%, black), #0f172a)` }}>
          <div className="surface rounded-xl p-4 shadow-xl">
            <BrandMark branding={preview} className="mb-3" />
            {preview.welcomeMessage && <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: `color-mix(in srgb, ${shown} 10%, white)`, color: `color-mix(in srgb, ${shown} 45%, black)` }}>{preview.welcomeMessage}</p>}
            <div className="space-y-2">
              <div className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface-2)]" />
              <div className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface-2)]" />
              <div className="grid h-9 place-items-center rounded-md text-sm font-medium text-white" style={{ background: shown }}>Sign in</div>
            </div>
            <p className="muted mt-3 text-center text-[11px]">Powered by AfeySync</p>
          </div>
        </div>
      </div>
    </div>
  );
}
