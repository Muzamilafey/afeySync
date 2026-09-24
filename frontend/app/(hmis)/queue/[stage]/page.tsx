'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Loading, Modal, PageHeader, Select, Stat, statusTone, Table, Td } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { STAGES, STAGE_LABEL, STAGE_PERMISSION, type QueueEntry } from '@/features/frontdesk/types';
import { VitalsForm } from '@/features/opd/VitalsForm';

const WORKSPACE: Record<string, (e: QueueEntry) => string> = {
  consultation: (e) => `/visits/${e.visitId._id}?tab=consultation`,
  laboratory: () => '/laboratory',
  radiology: () => '/radiology',
  pharmacy: () => '/pharmacy',
  billing: (e) => `/visits/${e.visitId._id}?tab=billing`,
};

export default function QueuePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const [complete, setComplete] = useState<QueueEntry | null>(null);
  const [vitalsFor, setVitalsFor] = useState<QueueEntry | null>(null);
  const [next, setNext] = useState('');
  const q = useQuery({ queryKey: ['queue', stage], queryFn: () => api<QueueEntry[]>('/queues', { query: { stage } }), refetchInterval: 15_000 });
  const act = useMutation({
    mutationFn: ({ id, action, nextStage }: { id: string; action: string; nextStage?: string }) => api(`/queues/${id}/${action}`, { method: 'POST', body: { nextStage: nextStage || undefined } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue', stage] }); setComplete(null); setNext(''); },
  });
  if (!STAGES.includes(stage as never)) return <Alert tone="red">Unknown queue</Alert>;
  const serve = can(STAGE_PERMISSION[stage]);
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={`${STAGE_LABEL[stage]} Queue`} crumbs={['Queues', STAGE_LABEL[stage]]} />
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Waiting" value={rows.filter((r) => r.status === 'waiting').length} tone="amber" />
        <Stat label="Called / in service" value={rows.filter((r) => r.status !== 'waiting').length} tone="blue" />
        <Stat label="Emergency" value={rows.filter((r) => r.priority === 'emergency').length} tone="red" />
        <Stat label="Served today" value={Number(q.data?.meta?.doneToday ?? 0)} tone="green" />
      </div>
      {!serve && <div className="mb-3"><Alert tone="amber">You can view this queue but not serve it.</Alert></div>}
      <ErrorText error={q.error || act.error} />
      <Card>
        {q.isLoading && <Loading />}
        <Table head={['Ticket', 'Patient', 'Visit', 'Priority', 'Status', 'Waiting since', '']} empty={rows.length === 0}>
          {rows.map((e) => (
            <tr key={e._id} className={e.priority === 'emergency' ? 'bg-red-50 dark:bg-red-950/30' : ''}>
              <Td className="font-mono text-lg font-bold">{e.ticket}</Td>
              <Td>
                <Link href={`/patients/${e.patientId._id}`} className="font-medium hover:underline">{e.patientId.firstName} {e.patientId.lastName}</Link>
                <span className="muted block text-xs capitalize">{e.patientId.gender} · {age(e.patientId.dateOfBirth)} · {e.patientId.patientNumber}</span>
                {!!e.patientId.allergies?.length && <Badge tone="red">Allergies</Badge>}
              </Td>
              <Td><Link href={`/visits/${e.visitId._id}`} className="font-mono text-xs text-brand-600">{e.visitId.visitNumber}</Link><span className="muted block text-xs">{e.visitId.complaint}</span><span className="text-xs uppercase">{e.visitId.payer?.type}</span></Td>
              <Td><Badge tone={e.priority === 'emergency' ? 'red' : e.priority === 'urgent' ? 'amber' : 'gray'}>{e.priority}</Badge></Td>
              <Td><Badge tone={statusTone(e.status === 'in_service' ? 'active' : 'pending')}>{e.status.replace('_', ' ')}</Badge>{e.room && <span className="muted block text-xs">{e.room}</span>}</Td>
              <Td>{fmtDateTime(e.createdAt)}</Td>
              <Td className="whitespace-nowrap">
                {serve && e.status === 'waiting' && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: e._id, action: 'call' })}>Call</Button>}{' '}
                {serve && e.status !== 'in_service' && <Button size="sm" onClick={() => act.mutate({ id: e._id, action: 'start' })}>Start</Button>}{' '}
                {serve && e.status === 'in_service' && stage === 'triage' && <Button size="sm" onClick={() => setVitalsFor(e)}>Vitals</Button>}{' '}
                {serve && e.status === 'in_service' && WORKSPACE[stage] && <Link href={WORKSPACE[stage](e)}><Button size="sm">Open</Button></Link>}{' '}
                {serve && e.status !== 'waiting' && <Button size="sm" variant="secondary" onClick={() => setComplete(e)}>Complete</Button>}{' '}
                {serve && e.status !== 'in_service' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: e._id, action: 'skip' })}>Skip</Button>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!complete} onClose={() => setComplete(null)} title={`Complete ${complete?.ticket}`}>
        <div className="space-y-3">
          <Select value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="">No further stage</option>
            {STAGES.filter((s) => s !== stage).map((s) => <option key={s} value={s}>Send to {STAGE_LABEL[s]}</option>)}
          </Select>
          <Button onClick={() => act.mutate({ id: complete!._id, action: 'complete', nextStage: next })} loading={act.isPending}>Complete</Button>
        </div>
      </Modal>
      <Modal open={!!vitalsFor} onClose={() => setVitalsFor(null)} title={`Triage — ${vitalsFor?.patientId.firstName} ${vitalsFor?.patientId.lastName}`} wide>
        {vitalsFor && <VitalsForm visitId={vitalsFor.visitId._id} onSaved={() => { setVitalsFor(null); setComplete(vitalsFor); setNext('consultation'); }} />}
      </Modal>
    </>
  );
}
