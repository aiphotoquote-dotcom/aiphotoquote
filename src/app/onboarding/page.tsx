import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";

export default function Onboarding() {
  return (
    <main className="min-h-screen">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Onboarding</h1>
            <p className="mt-2 text-sm text-gray-600">
              Configure your tenant settings (industry, OpenAI key, pricing guardrails, and redirect URL).
            </p>
          </div>
        </div>

        <div className="mt-8 max-w-2xl">
          <TenantOnboardingForm />
        </div>
      </div>
    </main>
  );
}
