'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import type { Patient } from '@/types/api';
import type { BirthNotification } from '@/features/maternity/types';
import { Printer } from 'lucide-react';

interface Preg { _id: string; ancNumber: string; edd?: string; gravida: number; para: number; riskLevel: string; riskFactors: string[]; status: string; gestation?: { weeks: number; days: number } | null; patientId: { _id: string; firstName: string; lastName: string; patientNumber: string; phone?: string } }
const RISK_TONE: Record<string, 'green' | 'amber' | 'red'> = { low: 'green', moderate: 'amber', high: 'red' };

export default function MaternityPage() {
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<'active' | 'in_labour' | 'delivered' | 'births'>('active');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [f, setF] = useState({ lmp: '', gravida: '1', para: '0', riskFactors: '', bloodGroup: '', hivStatus: '' });
  const q = useQuery({ queryKey: ['pregnancies', tab], enabled: tab !== 'births', queryFn: async () => (await api<Preg[]>('/maternity/pregnancies', { query: { status: tab, limit: 200 } })).data });
  const births = useQuery({ queryKey: ['birth-notifications', 'register', search], enabled: tab === 'births', queryFn: async () => (await api<BirthNotification[]>('/maternity/birth-notifications', { query: { q: search || undefined, limit: 200 } })).data });
  const create = useMutation({
    mutationFn: async () => (await api<Preg>('/maternity/pregnancies', { method: 'POST', body: { patientId: patient!._id, lmp: f.lmp || undefined, gravida: Number(f.gravida), para: Number(f.para), riskFactors: f.riskFactors ? f.riskFactors.split(',').map((s) => s.trim()).filter(Boolean) : [], bloodGroup: f.bloodGroup || undefined, hivStatus: f.hivStatus || undefined } })).data,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['pregnancies'] }); setOpen(false); router.push(`/maternity/${p._id}`); },
  });
  return (
    <>
      <PageHeader title="Maternity" crumbs={['Maternity']} actions={can('maternity.manage') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Register pregnancy (ANC)</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'active', label: 'Antenatal' }, { key: 'in_labour', label: 'In labour' }, { key: 'delivered', label: 'Delivered' }, { key: 'births', label: 'Birth notifications' }]} />
      {tab === 'births' ? (
        <Card>
          <Input className="mb-3 max-w-sm" placeholder="Search child, mother, BN or Form B1 no." value={search} onChange={(e) => setSearch(e.target.value)} />
          {births.isLoading && <Loading />}
          <ErrorText error={births.error} />
          <Table head={['Notification', 'Child', 'Born', 'Sex / nature', 'Mother', 'Issued to', 'Printed', '']} empty={(births.data ?? []).length === 0}>
            {births.data?.map((b) => (
              <tr key={b._id}>
                <Td className="font-mono text-xs">{b.notificationNumber}{b.crsSerialNumber && <span className="muted block">B1 {b.crsSerialNumber}</span>}</Td>
                <Td className="font-medium">{[b.child.firstName, b.child.otherName, b.child.fatherName].filter(Boolean).join(' ')}</Td>
                <Td>{fmtDateTime(b.dateOfBirth)}</Td>
                <Td className="capitalize">{b.sex} · <Badge tone={b.natureOfBirth === 'born_alive' ? 'green' : 'gray'}>{b.natureOfBirth.replace('_', ' ')}</Badge></Td>
                <Td>{[b.mother.firstName, b.mother.lastName].filter(Boolean).join(' ')}</Td>
                <Td className="capitalize">{b.issuedTo.relationship}{b.issuedTo.name ? ` · ${b.issuedTo.name}` : ''}</Td>
                <Td>{b.printCount ? `${b.printCount}×` : <Badge tone="amber">not printed</Badge>}</Td>
                <Td><Link href={`/print/birth-notification/${b._id}`} target="_blank"><Button size="sm" variant="outline"><Printer className="h-4 w-4" /> Print</Button></Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
      <Card>
        {q.isLoading && <Loading />}
        <Table head={['Mother', 'ANC no.', 'Gestation', 'EDD', 'G/P', 'Risk', '']} empty={(q.data ?? []).length === 0}>
          {q.data?.map((p) => (
            <tr key={p._id}>
              <Td className="font-medium">{p.patientId.firstName} {p.patientId.lastName}<span className="muted block text-xs">{p.patientId.patientNumber} · {p.patientId.phone}</span></Td>
              <Td className="font-mono text-xs">{p.ancNumber}</Td>
              <Td>{p.gestation ? `${p.gestation.weeks}w ${p.gestation.days}d` : '—'}</Td>
              <Td>{fmtDate(p.edd)}</Td>
              <Td>G{p.gravida} P{p.para}</Td>
              <Td><Badge tone={RISK_TONE[p.riskLevel]}>{p.riskLevel}</Badge>{p.riskFactors.length > 0 && <span className="muted block text-xs">{p.riskFactors.slice(0, 2).join('; ')}</span>}</Td>
              <Td><Link href={`/maternity/${p._id}`} className="text-sm font-medium text-brand-600">Open</Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Register pregnancy" wide>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mother" className="col-span-full"><PatientPicker value={patient} onChange={setPatient} /></Field>
          <Field label="LMP"><Input type="date" value={f.lmp} onChange={(e) => setF({ ...f, lmp: e.target.value })} /></Field>
          <Field label="Gravida"><Input type="number" min={1} value={f.gravida} onChange={(e) => setF({ ...f, gravida: e.target.value })} /></Field>
          <Field label="Para"><Input type="number" min={0} value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })} /></Field>
          <Field label="Blood group"><Select value={f.bloodGroup} onChange={(e) => setF({ ...f, bloodGroup: e.target.value })}><option value="">Unknown</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}</Select></Field>
          <Field label="HIV status"><Select value={f.hivStatus} onChange={(e) => setF({ ...f, hivStatus: e.target.value })}><option value="">Unknown</option><option>Negative</option><option>Positive</option></Select></Field>
          <Field label="Known risk factors (comma separated)" className="col-span-full"><Input value={f.riskFactors} onChange={(e) => setF({ ...f, riskFactors: e.target.value })} placeholder="e.g. Chronic hypertension, Twin pregnancy" /></Field>
          <div className="col-span-full space-y-2"><ErrorText error={create.error} /><Button onClick={() => create.mutate()} disabled={!patient} loading={create.isPending}>Register</Button><p className="muted text-xs">EDD is calculated from the LMP (Naegele’s rule). Risk is assessed from age, parity, history and risk factors.</p></div>
        </div>
      </Modal>
    </>
  );
}
