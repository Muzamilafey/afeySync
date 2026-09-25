'use client';

import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { PageHeader } from '@/components/ui';
import { MfaSettings } from '@/features/auth/MfaSettings';
import { MfaPolicyCard } from '@/features/auth/MfaPolicyCard';
import { GoogleLinkCard } from '@/features/auth/GoogleLinkCard';

export default function OwnerSecurityPage() {
  const me = useQuery({ queryKey: ['owner-me'], queryFn: async () => (await ownerApi<{ permissions: string[] }>('/auth/me')).data });
  return (
    <>
      <PageHeader title="Security" subtitle="Your sign-in protection and the platform-wide policy" crumbs={['Platform', 'Security']} />
      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        <div className="space-y-5"><MfaSettings realm="owner" /><GoogleLinkCard realm="owner" /></div>
        {me.data?.permissions.includes('owner.platform') && <MfaPolicyCard realm="owner" />}
      </div>
    </>
  );
}
