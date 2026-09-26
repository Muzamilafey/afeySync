'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Loading, Modal, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import type { DocumentRow } from '@/features/documents/DocumentsPanel';

interface WhitelistRow { _id: string; guid?: string; reasonType?: string; reason?: string; biometricAttempts?: number; status?: string; reviewerNotes?: string[]; reviewedBy?: string; requestedByName?: string; createdAt: string; lastSyncedAt?: string }

/** Reason types from the OTP Whitelist reference; OTHER covers anything else (explain in the reason). */
export const REASON_TYPES: Array<[string, string]> = [
  ['BIOMETRIC_FAILURE', 'Fingerprints repeatedly fail to capture or match'],
  ['CHILD_BELOW_7_YEARS', 'Child below 7 years'],
  ['AMPUTEE', 'Amputee'],
  ['OLD', 'Elderly (worn fingerprints)'],
  ['MEDICAL_CONDITION', 'Medical condition affecting the fingers'],
  ['MENTALLY_UNSTABLE', 'Mentally unstable'],
  ['EXPIRED', 'Expired'],
  ['OTHER', 'Other (explain below)'],
];
const DOC_TYPES = ['MEDICAL_REPORT', 'BIRTH_CERTIFICATE', 'NATIONAL_ID', 'REFERRAL_LETTER', 'OTHER'];

/** Ask SHA to let a beneficiary consent by OTP, with supporting documents; SHA's review is synced back. */
export function OtpWhitelistPanel({ patientId }: { patientId: string }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['sha-otp-whitelists', patientId], queryFn: async () => (await api<WhitelistRow[]>('/sha/otp-whitelists', { query: { patientId } })).data, retry: false });
  return (
    <Card title="OTP whitelist requests" actions={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}><RefreshCw className="h-3.5 w-3.5" /> Refresh from SHA</Button>{can('sha.authorization') && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New request</Button>}</div>}>
      <p className="muted mb-3 text-sm">Where SHA requires fingerprints, a beneficiary who cannot use them (for example a child whose finger never matches, an amputee or an elderly patient) can be allowed to consent by OTP once SHA approves.</p>
      {list.isLoading ? <Loading /> : list.error ? <ErrorText error={list.error} /> : (
        <Table head={['Requested', 'Reason', 'Status', 'SHA review']} empty={(list.data ?? []).length === 0}>
          {list.data?.map((r) => (
            <tr key={r._id}>
              <Td className="text-xs">{fmtDateTime(r.createdAt)}<span className="muted block">{r.requestedByName}</span></Td>
              <Td><span className="font-medium">{REASON_TYPES.find(([k]) => k === r.reasonType)?.[1] ?? r.reasonType}</span><span className="muted block text-xs">{r.reason}{r.biometricAttempts ? ` · ${r.biometricAttempts} fingerprint attempts` : ''}</span></Td>
              <Td><Badge tone={/approv/i.test(r.status ?? '') ? 'green' : /reject|declin/i.test(r.status ?? '') ? 'red' : 'amber'}>{(r.status ?? 'pending').toLowerCase()}</Badge></Td>
              <Td className="text-xs">{r.reviewerNotes?.join(' · ') || '—'}{r.reviewedBy ? <span className="muted block">{r.reviewedBy}</span> : null}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="muted mt-2 text-xs">After SHA approves, check eligibility again so the approval shows on the patient (whitelisted for OTP).</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Request OTP whitelisting" wide>{open && <NewRequest patientId={patientId} onDone={() => { setOpen(false); list.refetch(); }} />}</Modal>
    </Card>
  );
}

function NewRequest({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [f, setF] = useState({ reasonType: 'BIOMETRIC_FAILURE', reason: '', attempts: '' });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const docs = useQuery({ queryKey: ['patient-docs', patientId], queryFn: async () => (await api<DocumentRow[]>('/documents', { query: { patientId } })).data });
  const m = useMutation({
    mutationFn: () => api('/sha/otp-whitelists', { method: 'POST', body: { patientId, reasonType: f.reasonType, reason: f.reason, biometricAttempts: f.attempts ? Number(f.attempts) : undefined, attachments: Object.entries(picked).map(([documentId, documentType]) => ({ documentId, documentType })) } }),
    onSuccess: onDone,
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason"><Select value={f.reasonType} onChange={(e) => setF({ ...f, reasonType: e.target.value })}>{REASON_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Fingerprint attempts already made"><Input type="number" min={0} value={f.attempts} onChange={(e) => setF({ ...f, attempts: e.target.value })} /></Field>
      </div>
      <Field label="Explain" hint="At least 10 characters. SHA reviews this."><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. The child's fingerprint did not match after 4 attempts on two days; enrolled fingers are worn from eczema." /></Field>
      <div>
        <p className="mb-1 text-sm font-medium">Supporting documents (up to 5)</p>
        {docs.isLoading ? <Loading /> : (docs.data ?? []).length === 0 ? <p className="muted text-sm">No documents on this patient yet. Upload one on the Documents tab (for example a clinician&apos;s note or birth certificate).</p> : (
          <div className="space-y-1.5">
            {docs.data!.map((d) => (
              <label key={d._id} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="checkbox" checked={d._id in picked} disabled={!(d._id in picked) && Object.keys(picked).length >= 5} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[d._id] = 'MEDICAL_REPORT'; else delete n[d._id]; return n; })} />
                <span className="min-w-0 flex-1 truncate">{d.title} <span className="muted text-xs">{d.fileName}</span></span>
                {d._id in picked && <Select className="w-48" value={picked[d._id]} onChange={(e) => setPicked({ ...picked, [d._id]: e.target.value })}>{DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</Select>}
              </label>
            ))}
          </div>
        )}
      </div>
      <Alert tone="blue">For a child who cannot match, SHA grants OTP access so a guardian can receive the code. Device or workstation errors are not failed matches: fix HealthID first.</Alert>
      <ErrorText error={m.error} />
      <Button onClick={() => m.mutate()} loading={m.isPending} disabled={f.reason.trim().length < 10}>Send request to SHA</Button>
    </div>
  );
}
