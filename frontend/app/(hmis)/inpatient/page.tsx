'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Button, Card, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Td } from '@/components/ui';
import { age, fmtDateTime } from '@/lib/utils';
import { PatientPicker } from '@/features/patients/PatientPicker';
import type { Patient } from '@/types/api';
import { PhoneVerification, phoneVerificationReady, type PhoneVerificationValue } from '@/features/inpatient/PhoneVerification';
import { DiagnosisInput } from '@/features/diagnoses/DiagnosisInput';

interface Ward { _id: string; name: string; code: string; type: string; gender: string; beds: number; occupied: number; available: number; bedChargeServiceCode?: string }
interface Bed { _id: string; number: string; category: string; status: string; wardId: { _id: string; name: string }; admissionId?: { _id: string; admissionNumber: string; admittedAt: string; patientId: { firstName: string; lastName: string; patientNumber: string; gender: string } } }
interface Admission { _id: string; admissionNumber: string; admittedAt: string; admissionDiagnosis: string; patientId: { _id: string; firstName: string; lastName: string; patientNumber: string; gender: string; dateOfBirth?: string; allergies?: unknown[] }; wardId: { name: string }; bedId: { number: string } }

const BED_TONE: Record<string, string> = { available: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40', occupied: 'border-sky-400 bg-sky-50 dark:bg-sky-950/40', cleaning: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40', maintenance: 'border-slate-400 bg-slate-100 dark:bg-slate-800' };

export default function InpatientPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [modal, setModal] = useState<'admit' | 'ward' | 'beds' | null>(null);
  const [wardFilter, setWardFilter] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [adm, setAdm] = useState({ wardId: '', bedId: '', admissionDiagnosis: '', admissionType: 'emergency', payer: 'cash' });
  const [phoneCheck, setPhoneCheck] = useState<PhoneVerificationValue>(null);
  const [phonePolicy, setPhonePolicy] = useState<'required' | 'optional' | 'off'>('required');
  const [ward, setWard] = useState({ name: '', code: '', type: 'general', gender: 'any', bedChargeServiceCode: '' });
  const [bedsForm, setBedsForm] = useState({ wardId: '', numbers: '', category: 'normal' });
  const wards = useQuery({ queryKey: ['wards'], queryFn: async () => (await api<Ward[]>('/inpatient/wards')).data });
  const beds = useQuery({ queryKey: ['beds', wardFilter], queryFn: async () => (await api<Bed[]>('/inpatient/beds', { query: { wardId: wardFilter || undefined } })).data, refetchInterval: 30_000 });
  const admissions = useQuery({ queryKey: ['admissions', wardFilter], queryFn: async () => (await api<Admission[]>('/inpatient/admissions', { query: { wardId: wardFilter || undefined, limit: 200 } })).data });
  const freeBeds = useQuery({ queryKey: ['free-beds', adm.wardId], queryFn: async () => (await api<Bed[]>('/inpatient/beds', { query: { wardId: adm.wardId, status: 'available' } })).data, enabled: !!adm.wardId });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['wards'] }); qc.invalidateQueries({ queryKey: ['beds'] }); qc.invalidateQueries({ queryKey: ['admissions'] }); setModal(null); };
  const admit = useMutation({ mutationFn: () => api('/inpatient/admissions', { method: 'POST', body: { patientId: patient!._id, bedId: adm.bedId, admissionDiagnosis: adm.admissionDiagnosis, admissionType: adm.admissionType, payer: { type: adm.payer }, phoneVerification: phoneCheck ? ('token' in phoneCheck ? { token: phoneCheck.token } : phoneCheck) : undefined } }), onSuccess: () => { setPatient(null); setPhoneCheck(null); setAdm({ wardId: '', bedId: '', admissionDiagnosis: '', admissionType: 'emergency', payer: 'cash' }); refresh(); } });
  const createWard = useMutation({ mutationFn: () => api('/inpatient/wards', { method: 'POST', body: { ...ward, bedChargeServiceCode: ward.bedChargeServiceCode || undefined } }), onSuccess: refresh });
  const addBeds = useMutation({ mutationFn: () => api(`/inpatient/wards/${bedsForm.wardId}/beds`, { method: 'POST', body: { numbers: bedsForm.numbers.split(',').map((s) => s.trim()).filter(Boolean), category: bedsForm.category } }), onSuccess: refresh });
  const bedStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(`/inpatient/beds/${id}/status`, { method: 'POST', body: { status } }), onSuccess: refresh });
  const totals = (wards.data ?? []).reduce((s, w) => ({ beds: s.beds + w.beds, occupied: s.occupied + w.occupied, available: s.available + w.available }), { beds: 0, occupied: 0, available: 0 });
  return (
    <>
      <PageHeader title="Inpatient" crumbs={['Inpatient', 'Wards']} actions={<>
        {can('inpatient.admit') && <Button onClick={() => setModal('admit')}><BedDouble className="h-4 w-4" /> Admit patient</Button>}
        {can('inpatient.manage') && <><Button variant="outline" onClick={() => setModal('ward')}><Plus className="h-4 w-4" /> Ward</Button><Button variant="outline" onClick={() => setModal('beds')}><Plus className="h-4 w-4" /> Beds</Button></>}
      </>} />
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Beds" value={totals.beds} />
        <Stat label="Occupied" value={totals.occupied} tone="blue" />
        <Stat label="Available" value={totals.available} tone="green" />
        <Stat label="Occupancy" value={totals.beds ? `${Math.round((totals.occupied / totals.beds) * 100)}%` : '—'} tone="amber" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={wardFilter ? 'outline' : 'primary'} onClick={() => setWardFilter('')}>All wards</Button>
        {wards.data?.map((w) => <Button key={w._id} size="sm" variant={wardFilter === w._id ? 'primary' : 'outline'} onClick={() => setWardFilter(w._id)}>{w.name} ({w.occupied}/{w.beds})</Button>)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card title="Bed board">
          {beds.isLoading && <Loading />}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {beds.data?.map((b) => (
              <div key={b._id} className={`rounded-lg border-2 p-2 text-xs ${BED_TONE[b.status]}`}>
                <p className="flex justify-between font-semibold"><span>{b.wardId?.name?.slice(0, 10)} {b.number}</span>{b.category !== 'normal' && <span className="uppercase">{b.category}</span>}</p>
                {b.admissionId ? (
                  <Link href={`/inpatient/${b.admissionId._id}`} className="mt-1 block truncate font-medium hover:underline">{b.admissionId.patientId?.firstName} {b.admissionId.patientId?.lastName}</Link>
                ) : <p className="mt-1 capitalize">{b.status}</p>}
                {b.status === 'cleaning' && can('nursing.record', 'inpatient.manage') && <button className="mt-1 text-emerald-700 underline" onClick={() => bedStatus.mutate({ id: b._id, status: 'available' })}>Mark clean</button>}
              </div>
            ))}
          </div>
          {(beds.data ?? []).length === 0 && !beds.isLoading && <p className="muted text-sm">No beds configured.</p>}
        </Card>
        <Card title="Admitted patients">
          <Table head={['Patient', 'Ward / bed', 'Diagnosis', 'Admitted']} empty={(admissions.data ?? []).length === 0}>
            {admissions.data?.map((a) => (
              <tr key={a._id} className="hover:bg-[var(--surface-2)]">
                <Td><Link href={`/inpatient/${a._id}`} className="font-medium text-brand-600 hover:underline">{a.patientId.firstName} {a.patientId.lastName}</Link><span className="muted block text-xs capitalize">{a.patientId.gender} · {age(a.patientId.dateOfBirth)} · {a.admissionNumber}</span></Td>
                <Td>{a.wardId?.name} · {a.bedId?.number}</Td>
                <Td className="text-sm">{a.admissionDiagnosis}</Td>
                <Td>{fmtDateTime(a.admittedAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Modal open={modal === 'admit'} onClose={() => setModal(null)} title="Admit patient" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient" className="col-span-full"><PatientPicker value={patient} onChange={setPatient} /></Field>
          <Field label="Ward"><Select value={adm.wardId} onChange={(e) => setAdm({ ...adm, wardId: e.target.value, bedId: '' })}><option value="">Select…</option>{wards.data?.map((w) => <option key={w._id} value={w._id}>{w.name} ({w.available} free)</option>)}</Select></Field>
          <Field label="Bed"><Select value={adm.bedId} onChange={(e) => setAdm({ ...adm, bedId: e.target.value })}><option value="">Select…</option>{freeBeds.data?.map((b) => <option key={b._id} value={b._id}>{b.number} {b.category !== 'normal' ? `(${b.category})` : ''}</option>)}</Select></Field>
          <Field label="Admission type"><Select value={adm.admissionType} onChange={(e) => setAdm({ ...adm, admissionType: e.target.value })}><option value="emergency">Emergency</option><option value="elective">Elective</option><option value="maternity">Maternity</option><option value="transfer_in">Transfer in</option></Select></Field>
          <Field label="Payer"><Select value={adm.payer} onChange={(e) => setAdm({ ...adm, payer: e.target.value })}><option value="cash">Cash</option><option value="sha">SHA</option><option value="insurance">Insurance</option></Select></Field>
          <Field label="Admission diagnosis" className="col-span-full" hint={can('admin.settings') ? 'Manage the list in Admin → Diagnoses.' : undefined}><DiagnosisInput value={adm.admissionDiagnosis} onChange={(v) => setAdm({ ...adm, admissionDiagnosis: v })} /></Field>
          {patient && <div className="col-span-full"><PhoneVerification patientId={patient._id} value={phoneCheck} onChange={setPhoneCheck} onPolicy={setPhonePolicy} /></div>}
          <div className="col-span-full space-y-2"><ErrorText error={admit.error} /><Button onClick={() => admit.mutate()} loading={admit.isPending} disabled={!patient || !adm.bedId || adm.admissionDiagnosis.length < 2 || !phoneVerificationReady(phonePolicy, phoneCheck)}>Admit</Button></div>
        </div>
      </Modal>
      <Modal open={modal === 'ward'} onClose={() => setModal(null)} title="New ward">
        <div className="space-y-3">
          <Field label="Name"><Input value={ward.name} onChange={(e) => setWard({ ...ward, name: e.target.value })} /></Field>
          <Field label="Code"><Input value={ward.code} onChange={(e) => setWard({ ...ward, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Type"><Select value={ward.type} onChange={(e) => setWard({ ...ward, type: e.target.value })}>{['general', 'maternity', 'pediatric', 'surgical', 'icu', 'hdu', 'newborn', 'dialysis', 'isolation'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Gender"><Select value={ward.gender} onChange={(e) => setWard({ ...ward, gender: e.target.value })}><option value="any">Any</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
          <Field label="Bed-day service code" hint="Billing service charged per bed day"><Input value={ward.bedChargeServiceCode} onChange={(e) => setWard({ ...ward, bedChargeServiceCode: e.target.value.toUpperCase() })} /></Field>
          <ErrorText error={createWard.error} />
          <Button onClick={() => createWard.mutate()} loading={createWard.isPending}>Create ward</Button>
        </div>
      </Modal>
      <Modal open={modal === 'beds'} onClose={() => setModal(null)} title="Add beds">
        <div className="space-y-3">
          <Field label="Ward"><Select value={bedsForm.wardId} onChange={(e) => setBedsForm({ ...bedsForm, wardId: e.target.value })}><option value="">Select…</option>{wards.data?.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</Select></Field>
          <Field label="Bed numbers (comma separated)"><Input value={bedsForm.numbers} onChange={(e) => setBedsForm({ ...bedsForm, numbers: e.target.value })} placeholder="1, 2, 3, 4" /></Field>
          <Field label="Category (SHA/DHA occupancy)"><Select value={bedsForm.category} onChange={(e) => setBedsForm({ ...bedsForm, category: e.target.value })}>{['normal', 'icu', 'hdu', 'newborn', 'dialysis', 'maternity', 'isolation'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <ErrorText error={addBeds.error} />
          <Button onClick={() => addBeds.mutate()} loading={addBeds.isPending} disabled={!bedsForm.wardId || !bedsForm.numbers}>Add beds</Button>
        </div>
      </Modal>
    </>
  );
}
