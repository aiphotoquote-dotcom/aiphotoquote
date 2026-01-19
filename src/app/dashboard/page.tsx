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
      range: { thisStart: string; thisEnd: string; lastStart: string; lastEnd: string };
      thisPeriod: { total: number; optIn: number; rendered: number; failed: number };
      lastPeriod: { total: number; optIn: number; rendered: number; failed: number };
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

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
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

  const readyPill =
    loading ? pill("Loading…", "gray") : computed.isReady ? pill("Ready", "green") : pill("Needs setup", "yellow");

  const metricsOk = Boolean(metrics && "ok" in metrics && (metrics as any).ok);

  const thisP = metricsOk ? (metrics as any).thisPeriod : null;
  const lastP = metricsOk ? (metrics as any).lastPeriod : null;
  const delta = metricsOk ? (metrics as any).deltaPct : null;

  const rangeLabel =
    metricsOk && metrics && "range" in (metrics as any)
      ? `Last 7 days vs previous 7 days`
      : "Last 7 days";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Hero / Centerpiece */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">Dashboard</h1>
                {readyPill}
              </div>

              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {computed.tenantName ? (
                  <>
                    Tenant: <span className="font-semibold text-gray-900 dark:text-gray-100">{computed.tenantName}</span>{" "}
                    {computed.tenantSlug ? (
                      <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                        ({computed.tenantSlug})
                      </span>
                    ) : null}
                  </>
                ) : (
                  "Performance, recent activity, and your public quote link."
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/admin/quotes"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                View quotes
              </Link>

              <Link
                href="/onboarding"
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-semibold",
                  computed.isReady
                    ? "border border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                    : "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                )}
              >
                {computed.isReady ? "Settings" : "Finish setup"}
              </Link>

              {computed.tenantSlug ? (
                <Link
                  href={computed.publicPath}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Open public page
                </Link>
              ) : null}
            </div>
          </div>

          {/* Public link strip */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
            <div>
              <div className="text-xs text-gray-500">Public quote page</div>
              <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
            </div>

            <div className="flex flex-wrap gap-3">
              {computed.tenantSlug ? (
                <>
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
          </div>
        </section>

        {/* Performance */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Performance</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{rangeLabel}</p>
            </div>

            <div className="flex items-center gap-2">
              {metricsLoading ? pill("Loading…", "gray") : metricsOk ? pill("Live", "green") : pill("Unavailable", "yellow")}
            </div>
          </div>

          {metricsOk && thisP && lastP && delta ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Quotes (last 7d)</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisP.total}</div>
                  {pill(fmtPct(delta.total), deltaTone(delta.total))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Prev 7d: {lastP.total}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Render opt-ins</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisP.optIn}</div>
                  {pill(fmtPct(delta.optIn), deltaTone(delta.optIn))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Prev 7d: {lastP.optIn}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Rendered</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-3xl font-semibold">{thisP.rendered}</div>
                  {pill(fmtPct(delta.rendered), deltaTone(delta.rendered))}
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Prev 7d: {lastP.rendered}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Render failures</div>
                <div className="mt-2 text-3xl font-semibold">{thisP.failed}</div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Prev 7d: {lastP.failed}</div>
              </div>
            </div>
          ) : (
            <div className="mt-6 text-sm text-gray-600 dark:text-gray-300">
              {metricsLoading ? "Loading metrics…" : "Metrics couldn’t load yet (tenant might not be selected)."}
            </div>
          )}
        </section>

        {/* Recent quotes */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent quotes</h2>
            {quotesLoading ? pill("Loading…", "gray") : null}
          </div>

          {!quotesLoading && quotesResp && "ok" in quotesResp && (quotesResp as any).ok ? (
            (quotesResp as any).quotes.length ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  <div className="col-span-4">Created</div>
                  <div className="col-span-4">Quote</div>
                  <div className="col-span-4 text-right">Status</div>
                </div>

                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {(quotesResp as any).quotes.slice(0, 10).map((q: any) => {
                    const statusRaw = (q.renderStatus || "").toString().toLowerCase();
                    const statusPill =
                      statusRaw === "rendered"
                        ? pill("Rendered", "green")
                        : statusRaw === "failed"
                          ? pill("Render failed", "red")
                          : statusRaw === "queued" || statusRaw === "running"
                            ? pill("Rendering", "blue")
                            : pill("Estimate", "gray");

                    const price =
                      typeof q.estimateLow === "number" || typeof q.estimateHigh === "number"
                        ? `${money(q.estimateLow)}${q.estimateHigh != null ? `–${money(q.estimateHigh)}` : ""}`
                        : "";

                    return (
                      <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                        <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">{fmtDate(q.createdAt)}</div>

                        <div className="col-span-4 font-mono text-xs text-gray-700 dark:text-gray-300">
                          {shortId(q.id)}
                        </div>

                        <div className="col-span-4 flex items-center justify-end gap-3">
                          {price ? <div className="text-xs text-gray-700 dark:text-gray-300">{price}</div> : null}
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
          </div>
        </section>
      </div>
    </main>
  );
}
