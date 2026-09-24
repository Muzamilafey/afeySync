import { OwnerShell } from '@/components/layout/OwnerShell';

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
