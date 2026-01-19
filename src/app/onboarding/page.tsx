"use client";

import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings: {
        tenant_id: string;
        industry_key: string | null;
        redirect_url: string | null;
        thank_you_url: string | null;
        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any; message?: string };

export default function Onboarding() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // If setup is complete, redirect to dashboard.
  // “Complete” for now = has industry_key (same rule as TopNav).
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (json && "ok" in json && json.ok) {
          const industry = json.settings?.industry_key ?? "";
          if (industry) {
            router.replace("/dashboard");
            return;
          }
        }
      } catch {
        // If it fails, just stay on onboarding.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Configure your tenant (industry, OpenAI key, pricing guardrails, and redirect URL).
            </p>
            {checking ? (
              <p className="mt-2 text-xs text-gray-500">Checking setup status…</p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 max-w-2xl">
          <TenantOnboardingForm redirectToDashboard />
        </div>
      </div>
    </main>
  );
}
