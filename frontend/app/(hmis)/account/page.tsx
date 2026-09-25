'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loading, PageHeader } from '@/components/ui';
import { ChangePasswordCard } from '@/features/account/ChangePasswordCard';

/** First sign-in: the password screen. Otherwise account settings live under Security and My profile. */
function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const first = !!params.get('first');
  useEffect(() => {
    if (!first) router.replace(`/account/security${params.toString() ? `?${params.toString()}` : ''}`);
  }, [first, params, router]);
  if (!first) return <Loading />;
  return (
    <>
      <PageHeader title="Welcome! Choose your password" />
      <ChangePasswordCard first />
    </>
  );
}

export default function AccountPage() {
  return <Suspense><Inner /></Suspense>;
}
