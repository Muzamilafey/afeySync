'use client';

import { Alert, Card } from '@/components/ui';

/** Replaced by the pharmacy module implementation. */
export function PrescriptionPanel(_props: { visitId?: string; admissionId?: string; patientId: string; open: boolean }) {
  return <Card title="Prescriptions"><Alert tone="blue">Pharmacy module is being enabled.</Alert></Card>;
}
