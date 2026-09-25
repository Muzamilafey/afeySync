import type { Metadata } from 'next';
import { OnboardingWizard } from '@/features/onboarding/Wizard';

export const metadata: Metadata = { title: 'Get started · AfeySync', description: 'Register your facility on AfeySync' };

export default function GetStartedPage() {
  return <OnboardingWizard />;
}
