"use client";

import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";
import { useEffect, useMemo, useState } from "react";
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

  const [me, setMe] = useState<MeSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Also re-check periodically while user is on the page (covers “save then redirect”)
    const t = setInterval(load, 1500);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const isReady = useMemo(() => {
    if (!me || !("ok" in me) || !me.ok) return false;
    const slug = me.tenant?.slug ? String(me.tenant.slug) : "";
    const industry = me.settings?.industry_key ? String(me.settings.industry_key) : "";
    return Boolean(slug && industry);
  }, [me]);

  useEffect(() => {
    if (!loading && isReady) {
      router.replace("/dashboard");
    }
  }, [loading, isReady, router]);

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
            {loading ? (
              <p className="mt-2 text-xs text-gray-500">Loading tenant…</p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 max-w-2xl">
          <TenantOnboardingForm />
        </div>
      </div>
    </main>
  );
}
