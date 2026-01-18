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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function item(ok: boolean) {
  return ok ? "✅" : "⬜️";
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);
  const [copied, setCopied] = useState(false);

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

    // “ready” is minimal right now; can tighten later
    const isReady = hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

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
      isReady,
      publicPath,
    };
  }, [me]);

  async function copyPublicLink() {
    if (!computed.tenantSlug) return;

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";

    const full = origin ? `${origin}${computed.publicPath}` : computed.publicPath;

    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // fallback: do nothing; user can select/copy manually
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant flow status + shortcuts.
            </p>
          </div>

          <Link
            href="/onboarding"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {computed.isReady ? "Settings" : "Finish setup"}
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Setup Checklist */}
          <div className="rounded-2xl border p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Setup checklist</h2>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  computed.isReady
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-yellow-200 bg-yellow-50 text-yellow-900"
                )}
              >
                {loading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup"}
              </span>
            </div>

            {!loading && computed.ok ? (
              <ul className="mt-4 space-y-2 text-sm text-gray-800">
                <li>
                  {item(computed.tenantSlug.length > 0)} Tenant slug{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.tenantSlug || "—"}
                  </span>
                </li>
                <li>
                  {item(computed.hasIndustry)} Industry{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.industryKey || "—"}
                  </span>
                </li>
                <li>{item(computed.hasRedirect)} Redirect URL (optional)</li>
                <li>{item(computed.hasThankYou)} Thank-you URL (optional)</li>
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-600">
                {loading
                  ? "Loading your tenant…"
                  : "Couldn’t load tenant settings. Refresh and try again."}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Open onboarding
              </Link>
              <Link
                href="/admin/setup/openai"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                OpenAI setup
              </Link>
              <Link
                href="/admin/setup/ai-policy"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                AI policy
              </Link>
            </div>
          </div>

          {/* Public Quote Page */}
          <div className="rounded-2xl border p-6">
            <h2 className="font-semibold">Public quote page</h2>
            <p className="mt-2 text-sm text-gray-600">
              This is what customers use. Share it after setup.
            </p>

            <div className="mt-4 rounded-xl border bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Path</div>
              <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {computed.tenantSlug ? (
                <>
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open quote page
                  </Link>
                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </>
              ) : (
                <Link
                  href="/onboarding"
                  className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                >
                  Set tenant slug first
                </Link>
              )}
            </div>

            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold">Quick actions</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Finish onboarding to set slug + industry</li>
                <li>Confirm tenant OpenAI key is set</li>
                <li>Run one test quote end-to-end</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Next */}
        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next improvements (today)</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Make onboarding redirect back here when complete.</li>
            <li>Add “Quotes” list for tenant (latest 10) in dashboard.</li>
            <li>Fix navigation flow between Admin ↔ Dashboard ↔ Onboarding.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
