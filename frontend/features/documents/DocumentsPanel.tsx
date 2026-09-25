'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, Trash2, Upload } from 'lucide-react';
import { api, apiRaw, downloadFile } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Loading, Modal, Select, Table, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

export interface DocumentRow { _id: string; title: string; category: string; fileName: string; mimeType: string; sizeBytes: number; uploadedByName?: string; createdAt: string }

export const DOCUMENT_CATEGORIES: Array<[string, string]> = [
  ['identification', 'Identification'],
  ['lab_report', 'Lab report'],
  ['radiology_report', 'Radiology report'],
  ['discharge_summary', 'Discharge summary'],
  ['consent', 'Consent'],
  ['insurance', 'Insurance'],
  ['sha', 'SHA'],
  ['dha', 'DHA'],
  ['referral', 'Referral'],
  ['other', 'Other'],
];
const label = (c: string) => DOCUMENT_CATEGORIES.find(([k]) => k === c)?.[1] ?? c;
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Upload / list / download documents for a patient and optionally a related record.
 * Files are type-checked by content on the server (PDF, PNG, JPEG, DICOM; 15 MB max) and every download is audited.
 */
export function DocumentsPanel({ relatedTo, patientId, category = 'other', title = 'Documents' }: { relatedTo?: { resource: string; id: string }; patientId?: string; category?: string; title?: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', category });
  const [file, setFile] = useState<File | null>(null);
  const [del, setDel] = useState<DocumentRow | null>(null);
  const [reason, setReason] = useState('');
  const key = ['documents', patientId, relatedTo?.resource, relatedTo?.id];
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await api<DocumentRow[]>('/documents', { query: { patientId, relatedResource: relatedTo?.resource, relatedId: relatedTo?.id } })).data,
  });
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('title', form.title);
      fd.set('category', form.category);
      if (patientId) fd.set('patientId', patientId);
      if (relatedTo) {
        fd.set('relatedResource', relatedTo.resource);
        fd.set('relatedId', relatedTo.id);
      }
      fd.set('file', file!);
      await apiRaw('/documents', { form: fd });
    },
    onSuccess: () => {
      setOpen(false);
      setFile(null);
      setForm({ title: '', category });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/documents/${del!._id}/delete`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      setDel(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  const [dlError, setDlError] = useState<unknown>(null);
  const get = (d: DocumentRow, openInline: boolean) => {
    setDlError(null);
    downloadFile(`/documents/${d._id}/download`, d.fileName, { query: openInline ? { inline: 'true' } : undefined, open: openInline }).catch(setDlError);
  };

  return (
    <Card title={title} actions={can('documents.upload') && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Upload className="h-4 w-4" /> Upload</Button>}>
      <ErrorText error={dlError} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorText error={list.error} /> : (list.data ?? []).length === 0 ? (
        <EmptyState title="No documents" icon={<FileText className="h-6 w-6" />}>Uploaded files appear here.</EmptyState>
      ) : (
        <Table head={['Title', 'Category', 'File', 'Uploaded', '']}>
          {list.data!.map((d) => (
            <tr key={d._id}>
              <Td className="font-medium">{d.title}</Td>
              <Td><Badge>{label(d.category)}</Badge></Td>
              <Td className="text-xs"><span className="block max-w-48 truncate">{d.fileName}</span><span className="muted">{size(d.sizeBytes)}</span></Td>
              <Td className="text-xs">{fmtDateTime(d.createdAt)}<span className="muted block">{d.uploadedByName}</span></Td>
              <Td className="whitespace-nowrap text-right">
                {d.mimeType !== 'application/dicom' && <Button size="sm" variant="ghost" title="View" onClick={() => get(d, true)}><Eye className="h-4 w-4" /></Button>}
                <Button size="sm" variant="ghost" title="Download" onClick={() => get(d, false)}><Download className="h-4 w-4" /></Button>
                {can('documents.upload') && <Button size="sm" variant="ghost" title="Remove" onClick={() => setDel(d)}><Trash2 className="h-4 w-4" /></Button>}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Upload document">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Chest X-ray report" /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {DOCUMENT_CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="File" hint="PDF, PNG, JPEG or DICOM, up to 15 MB">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.dcm,application/pdf,image/png,image/jpeg,application/dicom" className="field" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <ErrorText error={upload.error} />
          <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!file || form.title.trim().length < 2}>Upload</Button>
        </div>
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title={`Remove “${del?.title ?? ''}”`}>
        <div className="space-y-3">
          <p className="muted text-sm">Documents are part of the medical record. Removing hides the file from lists; the original is retained and the action is audited.</p>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Uploaded to the wrong patient" /></Field>
          <ErrorText error={remove.error} />
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending} disabled={reason.trim().length < 5}>Remove</Button>
        </div>
      </Modal>
    </Card>
  );
}
