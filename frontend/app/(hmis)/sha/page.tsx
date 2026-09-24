import { PageHeader } from '@/components/ui';
import { EligibilityChecker } from '@/features/sha/EligibilityChecker';

export default function ShaPage() {
  return (
    <>
      <PageHeader title="SHA Eligibility" crumbs={['SHA', 'Eligibility']} subtitle="Patient → Client Registry ID → Eligibility → Benefits → Interventions → Utilization" />
      <EligibilityChecker />
    </>
  );
}
