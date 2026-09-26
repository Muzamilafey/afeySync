'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Mail, MailOpen, MessageCircle, Phone } from 'lucide-react';
import { ownerApi } from '@/services/api';
import { Badge, Button, EmptyState, ErrorText, Loading, PageHeader, SearchInput, Tabs, Textarea, useDebounced } from '@/components/ui';
import { cn, fmtDateTime } from '@/lib/utils';

type Status = 'new' | 'read' | 'replied' | 'archived';
interface Message { _id: string; name: string; email: string; phone?: string; facility?: string; topic: string; topicLabel: string; message: string; status: Status; note?: string; emailed: boolean; handledByName?: string; handledAt?: string; createdAt: string }
type Filter = 'inbox' | Status;

const STATUS_TONE: Record<Status, 'amber' | 'gray' | 'green' | 'blue'> = { new: 'amber', read: 'gray', replied: 'green', archived: 'blue' };
const STATUS_LABEL: Record<Status, string> = { new: 'New', read: 'Read', replied: 'Replied', archived: 'Archived' };
/** wa.me takes the number in international form without the plus. */
const waNumber = (p?: string) => {
  const d = (p ?? '').replace(/\D/g, '');
  return /^0[17]\d{8}$/.test(d) ? `254${d.slice(1)}` : /^254\d{9}$/.test(d) ? d : null;
};

export default function OwnerMessagesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('inbox');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const list = useQuery({
    queryKey: ['owner-messages', filter, dq],
    queryFn: async () => ownerApi<Message[]>('/contact-messages', { query: { status: filter === 'inbox' ? undefined : filter, q: dq || undefined, limit: '100' } }),
  });
  const rows = list.data?.data ?? [];
  const open = rows.find((m) => m._id === openId) ?? null;
  const update = useMutation({
    mutationFn: async (body: { id: string; status?: Status; note?: string }) => (await ownerApi<Message>(`/contact-messages/${body.id}`, { method: 'PATCH', body: { status: body.status, note: body.note } })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-messages'] }); qc.invalidateQueries({ queryKey: ['owner-messages-unread'] }); },
  });
  // Opening a new message marks it read.
  useEffect(() => {
    if (open) setNote(open.note ?? '');
    if (open?.status === 'new') update.mutate({ id: open._id, status: 'read' });
  }, [open?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = Number(list.data?.meta?.unread ?? 0);
  return (
    <div>
      <PageHeader title="Messages" subtitle="Everything sent through the contact form on afey.co.ke. Messages are also emailed to your inbox when one is set up." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs<Filter> value={filter} onChange={(f) => { setFilter(f); setOpenId(null); }} tabs={[{ key: 'inbox', label: unread ? `Inbox (${unread} new)` : 'Inbox' }, { key: 'new', label: 'New' }, { key: 'replied', label: 'Replied' }, { key: 'archived', label: 'Archived' }]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search name, email, facility or message" className="w-full sm:w-80" />
      </div>
      <ErrorText error={list.error || update.error} />
      {list.isLoading ? <Loading /> : !rows.length ? (
        <EmptyState title={dq ? 'No messages match your search' : 'No messages here'} icon={<Mail className="h-8 w-8" />}>New messages from the website contact form will appear here.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="surface divide-y divide-[var(--border)] self-start overflow-hidden rounded-xl">
            {rows.map((m) => (
              <li key={m._id}>
                <button type="button" onClick={() => setOpenId(m._id)} className={cn('w-full px-4 py-3 text-left hover:bg-[var(--surface-2)]', openId === m._id && 'bg-[var(--surface-2)]')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('truncate', m.status === 'new' ? 'font-semibold' : 'font-medium')}>{m.name}{m.facility ? <span className="muted font-normal"> · {m.facility}</span> : null}</span>
                    <span className="muted shrink-0 text-xs">{fmtDateTime(m.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                    <span className="muted">{m.topicLabel}</span>
                  </div>
                  <p className="muted mt-1 line-clamp-2 text-sm">{m.message}</p>
                </button>
              </li>
            ))}
          </ul>
          {open ? (
            <article className="surface self-start rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{open.name}</h2>
                  <p className="muted text-sm">{open.topicLabel}{open.facility ? ` · ${open.facility}` : ''} · {fmtDateTime(open.createdAt)}</p>
                </div>
                <Badge tone={STATUS_TONE[open.status]}>{STATUS_LABEL[open.status]}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <a href={`mailto:${open.email}?subject=${encodeURIComponent(`Re: your AfeySync enquiry (${open.topicLabel})`)}`} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)]"><Mail className="h-4 w-4" /> {open.email}</a>
                {open.phone && <a href={`tel:${open.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)]"><Phone className="h-4 w-4" /> {open.phone}</a>}
                {waNumber(open.phone) && <a href={`https://wa.me/${waNumber(open.phone)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)]"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
              </div>
              <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-2)] p-4 text-sm leading-relaxed">{open.message}</p>
              <p className="muted mt-2 text-xs">{open.emailed ? 'Also emailed to your inbox.' : 'Not emailed (no inbox set up), saved here only.'}{open.handledByName && open.status !== 'new' ? ` Last updated by ${open.handledByName}${open.handledAt ? `, ${fmtDateTime(open.handledAt)}` : ''}.` : ''}</p>
              <label className="mt-4 block text-sm">
                <span className="label">Internal note</span>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called back, demo booked for Friday" />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => update.mutate({ id: open._id, status: 'replied', note })} loading={update.isPending && update.variables?.status === 'replied'}><Check className="h-4 w-4" /> Mark replied</Button>
                {note !== (open.note ?? '') && <Button variant="outline" onClick={() => update.mutate({ id: open._id, note })}>Save note</Button>}
                {open.status !== 'new' && <Button variant="ghost" onClick={() => update.mutate({ id: open._id, status: 'new' })}><MailOpen className="h-4 w-4" /> Mark unread</Button>}
                {open.status !== 'archived'
                  ? <Button variant="ghost" onClick={() => { update.mutate({ id: open._id, status: 'archived' }); setOpenId(null); }}><Archive className="h-4 w-4" /> Archive</Button>
                  : <Button variant="ghost" onClick={() => update.mutate({ id: open._id, status: 'read' })}>Move to inbox</Button>}
              </div>
            </article>
          ) : (
            <div className="muted hidden items-center justify-center rounded-xl border border-dashed border-[var(--border)] p-10 text-sm lg:flex">Choose a message to read it.</div>
          )}
        </div>
      )}
    </div>
  );
}
