"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

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

function Pill({
  label,
  state,
}: {
  label: string;
  state: "ok" | "warn" | "idle" | "loading";
}) {
  const styles =
    state === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : state === "loading"
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-gray-200 bg-white text-gray-700";

  const dot =
    state === "ok"
      ? "bg-emerald-500"
      : state === "warn"
        ? "bg-amber-500"
        : state === "loading"
          ? "bg-gray-400 animate-pulse"
          : "bg-gray-300";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        styles
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [industryKey, setIndustryKey] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [thankYouUrl, setThankYouUrl] = useState<string | null>(null);

  const quotePath = useMemo(() => {
    return tenantSlug ? `/q/${tenantSlug}` : null;
  }, [tenantSlug]);

  const setupComplete = useMemo(() => {
    // Keep it simple: "industry is chosen" == setup complete (matches TopNav logic)
    return Boolean((industryKey ?? "").trim());
  }, [industryKey]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setTenantName(null);
          setTenantSlug(null);
          setIndustryKey(null);
          setRedirectUrl(null);
          setThankYouUrl(null);
          setLoading(false);
          return;
        }

        setTenantName(json.tenant?.name ?? null);
        setTenantSlug(json.tenant?.slug ?? null);

        const s = json.settings;
        setIndustryKey(s?.industry_key ?? null);
        setRedirectUrl(s?.redirect_url ?? null);
        setThankYouUrl(s?.thank_you_url ?? null);

        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setTenantName(null);
          setTenantSlug(null);
          setIndustryKey(null);
          setRedirectUrl(null);
          setThankYouUrl(null);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              {loading
                ? "Loading tenant status…"
                : tenantName
                  ? `Signed in as ${tenantName}`
                  : "Signed in"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pill label="Industry" state={loading ? "loading" : industryKey ? "ok" : "warn"} />
            <Pill
              label="Redirect"
              state={loading ? "loading" : redirectUrl ? "ok" : "idle"}
            />
            <Pill
              label="Thank-you"
              state={loading ? "loading" : thankYouUrl ? "ok" : "idle"}
            />
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Quick actions</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Keep onboarding tight so tenant setup stays frictionless.
                </p>
              </div>

              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  loading
                    ? "border-gray-200 bg-gray-50 text-gray-700"
                    : setupComplete
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                )}
              >
                {loading ? "Checking…" : setupComplete ? "Setup complete" : "Setup needed"}
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <Link
                href="/onboarding"
                className={cn(
                  "inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold",
                  setupComplete
                    ? "bg-gray-900 text-white"
                    : "bg-gray-900 text-white"
                )}
              >
                {setupComplete ? "Settings" : "Configure settings"}
              </Link>

              {quotePath ? (
                <Link
                  href={quotePath}
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900"
                >
                  Open public quote page
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-400"
                  title="No tenant slug yet"
                >
                  Open public quote page
                </button>
              )}

              {quotePath ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold text-gray-700">Public quote link</div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="truncate font-mono text-xs text-gray-800">{quotePath}</div>
                    <button
                      type="button"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(quotePath);
                        } catch {
                          // ignore clipboard errors
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">What’s next</h2>
            <p className="mt-2 text-sm text-gray-600">
              Here’s the flow we’re building toward (sellable + portable):
            </p>

            <ol className="mt-4 space-y-2 text-sm text-gray-700">
              <li className="flex gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  1
                </span>
                <span>
                  Tenant dashboard: settings visibility + status + links that match actual tenant data.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  2
                </span>
                <span>
                  Navigation polish: fewer dead-ends, clearer labels, and guardrails when setup isn’t complete.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  3
                </span>
                <span>
                  Rendering pipeline: estimate → lead email + DB → render → render email + DB (idempotent).
                </span>
              </li>
            </ol>

            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-xs font-semibold text-gray-700">Tip</div>
              <p className="mt-1 text-xs text-gray-600">
                Keeping this dashboard “truthy” (reads from real tenant settings) prevents support pain later.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 text-xs text-gray-500">
          This dashboard reads tenant status from <span className="font-mono">/api/tenant/me-settings</span>.
        </div>
      </div>
    </main>
  );
}
