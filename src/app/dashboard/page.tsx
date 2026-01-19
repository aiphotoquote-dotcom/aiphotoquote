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

type MetricsResp =
  | {
      ok: true;
      range: { thisWeekStart: string; lastWeekStart: string };
      thisWeek: { total: number; optIn: number; rendered: number; failed: number };
      lastWeek: { total: number; optIn: number; rendered: number; failed: number };
      deltaPct: { total: number; optIn: number; rendered: number };
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(label: string, tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray") {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>{label}</span>;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: unknown) {
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
}

function deltaTone(n: number) {
  if (!Number.isFinite(n)) return "gray" as const;
  if (n > 5) return "green" as const;
  if (n < -5) return "red" as const;
  return "gray" as const;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricsResp | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    async function loadQuotes() {
      try {
        const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
        const json: RecentQuotesResp = await res.json();
        if (!cancelled) setQuotesResp(json);
      } catch {
        if (!cancelled) setQuotesResp({ ok: false, error: "FETCH_FAILED" });
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    }

    loadQuotes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        const res = await fetch("/api/tenant/metrics", { cache: "no-store" });
        const json: MetricsResp = await res.json();
        if (!cancelled) setMetrics(json);
      } catch {
        if (!cancelled) setMetrics({ ok: false, error: "FETCH_FAILED" });
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    }

    loadMetrics();
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

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);
    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

    return { ok, tenantName, tenantSlug, industryKey, hasSlug, hasIndustry, isReady, publicPath };
  }, [me]);

  async function copyPublicLink() {
    if (!computed.tenantSlug) return;

    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    const full = origin ? `${origin}${computed.publicPath}` : computed.publicPath;

    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const readyPill = loading ? pill("Loading…", "gray") : computed.isReady ? pill("Ready", "green") : pill("Needs setup", "yellow");

  const metricsOk = Boolean(metrics && "ok" in metrics && (metrics as any).ok);

  const thisWeek = metricsOk ? (metrics as any).thisWeek : null;
  const lastWeek = metricsOk ? (metrics as any).lastWeek : null;
  const delta = metricsOk ? (metrics as any).deltaPct : null;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Performance, recent activity, and your public quote link.
            </p>

            {computed.tenantName ? (
              <div className="mt-3 text-sm text-gray-800 dark:text-gray-200">
                Tenant: <span className="font-semibold">{computed.tenantName}</span>
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">({computed.tenantSlug})</span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {readyPill}
            <Link
              href="/onboarding"
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                computed.isReady
                  ? "border border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  : "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </Link>
          </div>
        </div>

        {/* Performance */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">This week performance</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Compared to last week (counts only for now).
              </p>
            </div>

            <div className="flex items-center gap-2">
              {metricsLoading ? pill("Loading…", "gray") : metricsOk ? pill("Live", "green") : pill("Unavailable", "yellow")}
            </div>
          </div>

          {metricsOk && thisWeek && lastWeek && delta ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Quotes</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisWeek.total}</div>
                  {pill(fmtPct(delta.total), deltaTone(delta.total))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Last week: {lastWeek.total}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Render opt-ins</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisWeek.optIn}</div>
                  {pill(fmtPct(delta.optIn), deltaTone(delta.optIn))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Last week: {lastWeek.optIn}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Rendered</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisWeek.rendered}</div>
                  {pill(fmtPct(delta.rendered), deltaTone(delta.rendered))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Last week: {lastWeek.rendered}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Render failures</div>
                <div className="mt-2 text-3xl font-semibold">{thisWeek.failed}</div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Last week: {lastWeek.failed}</div>
              </div>
            </div>
          ) : (
            <div className="mt-6 text-sm text-gray-600 dark:text-gray-300">
              {metricsLoading ? "Loading metrics…" : "Metrics couldn’t load yet (tenant might not be selected)."}
            </div>
          )}
        </section>

        {/* Public link + Recent quotes */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Public quote page */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">Public quote page</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Share this with customers.</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs text-gray-500">Path</div>
              <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {computed.tenantSlug ? (
                <>
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </>
              ) : (
                <Link
                  href="/onboarding"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Set tenant slug first
                </Link>
              )}
            </div>

            <div className="mt-5 text-xs text-gray-600 dark:text-gray-400">
              Tip: do one full end-to-end test (estimate + optional render).
            </div>
          </section>

          {/* Recent quotes */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent quotes</h2>
              {quotesLoading ? pill("Loading…", "gray") : null}
            </div>

            {!quotesLoading && quotesResp && "ok" in quotesResp && (quotesResp as any).ok ? (
              (quotesResp as any).quotes.length ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                    <div className="col-span-4">Created</div>
                    <div className="col-span-4">Quote ID</div>
                    <div className="col-span-4 text-right">Status</div>
                  </div>

                  <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                    {(quotesResp as any).quotes.map((q: any) => {
                      const statusRaw = (q.renderStatus || "").toString().toLowerCase();
                      const statusPill =
                        statusRaw === "rendered"
                          ? pill("Rendered", "green")
                          : statusRaw === "failed"
                            ? pill("Render failed", "red")
                            : statusRaw === "queued" || statusRaw === "running"
                              ? pill("Rendering", "blue")
                              : pill("Estimate", "gray");

                      return (
                        <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                          <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">{fmtDate(q.createdAt)}</div>

                          <div className="col-span-4 font-mono text-xs text-gray-700 dark:text-gray-300">{q.id}</div>

                          <div className="col-span-4 flex items-center justify-end gap-3">
                            {typeof q.estimateLow === "number" || typeof q.estimateHigh === "number" ? (
                              <div className="text-xs text-gray-700 dark:text-gray-300">
                                {money(q.estimateLow)} {q.estimateHigh != null ? `– ${money(q.estimateHigh)}` : ""}
                              </div>
                            ) : null}

                            {statusPill}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">No quotes yet. Run a test quote.</p>
              )
            ) : (
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
                {quotesLoading ? "Loading…" : "Couldn’t load recent quotes yet."}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/admin/quotes"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                View in Admin
              </Link>
              {computed.tenantSlug ? (
                <Link
                  href={computed.publicPath}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Open public quote page
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
