'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, FlaskConical, UserPlus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Stat, statusTone, Table, Td } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { ITEM_STEPS, type LabItem, type LabOrder } from '@/features/lab/types';
import { ResultEntry } from '@/features/lab/ResultEntry';
import { ResultsTable } from '@/features/lab/ResultsTable';
import { WalkInRequest } from '@/features/lab/WalkInRequest';
import { useRouter } from 'next/navigation';

export default function LaboratoryPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState('ordered');
  const [acc, setAcc] = useState('');
  const [entry, setEntry] = useState<{ order: LabOrder; item: LabItem } | null>(null);
  const [review, setReview] = useState<{ order: LabOrder; item: LabItem } | null>(null);
  const [reject, setReject] = useState<{ order: LabOrder; item: LabItem } | null>(null);
  const [reason, setReason] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const router = useRouter();
  const q = useQuery({ queryKey: ['lab-worklist', status], queryFn: async () => (await api<LabOrder[]>('/laboratory/orders', { query: { itemStatus: status, limit: 200 } })).data, refetchInterval: 20_000 });
  const counts = useQuery({
    queryKey: ['lab-counts'],
    queryFn: async () => Object.fromEntries(await Promise.all(ITEM_STEPS.map(async (s) => [s.status, Number((await api('/laboratory/orders', { query: { itemStatus: s.status, limit: 1 } })).meta?.total ?? 0)]))),
    refetchInterval: 30_000,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lab-worklist'] }); qc.invalidateQueries({ queryKey: ['lab-counts'] }); };
  const step = useMutation({ mutationFn: ({ o, i, s, body }: { o: LabOrder; i: LabItem; s: string; body?: object }) => api(`/laboratory/orders/${o._id}/items/${i._id}/${s}`, { method: 'POST', body: body ?? {} }), onSuccess: () => { refresh(); setReview(null); setReject(null); setReason(''); } });
  const lookup = useMutation({ mutationFn: async () => (await api<{ order: LabOrder; item: LabItem }>(`/laboratory/accession/${acc.trim()}`)).data, onSuccess: (d) => { setStatus(d.item.status); setAcc(''); } });
  const current = ITEM_STEPS.find((s) => s.status === status);
  const rows = (q.data ?? []).flatMap((o) => o.items.filter((i) => i.status === status).map((i) => ({ o, i })));
  return (
    <>
      <PageHeader title="Laboratory" crumbs={['Laboratory', 'Worklist']} actions={<div className="flex gap-2">{can('lab.walkin') && <Button onClick={() => setWalkIn(true)}><UserPlus className="h-4 w-4" /> Walk-in request</Button>}{can('lab.manage') && <Link href="/laboratory/tests"><Button variant="outline"><FlaskConical className="h-4 w-4" /> Test catalog & packages</Button></Link>}</div>} />
      <Modal open={walkIn} onClose={() => setWalkIn(false)} title="Walk-in / external lab request" wide>{walkIn && <WalkInRequest onDone={(id) => { setWalkIn(false); router.push(`/laboratory/orders/${id}`); }} />}</Modal>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {ITEM_STEPS.map((s) => (
          <button key={s.status} onClick={() => setStatus(s.status)} className={`text-left ${status === s.status ? 'ring-2 ring-brand-500 rounded-xl' : ''}`}>
            <Stat label={s.label} value={counts.data?.[s.status] ?? '—'} tone={s.status === 'rejected' ? 'red' : 'gray'} />
          </button>
        ))}
      </div>
      <Card title={current?.label} actions={
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (acc.trim()) lookup.mutate(); }}>
          <Input className="w-56" placeholder="Scan / enter accession no." value={acc} onChange={(e) => setAcc(e.target.value)} />
          <Button size="sm" variant="outline" type="submit"><Barcode className="h-4 w-4" /></Button>
        </form>
      }>
        <ErrorText error={q.error || step.error || lookup.error} />
        {q.isLoading && <Loading />}
        <Table head={['Test', 'Patient', 'Order', 'Accession', 'Priority', 'Ordered', '']} empty={rows.length === 0}>
          {rows.map(({ o, i }) => {
            const p = typeof o.patientId === 'object' ? o.patientId : null;
            return (
              <tr key={i._id} className={i.critical ? 'bg-red-50 dark:bg-red-950/30' : ''}>
                <Td className="font-medium">{i.testName}<span className="muted block text-xs">{i.specimen}</span>{i.critical && <Badge tone="red">CRITICAL</Badge>}{i.rejectionReason && <span className="block text-xs text-red-600">{i.rejectionReason}</span>}</Td>
                <Td>{p?.firstName} {p?.lastName}<span className="muted block text-xs capitalize">{p?.gender} · {age(p?.dateOfBirth)} · {p?.patientNumber}</span></Td>
                <Td><Link className="font-mono text-xs text-brand-600" href={`/laboratory/orders/${o._id}`}>{o.orderNumber}</Link><span className="muted block text-xs">{o.orderedByName}</span></Td>
                <Td className="font-mono text-xs">{i.accessionNumber ?? '—'}</Td>
                <Td><Badge tone={o.priority === 'stat' ? 'red' : o.priority === 'urgent' ? 'amber' : 'gray'}>{o.priority}</Badge></Td>
                <Td>{fmtDateTime(o.createdAt)}</Td>
                <Td className="whitespace-nowrap">
                  {current && can(current.perm) && (current.step === 'result' ? (
                    <Button size="sm" onClick={() => setEntry({ order: o, item: i })}>Enter results</Button>
                  ) : current.step === 'verify' || current.step === 'approve' ? (
                    <Button size="sm" onClick={() => setReview({ order: o, item: i })}>{current.step === 'verify' ? 'Review & verify' : 'Review & approve'}</Button>
                  ) : (
                    <Button size="sm" onClick={() => step.mutate({ o, i, s: current.step })}>{current.step === 'collect' ? 'Collect sample' : 'Receive'}</Button>
                  ))}{' '}
                  {['collected', 'received', 'processing'].includes(i.status) && can('lab.sample') && <Button size="sm" variant="ghost" onClick={() => setReject({ order: o, item: i })}>Reject</Button>}
                  {i.status === 'received' && can('lab.result') && <Button size="sm" variant="ghost" onClick={() => step.mutate({ o, i, s: 'process' })}>Processing</Button>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Modal open={!!entry} onClose={() => setEntry(null)} title="Result entry" wide>{entry && <ResultEntry order={entry.order} item={entry.item} onDone={() => { setEntry(null); refresh(); }} />}</Modal>
      <Modal open={!!review} onClose={() => setReview(null)} title={`${review?.item.testName} — ${review?.item.accessionNumber}`} wide>
        {review && (
          <div className="space-y-3">
            <ResultsTable item={review.item} />
            {review.item.comment && <p className="text-sm">Comment: {review.item.comment}</p>}
            <p className="muted text-xs">Entered by {review.item.resultedByName} {review.item.verifiedByName && `· verified by ${review.item.verifiedByName}`}</p>
            <Button onClick={() => step.mutate({ o: review.order, i: review.item, s: review.item.status === 'resulted' ? 'verify' : 'approve' })} loading={step.isPending}>{review.item.status === 'resulted' ? 'VERIFY' : 'APPROVE & RELEASE'}</Button>
          </div>
        )}
      </Modal>
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject specimen">
        <div className="space-y-3">
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Haemolysed / clotted / insufficient / unlabelled" /></Field>
          <Button variant="danger" disabled={reason.length < 3} onClick={() => step.mutate({ o: reject!.order, i: reject!.item, s: 'reject', body: { reason } })}>Reject</Button>
        </div>
      </Modal>
    </>
  );
}
