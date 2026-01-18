"use client";

import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();
        if (!cancelled) setMe(json);
      } catch {
        if (!cancelled) setMe({ ok: false, error: "FETCH_FAILED" });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setupComplete = useMemo(() => {
    if (!me || !("ok" in me) || !me.ok) return false;
    const industry = me.settings?.industry_key ?? "";
    return Boolean(industry);
  }, [me]);

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
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Checking setup status…
              </p>
            ) : null}
          </div>
        </div>

        {/* ✅ Setup complete banner (NO redirect) */}
        {!checking && setupComplete ? (
          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
            <div className="font-semibold">Setup complete ✅</div>
            <div className="mt-1 opacity-90">
              You can still edit settings here anytime.
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Back to dashboard
              </Link>
              <Link
                href="/admin"
                className="rounded-lg border border-green-200 px-4 py-2 text-sm font-semibold hover:bg-green-100/60 dark:border-green-900/50 dark:hover:bg-green-900/20"
              >
                Admin
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-8 max-w-2xl">
          {/* If you want “Save settings” to bounce back to dashboard, keep this prop */}
          <TenantOnboardingForm redirectToDashboard />
        </div>
      </div>
    </main>
  );
}
