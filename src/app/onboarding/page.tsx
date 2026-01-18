import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";

export default function Onboarding() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700">
              Configure your tenant (industry, OpenAI key, pricing guardrails, and redirect URL).
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
