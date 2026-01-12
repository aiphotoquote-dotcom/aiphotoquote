import { UserButton } from "@clerk/nextjs";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";

export default function Onboarding() {
  return (
    <main className="min-h-screen p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <UserButton />
      </div>

      <div className="mt-8 max-w-2xl">
        <TenantOnboardingForm />
      </div>
    </main>
  );
}
