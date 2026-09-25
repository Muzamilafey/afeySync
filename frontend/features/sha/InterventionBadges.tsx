'use client';

import { Badge } from '@/components/ui';
import type { InterventionFlags } from './shaVisitTypes';

/** The DHA workflow flags for an intervention, shown exactly as returned. */
export function InterventionBadges({ i }: { i: InterventionFlags }) {
  return (
    <span className="flex flex-wrap gap-1">
      {i.accessPoint && <Badge tone="blue">{i.accessPoint}</Badge>}
      {i.paymentMechanism && <Badge>{i.paymentMechanism.replace(/_/g, ' ')}</Badge>}
      {i.fund && <Badge tone="purple">{i.fund}</Badge>}
      {i.needsPreauth === true && <Badge tone="amber">Preauth required</Badge>}
      {i.needsManualPreauthApproval === true && <Badge tone="amber">Manual approval</Badge>}
      {i.specialPreauth?.map((s) => <Badge key={s} tone="amber">{s} preauth</Badge>)}
      {i.needsDoctorAuthorization === true && <Badge tone="amber">Doctor authorization</Badge>}
      {i.needsMemberAuthorization === true && <Badge tone="amber">Member authorization</Badge>}
      {i.needApprovalBeforeClaimSubmission === true && <Badge tone="amber">Approval before claim</Badge>}
      {i.needsPreauth === false && <Badge tone="green">No preauth</Badge>}
      {i.state === 'retired' && <Badge tone="red">Retired</Badge>}
    </span>
  );
}
