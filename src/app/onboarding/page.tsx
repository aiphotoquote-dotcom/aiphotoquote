"use client";

import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(label: string, tone: "gray" | "green" | "yellow" = "gray") {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>{label}</span>;
}

export default function Onboarding() {
  const [loading, setLoading] = useState(true);
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
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    const ok = Boolean(me && "ok" in me && me.ok);
    const tenant = ok ? (me as any).tenant : null;
    const settings = ok ? (me as any).settings : null;

    const tenantName = tenant?.name ? String(tenant.name) : "";
    const tenantSlug = tenant?.slug ? String(tenant.slug) : "";

    const industryKey = settings?.industry_key ? String(settings.industry_key) : "";
    const redirectUrl = settings?.redirect_url ? String(settings.redirect_url) : "";
    const thankYouUrl = settings?.thank_you_url ? String(settings.thank_you_url) : "";

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    const isReady = hasSlug && hasIndustry;

    return { ok, tenantName, tenantSlug, industryKey, redirectUrl, thankYouUrl, hasSlug, hasIndustry, hasRedirect, hasThankYou, isReady };
  }, [me]);

  const statusPill = loading ? pill("Loading…", "gray") : computed.isReady ? pill("Ready", "green") : pill("Needs setup", "yellow");

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Configure your tenant (industry, OpenAI key, pricing guardrails, and redirect URL).
            </p>
          </div>

          <div className="flex items-center gap-3">
            {statusPill}
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to dashboard
            </Link>
          </div>
        </div>

        {/* Setup widget moved here */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Setup status</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Quick checklist so you always know what’s left.
              </p>
            </div>
            {statusPill}
          </div>

          {(!loading && computed.ok) ? (
            <ul className="mt-5 grid gap-2 text-sm text-gray-800 dark:text-gray-200">
              <li>
                <span className="mr-2">{computed.hasSlug ? "✅" : "⬜️"}</span>
                Tenant slug{" "}
                <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                  {computed.tenantSlug || "—"}
                </span>
              </li>
              <li>
                <span className="mr-2">{computed.hasIndustry ? "✅" : "⬜️"}</span>
                Industry{" "}
                <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                  {computed.industryKey || "—"}
                </span>
              </li>
              <li>
                <span className="mr-2">{computed.hasRedirect ? "✅" : "⬜️"}</span>
                Redirect URL (optional)
              </li>
              <li>
                <span className="mr-2">{computed.hasThankYou ? "✅" : "⬜️"}</span>
                Thank-you URL (optional)
              </li>
            </ul>
          ) : (
            <p className="mt-5 text-sm text-gray-600 dark:text-gray-300">
              {loading ? "Loading your tenant…" : "Couldn’t load tenant settings. Refresh and try again."}
            </p>
          )}

          {!loading && computed.ok && computed.isReady ? (
            <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
              Setup is complete. You’re good to go. ✅
            </div>
          ) : null}
        </section>

        {/* Existing settings form */}
        <div className="max-w-2xl">
          <TenantOnboardingForm redirectToDashboard />
        </div>
      </div>
    </main>
  );
}
