// src/app/onboarding/wizard/page.tsx
import { Suspense } from "react";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export default function OnboardingWizardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading onboarding…</div>}>
      <OnboardingWizard />
    </Suspense>
  );
}