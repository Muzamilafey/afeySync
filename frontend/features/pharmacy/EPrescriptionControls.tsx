'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useCan } from '@/hooks/useMe';
import { Badge, Button } from '@/components/ui';
import type { Prescription } from './types';

const TONE = { sent: 'blue', dispense_reported: 'green', failed: 'red' } as const;
const LABEL = { sent: 'ePrescription sent', dispense_reported: 'Dispense reported', failed: 'ePrescription failed' } as const;

/** Send to the national ePrescription service (DHA HIE) and report dispensing. */
export function EPrescriptionControls({ rx }: { rx: Prescription }) {
  const can = useCan();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rx'] });
    qc.invalidateQueries({ queryKey: ['rx-queue'] });
  };
  const send = useMutation({ mutationFn: () => api(`/pharmacy/prescriptions/${rx._id}/eprescription`, { method: 'POST' }), onSuccess: refresh });
  const report = useMutation({ mutationFn: () => api(`/pharmacy/prescriptions/${rx._id}/eprescription/dispense`, { method: 'POST' }), onSuccess: refresh });
  const st = rx.ePrescription?.status;
  const err = (send.error ?? report.error) as ApiError | null;
  const notConfigured = err?.code === 'INTEGRATION_OPERATION_NOT_CONFIGURED';
  if (rx.status === 'cancelled') return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {st && <Badge tone={TONE[st]}>{LABEL[st]}{rx.ePrescription?.externalId ? ` · ${rx.ePrescription.externalId}` : ''}</Badge>}
      {(!st || st === 'failed') && can('prescription.create') && <Button size="sm" variant="ghost" loading={send.isPending} onClick={() => send.mutate()}><Send className="h-3.5 w-3.5" /> Send ePrescription</Button>}
      {st === 'sent' && rx.dispenses.length > 0 && can('pharmacy.dispense') && <Button size="sm" variant="ghost" loading={report.isPending} onClick={() => report.mutate()}>Report dispense</Button>}
      {st === 'failed' && rx.ePrescription?.lastError && <span className="text-red-600">{rx.ePrescription.lastError}</span>}
      {err && <span className={notConfigured ? 'text-amber-700' : 'text-red-600'}>{notConfigured ? 'National ePrescription is not yet configured by AfeySync platform administration.' : err.code === 'FHIR_VALIDATION_ERROR' ? `Not ready: ${(err.details as string[] | undefined)?.join('; ') ?? err.message}` : err.message}</span>}
    </div>
  );
}
