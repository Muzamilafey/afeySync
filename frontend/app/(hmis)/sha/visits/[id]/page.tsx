'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, MessageSquare, Plus, Send } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';
import { humanize, pickStr, unwrapList } from '@/features/sha/hieDisplay';
import { InterventionBadges } from '@/features/sha/InterventionBadges';
import { VISIT_STATUS_LABEL, type ShaVisit } from '@/features/sha/shaVisitTypes';
import { DocumentsPanel, type DocumentRow } from '@/features/documents/DocumentsPanel';

const NOT_CONFIGURED = (e: unknown) => e instanceof ApiError && e.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED';
function StepError({ error }: { error: unknown }) {
  if (NOT_CONFIGURED(error)) return <Alert tone="amber">This SHA operation has not been configured yet by AfeySync platform administration (Owner → API Config, from the official HIE catalog).</Alert>;
  return <ErrorText error={error} />;
}

function Consent({ v, refresh }: { v: ShaVisit; refresh: () => void }) {
  const [method, setMethod] = useState<'otp' | 'biometric'>(v.eligibility?.facilityBiometricsEnforced && !v.eligibility?.whitelistedForOTP ? 'biometric' : 'otp');
  const [contact, setContact] = useState('');
  const [otp, setOtp] = useState('');
  const [device, setDevice] = useState({ deviceOs: 'windows', workStationId: '', agentId: '' });
  const [prac, setPrac] = useState({ practitionerIdentificationType: 'LICENCE', practitionerIdentificationNumber: '', practitionerRegulationBody: 'KMPDC', practitionerUserId: '' });
  const doctors = useQuery({ queryKey: ['sha-er-doctors'], queryFn: async () => (await api<Array<{ _id: string; name: string; registrationNumber: string | null; cadre?: string }>>('/sha/emergency/doctors')).data });
  const contacts = useQuery({ queryKey: ['sha-contacts', v._id], queryFn: async () => (await api<unknown>(`/sha/visits/${v._id}/contacts`)).data, enabled: method === 'otp' && !v.consent?.authorizedAt, retry: false });
  const send = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/otp`, { method: 'POST', body: contact ? { beneficiaryContactId: contact } : {} }) });
  const authorize = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/authorize`, { method: 'POST', body: method === 'otp' ? { method, otp } : { method, ...device, workStationId: device.workStationId || undefined, agentId: device.agentId || undefined } }), onSuccess: refresh });
  const start = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/start`, { method: 'POST', body: { ...prac, practitionerUserId: prac.practitionerUserId || undefined, otp: v.consent?.method === 'otp' && otp ? otp : undefined } }), onSuccess: refresh });
  const authorized = !!v.consent?.authorizedAt;
  const started = !!v.dha?.claimId;
  const contactList = unwrapList(contacts.data);
  if (started) return null;
  return (
    <Card title="1 · Patient consent & start visit">
      <div className="space-y-4">
        {!authorized && v.status !== 'biometric_pending' && (
          <>
            <div className="flex gap-2" role="radiogroup">
              <Button size="sm" variant={method === 'otp' ? 'primary' : 'outline'} onClick={() => setMethod('otp')} disabled={v.eligibility?.facilityBiometricsEnforced === true && v.eligibility?.whitelistedForOTP !== true}><MessageSquare className="h-4 w-4" /> OTP</Button>
              <Button size="sm" variant={method === 'biometric' ? 'primary' : 'outline'} onClick={() => setMethod('biometric')}><Fingerprint className="h-4 w-4" /> Biometrics (SHA eKYC)</Button>
            </div>
            {method === 'otp' ? (
              <div className="space-y-3">
                <Field label="Send the OTP to">
                  {contacts.isLoading ? <Loading /> : (
                    <Select value={contact} onChange={(e) => setContact(e.target.value)}>
                      <option value="">Default contact on SHA record</option>
                      {contactList.map((c, i) => { const id = pickStr(c, 'id', 'beneficiary_contact_id', 'contact_id') ?? String(i); return <option key={id} value={id}>{pickStr(c, 'phone', 'phone_number', 'contact', 'masked_phone') ?? id}</option>; })}
                    </Select>
                  )}
                </Field>
                <StepError error={contacts.error} />
                <p className="muted text-xs">Ask the patient to confirm which number to use. The OTP is never stored.</p>
                <Button size="sm" variant="secondary" onClick={() => send.mutate()} loading={send.isPending}><Send className="h-4 w-4" /> Send OTP</Button>
                {send.isSuccess && <Alert tone="green">OTP sent to the patient&apos;s phone.</Alert>}
                <StepError error={send.error} />
                <Field label="OTP"><Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={8} autoComplete="one-time-code" className="font-mono tracking-widest" /></Field>
                <Button onClick={() => authorize.mutate()} loading={authorize.isPending} disabled={otp.length < 4}>Verify & continue</Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Device OS"><Select value={device.deviceOs} onChange={(e) => setDevice({ ...device, deviceOs: e.target.value })}><option value="windows">Windows</option><option value="android">Android</option></Select></Field>
                <Field label="Workstation ID"><Input value={device.workStationId} onChange={(e) => setDevice({ ...device, workStationId: e.target.value })} /></Field>
                <Field label="Agent ID (optional)"><Input value={device.agentId} onChange={(e) => setDevice({ ...device, agentId: e.target.value })} /></Field>
                <div className="sm:col-span-3"><Button onClick={() => authorize.mutate()} loading={authorize.isPending}>Request SHA biometric verification</Button></div>
              </div>
            )}
            <StepError error={authorize.error} />
          </>
        )}
        {v.status === 'biometric_pending' && (
          <div className="space-y-3">
            <Alert tone="amber" title="Complete SHA biometric verification">The patient must complete verification in SHA&apos;s eKYC screen. AfeySync never marks biometrics as verified on its own.</Alert>
            {v.consent?.verificationUrl && /^https:\/\//.test(v.consent.verificationUrl) && <iframe title="SHA eKYC verification" src={v.consent.verificationUrl} className="h-[480px] w-full rounded-lg border border-[var(--border)]" sandbox="allow-scripts allow-same-origin allow-forms" allow="camera" referrerPolicy="no-referrer" />}
          </div>
        )}
        {(authorized || v.status === 'biometric_pending') && (
          <div className="space-y-3 border-t border-[var(--border)] pt-3">
            {authorized && <Alert tone="green">Consent obtained ({v.consent?.method}) · Auth code {v.consent?.authCode ?? '—'}{v.consent?.expiry ? ` · expires ${fmtDateTime(v.consent.expiry)}` : ''}</Alert>}
            <p className="text-sm font-medium">Attending practitioner</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Practitioner">
                <Select value={prac.practitionerUserId} onChange={(e) => { const d = doctors.data?.find((x) => x._id === e.target.value); setPrac({ ...prac, practitionerUserId: e.target.value, practitionerIdentificationNumber: d?.registrationNumber ?? prac.practitionerIdentificationNumber }); }}>
                  <option value="">Select…</option>
                  {doctors.data?.map((d) => <option key={d._id} value={d._id}>{d.name}{d.registrationNumber ? ` · ${d.registrationNumber}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Identification type"><Input value={prac.practitionerIdentificationType} onChange={(e) => setPrac({ ...prac, practitionerIdentificationType: e.target.value })} /></Field>
              <Field label="Identification number"><Input value={prac.practitionerIdentificationNumber} onChange={(e) => setPrac({ ...prac, practitionerIdentificationNumber: e.target.value })} /></Field>
              <Field label="Regulation body"><Input value={prac.practitionerRegulationBody} onChange={(e) => setPrac({ ...prac, practitionerRegulationBody: e.target.value })} placeholder="e.g. KMPDC, NCK, COC" /></Field>
            </div>
            {v.consent?.method === 'otp' && !otp && <p className="muted text-xs">For OTP consent, the visit is started with the OTP the patient just provided. If you left this page, send and verify a new OTP.</p>}
            <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!prac.practitionerIdentificationNumber}>Start SHA visit</Button>
            <StepError error={start.error} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Interventions({ v, refresh, editable }: { v: ShaVisit; refresh: () => void; editable: boolean }) {
  const [code, setCode] = useState('');
  const op = useMutation({ mutationFn: ({ o, c }: { o: string; c: string }) => api(`/sha/visits/${v._id}/interventions/${o}`, { method: 'POST', body: { interventionCode: c } }), onSuccess: () => { setCode(''); refresh(); } });
  return (
    <Card title="Interventions">
      <Table head={['Intervention', 'Flags (from SHA)', '']}>
        {v.interventions.map((i) => (
          <tr key={i.code}>
            <Td><span className="font-medium">{i.name ?? i.code}</span><span className="muted block font-mono text-xs">{i.code}</span></Td>
            <Td><InterventionBadges i={i} /></Td>
            <Td className="whitespace-nowrap text-right">{editable && (i.state === 'retired' ? <Button size="sm" variant="ghost" onClick={() => op.mutate({ o: 'restore', c: i.code })}>Restore</Button> : <Button size="sm" variant="ghost" onClick={() => op.mutate({ o: 'retire', c: i.code })}>Retire</Button>)}</Td>
          </tr>
        ))}
      </Table>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input className="w-48" placeholder="Intervention code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => op.mutate({ o: 'add', c: code })} disabled={code.length < 2}><Plus className="h-3.5 w-3.5" /> Add</Button>
          <Button size="sm" variant="ghost" onClick={() => op.mutate({ o: 'switch', c: code })} disabled={code.length < 2}>Switch to</Button>
        </div>
      )}
      <StepError error={op.error} />
    </Card>
  );
}

function Preauths({ v, refresh, docs }: { v: ShaVisit; refresh: () => void; docs: DocumentRow[] }) {
  const can = useCan();
  const needs = v.interventions.filter((i) => i.needsPreauth && i.state !== 'retired');
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ serviceStart: new Date().toISOString().slice(0, 10), serviceEnd: new Date().toISOString().slice(0, 10), item: '', qty: '1', price: '', dxCode: '', dxText: '', email: '' });
  const [docIds, setDocIds] = useState<string[]>([]);
  const [cancel, setCancel] = useState<{ code: string; reason: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api(`/sha/visits/${v._id}/preauths`, { method: 'POST', body: { interventionCode: open, serviceStart: f.serviceStart, serviceEnd: f.serviceEnd, items: [{ description: f.item, quantity: Number(f.qty), unitPrice: Number(f.price) }], diagnoses: [{ code: f.dxCode, description: f.dxText || undefined }], doctors: v.practitioner?.identificationNumber ? [{ identificationType: v.practitioner.identificationType, identificationNumber: v.practitioner.identificationNumber, regulationBody: v.practitioner.regulationBody, name: v.practitioner.name }] : [], documentIds: docIds, providerNotificationEmail: f.email || undefined } }),
    onSuccess: () => { setOpen(null); refresh(); },
  });
  const fetchStatus = useMutation({ mutationFn: (code: string) => api(`/sha/visits/${v._id}/preauths/${code}`), onSuccess: refresh });
  const doCancel = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/preauths/${cancel!.code}/cancel`, { method: 'POST', body: { reason: cancel!.reason } }), onSuccess: () => { setCancel(null); refresh(); } });
  if (!needs.length) return null;
  const req = needs.find((i) => i.code === open);
  return (
    <Card title="2 · Preauthorization (required by SHA)">
      <div className="space-y-3">
        {needs.map((i) => {
          const pa = v.preauths.find((p) => p.interventionCode === i.code && !p.cancelledAt);
          return (
            <div key={i.code} className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-medium">{i.name ?? i.code}</span> <span className="muted font-mono text-xs">{i.code}</span>{i.needsManualPreauthApproval && <Badge tone="amber" className="ml-2">Manual approval</Badge>}</div>
                <div className="flex gap-1">
                  {!pa && can('sha.preauthorization') && v.dha?.claimId && <Button size="sm" onClick={() => setOpen(i.code)}>Request preauthorization</Button>}
                  {pa && <Button size="sm" variant="ghost" onClick={() => fetchStatus.mutate(i.code)} loading={fetchStatus.isPending && fetchStatus.variables === i.code}>Refresh status</Button>}
                  {pa && can('sha.preauthorization') && <Button size="sm" variant="ghost" onClick={() => setCancel({ code: i.code, reason: '' })}>Cancel</Button>}
                </div>
              </div>
              {i.requiredPreauthDocumentTypes.length > 0 && <p className="muted mt-1 text-xs">Required documents: {i.requiredPreauthDocumentTypes.join(', ')}</p>}
              {pa && <div className="mt-2"><KV items={[['Status', <Badge key="s" tone={/approv/i.test(pa.status ?? '') ? 'green' : /reject|declin/i.test(pa.status ?? '') ? 'red' : 'amber'}>{pa.status ?? 'submitted'}</Badge>], ['Type', pa.preauthType], ['Estimated', money(pa.totalEstimated)], ['Interim approved', money(pa.interimApproved)], ['Final approved', money(pa.finalApproved)], ['Doctor review', pa.doctorReviewStatus]]} /></div>}
            </div>
          );
        })}
        {!v.dha?.claimId && <p className="muted text-sm">Start the visit before requesting preauthorization.</p>}
        <StepError error={fetchStatus.error} />
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Preauthorization — ${req?.name ?? open}`} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service start"><Input type="date" value={f.serviceStart} onChange={(e) => setF({ ...f, serviceStart: e.target.value })} /></Field>
          <Field label="Service end"><Input type="date" value={f.serviceEnd} onChange={(e) => setF({ ...f, serviceEnd: e.target.value })} /></Field>
          <Field label="Service / item" className="sm:col-span-2"><Input value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
          <Field label="Quantity"><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Estimated unit cost (KES)"><Input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Diagnosis code"><Input value={f.dxCode} onChange={(e) => setF({ ...f, dxCode: e.target.value })} placeholder="ICD-11" /></Field>
          <Field label="Diagnosis"><Input value={f.dxText} onChange={(e) => setF({ ...f, dxText: e.target.value })} /></Field>
          <Field label="Notification email (optional)" className="sm:col-span-2"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <p className="label">Attach documents {req?.requiredPreauthDocumentTypes.length ? `(required: ${req.requiredPreauthDocumentTypes.join(', ')})` : ''}</p>
            {docs.length === 0 ? <p className="muted text-sm">Upload documents in the Documents panel below first.</p> : docs.map((d) => <label key={d._id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={docIds.includes(d._id)} onChange={(e) => setDocIds(e.target.checked ? [...docIds, d._id] : docIds.filter((x) => x !== d._id))} /> {d.title} <span className="muted text-xs">({d.category})</span></label>)}
          </div>
          <div className="space-y-2 sm:col-span-2"><StepError error={create.error} /><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.item || !f.price || !f.dxCode}>Submit preauthorization</Button></div>
        </div>
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Cancel preauthorization">
        <div className="space-y-3">
          <Field label="Reason"><Textarea value={cancel?.reason ?? ''} onChange={(e) => setCancel(cancel && { ...cancel, reason: e.target.value })} /></Field>
          <StepError error={doCancel.error} />
          <Button variant="danger" onClick={() => doCancel.mutate()} loading={doCancel.isPending} disabled={(cancel?.reason.length ?? 0) < 5}>Cancel preauthorization</Button>
        </div>
      </Modal>
    </Card>
  );
}

function ClaimSteps({ v, refresh, docs }: { v: ShaVisit; refresh: () => void; docs: DocumentRow[] }) {
  const can = useCan();
  const [doc, setDoc] = useState({ documentId: '', documentType: '' });
  const claims = useQuery({ queryKey: ['sha-tx-patient', v.patientId._id], queryFn: async () => (await api<Array<{ _id: string; reference: string; kind: string; status: string; patientId: { _id: string } }>>('/sha/transactions', { query: { kind: 'claim', patientId: v.patientId._id, limit: 50 } })).data });
  const link = useMutation({ mutationFn: (transactionId: string) => api(`/sha/visits/${v._id}/link-claim`, { method: 'POST', body: { transactionId } }), onSuccess: refresh });
  const step = useMutation({ mutationFn: ({ s, body }: { s: string; body?: unknown }) => api<{ response: unknown }>(`/sha/visits/${v._id}/claim-steps/${s}`, { method: 'POST', body: body ?? {} }), onSuccess: refresh });
  const done = (s: string) => v.claimSteps.some((c) => c.step === s && c.ok);
  const ip = v.serviceType === 'INPATIENT';
  const patientClaims = (claims.data ?? []).filter((c) => c.patientId?._id === v.patientId._id);
  if (!v.dha?.claimId || !can('sha.claim')) return null;
  const Row = ({ s, label, children }: { s: string; label: string; children?: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2 last:border-0">
      <span className="text-sm">{done(s) ? '✓ ' : ''}{label}</span>
      <span className="flex items-center gap-2">{children ?? <Button size="sm" variant={done(s) ? 'ghost' : 'secondary'} loading={step.isPending && step.variables?.s === s} onClick={() => step.mutate({ s })}>{done(s) ? 'Send again' : 'Send'}</Button>}</span>
    </div>
  );
  return (
    <Card title="3 · Claim">
      {!v.claimTransactionId ? (
        <div className="space-y-2 text-sm">
          <p>Link the AfeySync claim built from this patient&apos;s SHA invoice (Billing → invoice → SHA claim). Its diagnoses and billable items are sent to the virtual claim.</p>
          {patientClaims.length === 0 ? <p className="muted">No claims for this patient yet.</p> : patientClaims.map((c) => <div key={c._id} className="flex items-center justify-between"><span className="font-mono text-xs">{c.reference} · {c.status}</span><Button size="sm" variant="secondary" onClick={() => link.mutate(c._id)}>Link</Button></div>)}
          <StepError error={link.error} />
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm">Linked claim: <Link className="text-brand-600" href={`/sha/transactions/${v.claimTransactionId}`}>open</Link> · DHA claim <span className="font-mono">{String(v.dha.claimId)}</span></p>
          <Row s="diagnoses" label="Record diagnoses" />
          <Row s="billable-items" label="Record billable items" />
          <Row s="attachments" label="Upload supporting document">
            <Select value={doc.documentId} onChange={(e) => setDoc({ ...doc, documentId: e.target.value })} className="w-44"><option value="">Document…</option>{docs.map((d) => <option key={d._id} value={d._id}>{d.title}</option>)}</Select>
            <Input className="w-40" placeholder="Document type" value={doc.documentType} onChange={(e) => setDoc({ ...doc, documentType: e.target.value })} />
            <Button size="sm" variant="secondary" disabled={!doc.documentId || doc.documentType.length < 2} onClick={() => step.mutate({ s: 'attachments', body: doc })}>Upload</Button>
          </Row>
          <Row s="preview" label="Preview claim" />
          {ip ? <Row s="discharge" label="Discharge patient (dispatches the inpatient claim)" /> : <Row s="submit" label="Submit claim" />}
          <Row s="close" label="Close claim" />
        </div>
      )}
      <div className="mt-2"><StepError error={step.error} /></div>
      {step.data?.data?.response !== undefined && <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs">{JSON.stringify(step.data.data.response, null, 2)}</pre>}
    </Card>
  );
}

function Pomsf({ v, refresh }: { v: ShaVisit; refresh: () => void }) {
  const [f, setF] = useState({ policyNumber: v.eligibility?.pomsf?.policyNumber ?? '', principalCrId: v.eligibility?.pomsf?.principalCrId ?? '' });
  const m = useMutation({ mutationFn: () => api(`/sha/visits/${v._id}/effective-coverage`, { method: 'POST', body: f }), onSuccess: refresh });
  if (!v.eligibility?.pomsf || !v.consent?.authorizedAt) return null;
  return (
    <Card title="POMSF effective coverage">
      <p className="muted mb-2 text-xs">The principal member&apos;s CR ID can differ from the patient&apos;s ({v.patientCrId}).</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input value={f.policyNumber} onChange={(e) => setF({ ...f, policyNumber: e.target.value })} placeholder="Policy number" />
        <Input value={f.principalCrId} onChange={(e) => setF({ ...f, principalCrId: e.target.value })} placeholder="Principal CR ID" />
        <Button size="sm" onClick={() => m.mutate()} loading={m.isPending}>Check</Button>
      </div>
      <StepError error={m.error} />
      {v.effectiveCoverage?.response != null && <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs">{JSON.stringify(v.effectiveCoverage.response, null, 2)}</pre>}
    </Card>
  );
}

export default function ShaVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sha-visit', id], queryFn: async () => (await api<ShaVisit>(`/sha/visits/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sha-visit', id] });
  const docs = useQuery({ queryKey: ['documents', q.data?.patientId._id], queryFn: async () => (await api<DocumentRow[]>('/documents', { query: { patientId: q.data!.patientId._id } })).data, enabled: !!q.data });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const v = q.data;
  const open = !['closed', 'cancelled'].includes(v.status);
  return (
    <>
      <PageHeader
        title={`SHA visit ${v.reference}`}
        crumbs={['SHA', 'Visits', v.reference]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={v.status === 'closed' ? 'gray' : v.status.includes('pending') ? 'amber' : 'blue'}>{VISIT_STATUS_LABEL[v.status] ?? v.status}</Badge><Badge>{v.serviceType}</Badge>{v.dha?.claimId && <span className="font-mono text-xs">DHA claim {String(v.dha.claimId)}</span>}</span>}
      />
      {v.decision && <ol className="mb-4 flex flex-wrap gap-2 text-xs">{v.decision.steps.map((s, i) => <li key={s}><Badge tone={/preauth/.test(s) ? 'amber' : 'gray'}>{i + 1}. {humanize(s)}</Badge></li>)}</ol>}
      {v.lastDhaError && <div className="mb-4"><Alert tone="red" title="Last SHA error">{v.lastDhaError}</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {open && <Consent v={v} refresh={refresh} />}
          <Preauths v={v} refresh={refresh} docs={docs.data ?? []} />
          <ClaimSteps v={v} refresh={refresh} docs={docs.data ?? []} />
          <Interventions v={v} refresh={refresh} editable={open && !!v.dha?.claimId} />
          <Pomsf v={v} refresh={refresh} />
          <DocumentsPanel title="Supporting documents" patientId={v.patientId._id} category="sha" />
        </div>
        <div className="space-y-5">
          <Card title="Patient">
            <KV items={[['Name', <Link key="p" className="text-brand-600" href={`/patients/${v.patientId._id}`}>{v.patientId.firstName} {v.patientId.lastName}</Link>], ['Patient no.', v.patientId.patientNumber], ['CR ID', v.patientCrId]]} />
          </Card>
          {v.dha?.claimId && (
            <Card title="DHA identifiers">
              <KV items={Object.entries(v.dha).filter(([, x]) => x !== undefined && x !== null && x !== '').map(([k, x]) => [humanize(k), typeof x === 'number' ? money(x) : String(x)])} />
            </Card>
          )}
          <Card title="History">
            <ol className="space-y-2 text-sm">{[...v.history].reverse().map((h, i) => <li key={i} className="border-l-2 border-[var(--border)] pl-3"><span className="font-medium">{humanize(h.action)}</span> <span className="muted text-xs">{fmtDateTime(h.at)} · {h.byName}</span>{h.note && <p className="text-xs">{h.note}</p>}</li>)}</ol>
          </Card>
          <Card title="SHA exchange trail">
            <p className="muted mb-2 text-xs">Kept for audit and reconciliation. Tokens and OTPs are redacted.</p>
            <ul className="space-y-1 text-xs">{[...(v.responses ?? [])].reverse().slice(0, 15).map((r, i) => <li key={i}><details><summary className="cursor-pointer"><Badge tone={r.ok ? 'green' : 'red'}>{r.code}</Badge> {r.operation} <span className="muted">{fmtDateTime(r.at)}</span></summary><pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--surface-2)] p-2">{JSON.stringify(r.data, null, 2)}</pre></details></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
