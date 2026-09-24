'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Stat, statusTone, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import type { Patient } from '@/types/api';

interface Tx {
  _id: string;
  kind: string;
  reference: string;
  status: string;
  patientId: { _id: string; patientNumber: string; firstName: string; lastName: string; clientRegistryId?: string };
  amounts?: { claimed?: number; approved?: number; paid?: number };
  lines?: Array<{ serviceCode: string; description: string; quantity: number; unitPrice: number; amount: number }>;
  diagnoses?: Array<{ code: string; display?: string }>;
  interventionCode?: string;
  benefitCode?: string;
  accessPoint?: string;
  clinicalJustification?: string;
  statusHistory?: Array<{ status: string; at: string; source: string; note?: string }>;
  updatedAt: string;
}

const KINDS = [
  { key: 'claim', label: 'Claim', perm: 'sha.claim' },
  { key: 'preauthorization', label: 'Preauthorization', perm: 'sha.preauthorization' },
  { key: 'authorization', label: 'Authorization', perm: 'sha.authorization' },
  { key: 'visit_consent', label: 'Visit consent', perm: 'sha.authorization' },
  { key: 'emergency_claim', label: 'Emergency claim', perm: 'sha.claim' },
];

function NewDraft({ open, onClose }: { open: boolean; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const [kind, setKind] = useState('claim');
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [intervention, setIntervention] = useState('');
  const [accessPoint, setAccessPoint] = useState('OP');
  const [dx, setDx] = useState('');
  const [justification, setJustification] = useState('');
  const [lines, setLines] = useState([{ serviceCode: '', description: '', quantity: 1, unitPrice: 0 }]);
  const [key] = useState(() => crypto.randomUUID());
  const search = useQuery({ queryKey: ['tx-patient', q], queryFn: async () => (await api<Patient[]>('/patients/search', { query: { q, limit: 5 } })).data, enabled: q.length >= 2 && !patient });
  const m = useMutation({
    mutationFn: () =>
      api('/sha/transactions', {
        method: 'POST',
        body: {
          kind,
          patientId: patient!._id,
          interventionCode: intervention || undefined,
          accessPoint,
          diagnoses: dx ? dx.split(',').map((c) => ({ code: c.trim() })) : [],
          clinicalJustification: justification || undefined,
          lines: lines.filter((l) => l.serviceCode && l.description),
          idempotencyKey: key,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sha-tx'] });
      onClose();
    },
  });
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  return (
    <Modal open={open} onClose={onClose} title="New SHA draft" wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.filter((k) => can(k.perm)).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></Field>
          <Field label="Intervention"><Input value={intervention} onChange={(e) => setIntervention(e.target.value)} placeholder="SHA-XX-XXX" /></Field>
          <Field label="Access point"><Select value={accessPoint} onChange={(e) => setAccessPoint(e.target.value)}><option>OP</option><option>IP</option></Select></Field>
        </div>
        <Field label="Patient">
          {patient ? <p className="text-sm font-medium">{patient.firstName} {patient.lastName} · {patient.patientNumber} {patient.clientRegistryId && `· ${patient.clientRegistryId}`} <button className="ml-2 text-xs text-brand-600" onClick={() => setPatient(null)}>change</button></p> : <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient" />}
        </Field>
        {!patient && search.data?.map((p) => <button key={p._id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => setPatient(p)}>{p.firstName} {p.lastName} · {p.patientNumber}</button>)}
        <Field label="Diagnosis codes (comma separated)"><Input value={dx} onChange={(e) => setDx(e.target.value)} /></Field>
        <Field label="Clinical justification"><Textarea value={justification} onChange={(e) => setJustification(e.target.value)} /></Field>
        <div>
          <p className="label">Requested services</p>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[110px_1fr_70px_110px_auto] gap-2">
              <Input placeholder="Code" value={l.serviceCode} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, serviceCode: e.target.value } : x)))} />
              <Input placeholder="Service" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Input type="number" min={0} value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) } : x)))} />
              <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, { serviceCode: '', description: '', quantity: 1, unitPrice: 0 }])}><Plus className="h-3 w-3" /> Add service</Button>
            <span className="text-sm font-semibold">Total {money(total)}</span>
          </div>
        </div>
        <Alert tone="blue">Drafts are saved in AfeySync. Submission to SHA uses the HIE operation configured by the platform owner from the current official API catalog; status updates arrive via verified callbacks.</Alert>
        <ErrorText error={m.error} />
        <Button onClick={() => m.mutate()} disabled={!patient} loading={m.isPending}>SAVE DRAFT</Button>
      </div>
    </Modal>
  );
}

export default function ClaimsPage() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('claim');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['sha-tx', kind, status, q], queryFn: () => api<Tx[]>('/sha/transactions', { query: { kind, status, q } }) });
  const tx = useQuery({ queryKey: ['sha-tx-detail', detail], queryFn: async () => (await api<Tx>(`/sha/transactions/${detail}`)).data, enabled: !!detail });
  const counts = (list.data?.meta?.counts ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader title="SHA Claims" crumbs={['SHA', 'Claims']} actions={(can('sha.claim') || can('sha.preauthorization') || can('sha.authorization')) && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New draft</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['draft', 'Draft'], ['submitted', 'Submitted'], ['pending', 'Pending'], ['intervention_required', 'Intervention'], ['approved', 'Approved']].map(([k, l]) => (
          <button key={k} onClick={() => setStatus(status === k ? '' : k)} className="text-left">
            <Stat label={l} value={counts[k] ?? 0} tone={statusTone(k)} />
          </button>
        ))}
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select className="max-w-48" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>
          <Input className="max-w-60" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Claim reference" />
          {status && <Badge tone={statusTone(status)}>Status: {status} <button onClick={() => setStatus('')}>×</button></Badge>}
        </div>
        {list.isLoading && <Loading />}
        <ErrorText error={list.error} />
        {list.data && (
          <Table head={['Ref', 'Patient', 'Intervention', 'Amount', 'Status', 'Updated', '']} empty={list.data.data.length === 0}>
            {list.data.data.map((t) => (
              <tr key={t._id}>
                <Td className="font-mono text-xs">{t.reference}</Td>
                <Td><Link href={`/patients/${t.patientId?._id}`} className="hover:underline">{t.patientId?.firstName} {t.patientId?.lastName}</Link><span className="muted block text-xs">{t.patientId?.patientNumber}</span></Td>
                <Td>{t.interventionCode ?? '—'}</Td>
                <Td>{money(t.amounts?.claimed)}</Td>
                <Td><Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge></Td>
                <Td>{fmtDateTime(t.updatedAt)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setDetail(t._id)}>View</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewDraft open={open} onClose={() => setOpen(false)} />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={tx.data ? `${tx.data.kind.replace('_', ' ').toUpperCase()} ${tx.data.reference}` : 'Loading'} wide>
        {tx.data && (
          <div className="space-y-4">
            <KV items={[['Patient', `${tx.data.patientId.firstName} ${tx.data.patientId.lastName}`], ['CR ID', tx.data.patientId.clientRegistryId], ['Intervention', tx.data.interventionCode], ['Access point', tx.data.accessPoint], ['Status', <Badge key="s" tone={statusTone(tx.data.status)}>{tx.data.status}</Badge>], ['Diagnoses', tx.data.diagnoses?.map((d) => d.code).join(', ')]]} />
            <Table head={['Service', 'Qty', 'Unit', 'Amount']}>
              {tx.data.lines?.map((l, i) => <tr key={i}><Td>{l.serviceCode} {l.description}</Td><Td>{l.quantity}</Td><Td>{money(l.unitPrice)}</Td><Td>{money(l.amount)}</Td></tr>)}
            </Table>
            <KV items={[['Claimed', money(tx.data.amounts?.claimed)], ['Approved', money(tx.data.amounts?.approved)], ['Paid', money(tx.data.amounts?.paid)], ['Outstanding', money((tx.data.amounts?.approved ?? 0) - (tx.data.amounts?.paid ?? 0))]]} />
            <div>
              <p className="label">Status history</p>
              <ul className="text-sm">{tx.data.statusHistory?.map((s, i) => <li key={i}>{fmtDateTime(s.at)} — <strong>{s.status}</strong> <span className="muted">({s.source}{s.note ? `: ${s.note}` : ''})</span></li>)}</ul>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
