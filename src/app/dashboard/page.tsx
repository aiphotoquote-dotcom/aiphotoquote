"use client";

import TopNav from "@/components/TopNav";
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
  | { ok: false; error: any };

function badgeClass(ok: boolean) {
  return ok
    ? "border-green-200 bg-green-50 text-green-800"
    : "border-yellow-200 bg-yellow-50 text-yellow-900";
}

function yesNo(v: unknown) {
  return v ? "Yes" : "No";
}

export default function Dashboard() {
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

    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    // “complete” can be whatever you want; keeping it minimal for now:
    const isSetupComplete = hasIndustry;

    return {
      ok,
      tenantName,
      tenantSlug,
      industryKey,
      redirectUrl,
      thankYouUrl,
      hasIndustry,
      hasRedirect,
      hasThankYou,
      isSetupComplete,
      publicQuotePath: tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>",
    };
  }, [me]);

  return (
    <main className="min-h-screen">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Quick status + shortcuts for your tenant.
            </p>
          </div>

          <Link
            href="/onboarding"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Open Onboarding
          </Link>
        </div>

        {/* Setup Status */}
        <div className="rounded-2xl border p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Setup status</h2>

            <span
              className={[
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                badgeClass(computed.isSetupComplete),
              ].join(" ")}
            >
              {loading ? "Loading…" : computed.isSetupComplete ? "Ready" : "Needs setup"}
            </span>
          </div>

          {!loading && computed.ok ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Tenant</div>
                <div className="mt-1 font-semibold">
                  {computed.tenantName || "Unnamed tenant"}
                </div>
                <div className="mt-1 text-sm">
                  <span className="text-gray-500">Slug:</span>{" "}
                  <span className="font-mono">{computed.tenantSlug || "—"}</span>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Public quote page</div>
                <div className="mt-1 font-mono text-sm">{computed.publicQuotePath}</div>
                {computed.tenantSlug ? (
                  <div className="mt-2">
                    <Link className="underline text-sm" href={computed.publicQuotePath}>
                      Open quote page
                    </Link>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-600">
                    Set your tenant slug in onboarding to activate your public page.
                  </div>
                )}
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Industry</div>
                <div className="mt-1 text-sm">
                  <span className="font-semibold">{computed.industryKey || "—"}</span>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  Required for “Ready” status.
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Redirects</div>
                <div className="mt-2 text-sm space-y-1">
                  <div>
                    <span className="text-gray-500">Redirect URL:</span>{" "}
                    <span className="font-semibold">{yesNo(computed.hasRedirect)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Thank-you URL:</span>{" "}
                    <span className="font-semibold">{yesNo(computed.hasThankYou)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              {loading
                ? "Loading your tenant settings…"
                : "Couldn’t load tenant settings. Try refreshing, then check /api/tenant/me-settings."}
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Quick links</h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/onboarding">
              Onboarding / Settings
            </Link>
            <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/admin">
              Admin
            </Link>
            <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/quote">
              Quote (internal)
            </Link>
          </div>
        </div>

        {/* Next */}
        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next steps</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Refine dashboard layout + tenant KPIs (quotes today/week, render rate, email status).</li>
            <li>Fix navigation flow (onboarding → dashboard, admin back links, tenant context clarity).</li>
            <li>Then we add the “tenant widget” embed script + onboarding checklist.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
