'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link2, Search, UserPlus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Table, Td, Tabs, statusTone, Alert } from '@/components/ui';
import { RegisterFindPatient } from '@/features/patients/RegisterFindPatient';
import { EligibilityChecker } from '@/features/sha/EligibilityChecker';
import { fmtDate, fullName } from '@/lib/utils';
import type { Patient } from '@/types/api';

function LinkBranch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pn, setPn] = useState('');
  const [idv, setIdv] = useState('');
  const router = useRouter();
  const m = useMutation({
    mutationFn: async () => (await api<{ id: string }>('/patients/link-branch', { method: 'POST', body: { patientNumber: pn.trim(), identifierValue: idv.trim() } })).data,
    onSuccess: (d) => router.push(`/patients/${d.id}`),
  });
  return (
    <Modal open={open} onClose={onClose} title="Link patient from another branch">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="muted text-sm">Enter the AfeySync patient number and one identifier (National ID, CR ID, SHA no. or phone) exactly as recorded. This action is audited.</p>
        <Field label="Patient number"><Input value={pn} onChange={(e) => setPn(e.target.value)} placeholder="AFS-0000123" /></Field>
        <Field label="Matching identifier"><Input value={idv} onChange={(e) => setIdv(e.target.value)} /></Field>
        <ErrorText error={m.error} />
        <Button type="submit" loading={m.isPending}>Link to my branch</Button>
      </form>
    </Modal>
  );
}

function LocalSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [link, setLink] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const search = useQuery({ queryKey: ['patient-search-page', term], queryFn: async () => (await api<Patient[]>('/patients/search', { query: { q: term, limit: 50 } })).data, enabled: term.length >= 2 });
  const recent = useQuery({ queryKey: ['patients-recent'], queryFn: async () => (await api<Patient[]>('/patients', { query: { limit: 20 } })).data, enabled: term.length < 2 && can('patients.view') });
  const rows = term.length >= 2 ? search.data : recent.data;

  return (
    <Card
      title={term.length >= 2 ? `Results for “${term}”` : 'Recently registered'}
      actions={can('patients.create') && <Button size="sm" variant="outline" onClick={() => setLink(true)}><Link2 className="h-3 w-3" /> Link from another branch</Button>}
    >
      <div className="relative mb-4">
        <Search className="muted absolute top-2.5 left-3 h-4 w-4" />
        <Input autoFocus className="pl-9 text-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / Phone / National ID / CR ID / AFS Number / SHA / Insurance" aria-label="Search patients" />
      </div>
      {(search.isFetching || recent.isLoading) && !rows && <Loading />}
      {search.error && <ErrorText error={search.error} />}
      {rows && (
        <Table head={['Name', 'DOB', 'ID', 'CR ID', 'SHA Status', 'AfeySync No.', 'Branch', '']} empty={rows.length === 0}>
          {rows.map((p) => (
            <tr key={p._id} className="cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => router.push(`/patients/${p._id}`)}>
              <Td className="font-medium">{fullName(p)}<span className="muted block text-xs capitalize">{p.gender} {p.phone && `· ${p.phone}`}</span></Td>
              <Td>{fmtDate(p.dateOfBirth)}</Td>
              <Td>{p.nationalId ?? '—'}</Td>
              <Td className="font-mono text-xs">{p.clientRegistryId ?? '—'}</Td>
              <Td><Badge tone={statusTone(p.sha?.status)}>{(p.sha?.status ?? 'unknown').replace('_', ' ')}</Badge></Td>
              <Td className="font-mono text-xs">{p.patientNumber}</Td>
              <Td>{p.registeredBranchName ?? '—'}</Td>
              <Td><Link href={`/patients/${p._id}`} className="text-sm font-medium text-brand-600" onClick={(e) => e.stopPropagation()}>Open</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <LinkBranch open={link} onClose={() => setLink(false)} />
    </Card>
  );
}

function PatientsInner() {
  const can = useCan();
  const [tab, setTab] = useState<'local' | 'dha' | 'sha'>('local');
  return (
    <>
      <PageHeader
        title="Patients"
        crumbs={['Patients']}
        actions={can('patients.create') && <Link href="/frontdesk"><Button><UserPlus className="h-4 w-4" /> Register patient</Button></Link>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'local', label: 'Local (AfeySync)' }, { key: 'dha', label: 'DHA Client Registry' }, { key: 'sha', label: 'SHA Eligibility' }]} />
      {tab === 'local' && <LocalSearch />}
      {tab === 'dha' && (can('dha.registry') ? <RegisterFindPatient /> : <Alert tone="amber">You do not have permission to search the DHA registry.</Alert>)}
      {tab === 'sha' && (can('sha.eligibility') ? <EligibilityChecker /> : <Alert tone="amber">You do not have permission to check SHA eligibility.</Alert>)}
    </>
  );
}

export default function PatientsPage() {
  return (
    <Suspense>
      <PatientsInner />
    </Suspense>
  );
}
