'use client';

import { Alert, Card } from '@/components/ui';

/** Replaced by the documents module implementation. */
export function DocumentsPanel(_props: { relatedTo?: { resource: string; id: string }; patientId?: string; category?: string }) {
  return <Card title="Attachments"><Alert tone="blue">Document storage is being enabled.</Alert></Card>;
}
