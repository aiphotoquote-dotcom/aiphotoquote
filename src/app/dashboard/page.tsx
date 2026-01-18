"use client";

import TopNav from "@/components/TopNav";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

type RecentQuotesResp =
  | {
      ok: true;
      quotes: Array<{
        id: string;
        createdAt: string;
        estimateLow?: number | null;
        estimateHigh?: number | null;
        inspectionRequired?: boolean | null;
        renderStatus?: string | null;
        renderImageUrl?: string | null;
        renderOptIn?: boolean | null;
      }>;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(
  label: string,
  tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray"
) {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : "border-gray-200 bg-gray-50 text-gray-800";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: unknown) {
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function renderTone(statusRaw: string) {
  const s = (statusRaw || "").toLowerCase();
  if (s === "rendered") return "green";
  if (s === "failed") return "red";
  if (s === "queued" || s === "running") return "blue";
  return "gray";
}

function renderLabel(statusRaw: string) {
  const s = (statusRaw || "").toLowerCase();
  if (s === "rendered") return "Rendered";
  if (s === "failed") return "Render failed";
  if (s === "queued" || s === "running") return "Rendering";
  return "Estimate";
}

export default function Dashboard() {
  const [loadingMe, setLoadingMe] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // ---- Load tenant settings ----
  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
      const json: MeSettingsResponse = await res.json();
      setMe(json);
    } catch {
      setMe({ ok: false, error: "FETCH_FAILED" });
    } finally {
      setLoadingMe(false);
    }
  }, []);

  // ---- Load recent quotes ----
  const loadQuotes = useCallback(async () => {
    setLoadingQuotes(true);
    try {
      const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
      const json: RecentQuotesResp = await res.json();
      setQuotesResp(json);
    } catch {
      setQuotesResp({ ok: false, error: "FETCH_FAILED" });
    } finally {
      setLoadingQuotes(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadMe();
      if (cancelled) return;
      await loadQuotes();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMe, loadQuotes]);

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

    // Minimal ready state: slug + industry
    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

    return {
      ok,
      tenantName,
      tenantSlug,
      industryKey,
      redirectUrl,
      thankYouUrl,
      hasSlug,
      hasIndustry,
      isReady,
      publicPath,
    };
  }, [me]);

  async function copyPublicLink() {
    setCopyError(null);

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
    } catch (e: any) {
      setCopied(false);
      setCopyError("Clipboard blocked. You can manually copy the link.");
    }
  }

  const setupTone = loadingMe ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = loadingMe ? "Loading…" : computed.isReady ? "Ready" : "Needs setup";

  const quotesOk = Boolean(quotesResp && "ok" in quotesResp && quotesResp.ok);
  const quotes = quotesOk ? (quotesResp as any).quotes : [];

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant status, public link, and recent activity.
            </p>

            {computed.tenantName ? (
              <div className="mt-3 text-sm text-gray-800">
                Tenant: <span className="font-semibold">{computed.tenantName}</span>
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    ({computed.tenantSlug})
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {pill(setupLabel, setupTone as any)}
            <Link
              href="/onboarding"
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                computed.isReady ? "border border-gray-200 hover:bg-gray-50" : "bg-black text-white"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </Link>
          </div>
        </div>

        {/* Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Tenant card */}
          <section className="rounded-2xl border p-6 lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Tenant</h2>
              {pill(setupLabel, setupTone as any)}
            </div>

            {!loadingMe && computed.ok ? (
              <div className="space-y-2 text-sm text-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-gray-600">Slug</div>
                  <div className="font-mono text-xs">{computed.tenantSlug || "—"}</div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-gray-600">Industry</div>
                  <div className="font-mono text-xs">{computed.industryKey || "—"}</div>
                </div>

                <div className="pt-2 space-y-1">
                  <div className="text-xs text-gray-600">
                    {computed.hasSlug ? "✅" : "⬜️"} Slug
                  </div>
                  <div className="text-xs text-gray-600">
                    {computed.hasIndustry ? "✅" : "⬜️"} Industry
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                {loadingMe ? "Loading your tenant…" : "Couldn’t load tenant settings."}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/onboarding"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Open onboarding
              </Link>
              <Link
                href="/admin"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Admin
              </Link>
            </div>

            <button
              type="button"
              onClick={loadMe}
              className="w-full rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              disabled={loadingMe}
            >
              {loadingMe ? "Refreshing…" : "Refresh tenant"}
            </button>
          </section>

          {/* Right column */}
          <div className="grid gap-6 lg:col-span-2">
            {/* Public quote page */}
            <section className="rounded-2xl border p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">Public quote page</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Share this with customers after setup.
                  </p>
                </div>

                {computed.tenantSlug ? (
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={computed.publicPath}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/onboarding"
                    className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    Set tenant slug first
                  </Link>
                )}
              </div>

              <div className="mt-4 rounded-xl border bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Path</div>
                <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
              </div>

              {copyError ? (
                <div className="mt-3 text-xs text-red-700">{copyError}</div>
              ) : null}

              <div className="mt-4 text-xs text-gray-600">
                Tip: run one complete test quote (estimate + optional rendering) after setup.
              </div>
            </section>

            {/* Recent quotes */}
            <section className="rounded-2xl border p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold">Recent quotes</h2>
                  {loadingQuotes ? pill("Loading…", "gray") : null}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={loadQuotes}
                    className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                    disabled={loadingQuotes}
                  >
                    {loadingQuotes ? "Refreshing…" : "Refresh"}
                  </button>

                  <Link
                    href="/admin/quotes"
                    className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    View all
                  </Link>
                </div>
              </div>

              {!loadingQuotes && quotesOk ? (
                quotes.length ? (
                  <div className="mt-4 overflow-hidden rounded-xl border">
                    <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600">
                      <div className="col-span-4">Created</div>
                      <div className="col-span-4">Quote ID</div>
                      <div className="col-span-4 text-right">Status</div>
                    </div>

                    <ul className="divide-y">
                      {quotes.map((q: any) => {
                        const statusRaw = (q.renderStatus || "").toString();
                        const status = pill(renderLabel(statusRaw), renderTone(statusRaw) as any);

                        const range =
                          typeof q.estimateLow === "number" || typeof q.estimateHigh === "number"
                            ? `${money(q.estimateLow)}${
                                q.estimateHigh != null ? ` – ${money(q.estimateHigh)}` : ""
                              }`
                            : "";

                        return (
                          <li key={q.id}>
                            <Link
                              href={`/admin/quotes/${q.id}`}
                              className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 transition"
                            >
                              <div className="col-span-4 text-sm text-gray-800">
                                {fmtDate(q.createdAt)}
                              </div>

                              <div className="col-span-4 font-mono text-xs text-gray-700 truncate">
                                {q.id}
                              </div>

                              <div className="col-span-4 flex items-center justify-end gap-3">
                                {range ? (
                                  <div className="text-xs text-gray-700">{range}</div>
                                ) : null}
                                {status}
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">No quotes yet</div>
                    <div className="mt-1 text-sm text-gray-700">
                      Run a test quote from your public page to validate the full flow.
                    </div>
                    {computed.tenantSlug ? (
                      <div className="mt-3">
                        <Link
                          href={computed.publicPath}
                          className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                        >
                          Open public quote page
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="mt-4 rounded-xl border bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">Couldn’t load recent quotes</div>
                  <div className="mt-1 text-sm text-gray-700">
                    {loadingQuotes ? "Loading…" : "Try Refresh, or check your tenant session."}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={loadQuotes}
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                      disabled={loadingQuotes}
                    >
                      {loadingQuotes ? "Refreshing…" : "Retry"}
                    </button>
                    <Link
                      href="/admin/quotes"
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      Open Admin quotes
                    </Link>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Flow polish */}
        <section className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next (flow polish)</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Make onboarding always redirect here when setup is complete.</li>
            <li>Add “share link” affordance on onboarding + admin pages.</li>
            <li>Add a tenant quotes page (not admin) later for clean SaaS separation.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
