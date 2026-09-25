'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { BrandingEditor } from '@/features/branding/BrandingEditor';

export default function BrandingPage() {
  const [host, setHost] = useState<string>();
  useEffect(() => setHost(window.location.host), []);
  return (
    <>
      <PageHeader title="Branding" subtitle="Your logo, name and colour on your facility's sign-in page, app header and installed app." crumbs={['Admin', 'Branding']} />
      <BrandingEditor address={host} />
    </>
  );
}
