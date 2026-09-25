'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/features/theme/ThemeToggle';

type Phase = 'day' | 'night';

/** Day from 06:00 to 18:30 on the device's clock; night otherwise. */
const phaseNow = (): Phase => {
  const d = new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= 6 * 60 && minutes < 18 * 60 + 30 ? 'day' : 'night';
};

/**
 * Full-screen scenery behind the sign-in pages: a mountain meadow by day, a starry mountain lake by
 * night. The photos are /login-day.jpg and /login-night.jpg (frontend/public); until they are added,
 * a drawn version of each scene shows instead.
 */
export function AuthBackground({ children }: { children: ReactNode }) {
  // Night until mounted, so server and first client render match; then the device's own time.
  const [phase, setPhase] = useState<Phase>('night');
  useEffect(() => {
    setPhase(phaseNow());
    const t = setInterval(() => setPhase(phaseNow()), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={`auth-bg auth-bg-${phase} relative flex min-h-screen items-center justify-center p-4`} data-phase={phase}>
      <ThemeToggle className="absolute top-4 right-4 bg-black/25 text-white backdrop-blur hover:bg-black/40 dark:hover:bg-black/40" />
      {children}
    </div>
  );
}
