import { PageHeader } from '@/components/ui';
import { RegisterFindPatient } from '@/features/patients/RegisterFindPatient';

export default function FrontDeskPage() {
  return (
    <>
      <PageHeader title="Front Desk" crumbs={['Front Desk', 'Register / Find Patient']} subtitle="Search the DHA Client Registry before registering to avoid duplicate records." />
      <RegisterFindPatient />
    </>
  );
}
