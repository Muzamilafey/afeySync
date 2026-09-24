import { AppShell } from '@/components/layout/AppShell';

export default function HmisLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
