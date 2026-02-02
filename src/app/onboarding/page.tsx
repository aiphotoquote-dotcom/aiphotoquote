// src/app/onboarding/page.tsx
import OnboardingWizard from "./wizard/OnboardingWizard";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <OnboardingWizard />;
}