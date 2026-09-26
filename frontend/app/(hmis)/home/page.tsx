'use client';

import { Greeting } from '@/features/apps/Greeting';
import { QuickAccess } from '@/features/apps/QuickAccess';

/** The facility landing page: a greeting and the apps you use most. */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Greeting />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-6 md:px-8">
        <QuickAccess />
      </div>
    </div>
  );
}
