'use client';

import { Alert } from '@/components/ui';

/** Orders panel (lab, radiology, prescriptions). Filled in by the laboratory, radiology and pharmacy modules. */
export function VisitOrders({ visitId, patientId, open }: { visitId: string; patientId: string; open: boolean }) {
  void visitId;
  void patientId;
  void open;
  return <Alert tone="blue">Orders are available once laboratory, radiology and pharmacy modules are enabled.</Alert>;
}
