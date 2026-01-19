// src/app/dashboard/page.tsx
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
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

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
  const x =
    typeof n === "number"
      ? n
      : n == null
        ? null
        : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function Dashboard() {
  const [meLoading, setMeLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [copied, setCopied] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        if (!cancelled) setMeLoading(false);
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

    // Minimal “ready” for now
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

  const perf = useMemo(() => {
    // We only have "recent" quotes. We'll compute "last 7 days" from what we got.
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const quotes =
      quotesResp && "ok" in quotesResp && quotesResp.ok ? quotesResp.quotes : [];

    const weekQuotes = quotes.filter((q) => {
      const t = new Date(q.createdAt).getTime();
      if (Number.isNaN(t)) return false;
      return t >= weekAgo;
    });

    let count = weekQuotes.length;

    let sumLow = 0;
    let sumHigh = 0;
    let haveAnyEstimate = false;

    let rendered = 0;
    let optedIn = 0;
    let inspections = 0;

    for (const q of weekQuotes) {
      const low = typeof q.estimateLow === "number" ? q.estimateLow : null;
      const high = typeof q.estimateHigh === "number" ? q.estimateHigh : null;

      if (low != null || high != null) {
        haveAnyEstimate = true;
        if (low != null) sumLow += low;
        if (high != null) sumHigh += high;
        // If one side missing, try to approximate so the range isn’t empty.
        if (low == null && high != null) sumLow += high;
        if (high == null && low != null) sumHigh += low;
      }

      if (q.inspectionRequired) inspections += 1;

      const status = (q.renderStatus || "").toString().toLowerCase();
      if (q.renderOptIn) optedIn += 1;
      if (status === "rendered" || Boolean(q.renderImageUrl)) rendered += 1;
    }

    const renderRate = count > 0 ? rendered / count : 0;
    const optInRate = count > 0 ? optedIn / count : 0;
    const inspectionRate = count > 0 ? inspections / count : 0;

    const revenueLow = haveAnyEstimate ? sumLow : null;
    const revenueHigh = haveAnyEstimate ? sumHigh : null;

    // Data coverage disclaimer (because endpoint is "recent")
    const coverageNote =
      quotes.length < 25
        ? "Based on your most recent quotes."
        : "Based on recent activity.";

    return {
      count,
      revenueLow,
      revenueHigh,
      rendered,
      renderRate,
      optInRate,
      inspections,
      inspectionRate,
      weekQuotes,
      coverageNote,
    };
  }, [quotesResp]);

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
      setCopied(false);
    }
  }

  const setupTone = meLoading ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = meLoading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup";

  const renderRatePct = Math.round(clamp(perf.renderRate, 0, 1) * 100);
  const optInRatePct = Math.round(clamp(perf.optInRate, 0, 1) * 100);
  const inspectionRatePct = Math.round(clamp(perf.inspectionRate, 0, 1) * 100);

  const revenueRange =
    perf.revenueLow != null || perf.revenueHigh != null
      ? `${money(perf.revenueLow)}${perf.revenueHigh != null ? ` – ${money(perf.revenueHigh)}` : ""}`
      : "—";

  const embedSnippet = computed.tenantSlug
    ? `<script async src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-tenant="${computed.tenantSlug}"></script>`
    : `<script async src="https://your-domain/widget.js" data-tenant="<tenant-slug>"></script>`;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">Dashboard</h1>
              {pill(setupLabel, setupTone as any)}
            </div>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This week at a glance — requests, estimated value, and rendering adoption.
            </p>

            {computed.tenantName ? (
              <div className="mt-3 text-sm text-gray-800 dark:text-gray-200">
                Tenant: <span className="font-semibold">{computed.tenantName}</span>
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                    ({computed.tenantSlug})
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
            >
              Utilities
            </button>

            <Link
              href="/admin/quotes"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              View quotes
            </Link>
          </div>
        </div>

        {/* Not ready banner */}
        {!meLoading && !computed.isReady ? (
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold">Finish setup to unlock your public quote page</div>
                <div className="mt-1 text-sm opacity-90">
                  Add a tenant slug + industry. Everything else is optional.
                </div>
              </div>
              <Link
                href="/onboarding"
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Open settings
              </Link>
            </div>
          </div>
        ) : null}

        {/* Utilities Drawer */}
        {drawerOpen ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              {/* Share */}
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Share</h2>
                  {computed.tenantSlug ? (
                    <div className="flex gap-2">
                      <Link
                        href={computed.publicPath}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                      >
                        Open quote page
                      </Link>
                      <button
                        type="button"
                        onClick={copyPublicLink}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                      >
                        {copied ? "Copied!" : "Copy link"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="text-xs text-gray-500">Public path</div>
                  <div className="mt-1 font-mono text-sm text-gray-800 dark:text-gray-200">
                    {computed.publicPath}
                  </div>
                </div>

                {!computed.tenantSlug ? (
                  <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    Set a tenant slug in <Link className="underline" href="/onboarding">Settings</Link> to enable sharing.
                  </div>
                ) : null}
              </div>

              {/* Embed */}
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Embed (later)</h2>
                  <Link
                    href="/onboarding"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    Settings
                  </Link>
                </div>

                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  When you’re ready, you’ll drop a snippet on your website. We’ll ship the widget endpoint next.
                </p>

                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="text-xs text-gray-500">Example snippet</div>
                  <pre className="mt-2 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
{embedSnippet}
                  </pre>
                  <div className="mt-2 text-xs text-gray-500">
                    Not live yet — this is placeholder so the dashboard feels complete.
                  </div>
                </div>
              </div>

              {/* Setup quick links */}
              <div className="w-full lg:w-[240px]">
                <h2 className="font-semibold">Quick links</h2>
                <div className="mt-3 grid gap-2">
                  <Link
                    href="/onboarding"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    Tenant settings
                  </Link>
                  <Link
                    href="/admin/setup/openai"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    OpenAI setup
                  </Link>
                  <Link
                    href="/admin/setup/ai-policy"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    AI policy
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* Performance Hero */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">This week</h2>
                {quotesLoading ? pill("Loading…", "gray") : pill(perf.coverageNote, "gray")}
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                A simple summary your tenants actually care about.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {pill(`${optInRatePct}% opt-in`, optInRatePct >= 30 ? "blue" : "gray")}
              {pill(`${renderRatePct}% rendered`, renderRatePct >= 20 ? "green" : "gray")}
              {pill(`${inspectionRatePct}% inspections`, inspectionRatePct <= 30 ? "gray" : "yellow")}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-12">
            {/* Big metric: Requests */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black lg:col-span-4">
              <div className="text-xs font-semibold text-gray-500">New requests</div>
              <div className="mt-2 text-3xl font-semibold">{perf.count}</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Last 7 days
              </div>
            </div>

            {/* Big metric: Estimated value */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black lg:col-span-5">
              <div className="text-xs font-semibold text-gray-500">Estimated value</div>
              <div className="mt-2 text-2xl font-semibold">{revenueRange}</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Sum of estimate ranges (best effort)
              </div>
            </div>

            {/* Big metric: Rendered */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black lg:col-span-3">
              <div className="text-xs font-semibold text-gray-500">Renders delivered</div>
              <div className="mt-2 text-3xl font-semibold">{perf.rendered}</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {renderRatePct}% of requests
              </div>
            </div>

            {/* Secondary metrics */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950 lg:col-span-6">
              <div className="text-sm font-semibold">AI rendering adoption</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Customers opted-in: <span className="font-semibold">{optInRatePct}%</span>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                <div
                  className="h-2 rounded-full bg-gray-900 dark:bg-gray-100"
                  style={{ width: `${clamp(optInRatePct, 0, 100)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                This will improve as the widget + UX gets polished.
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950 lg:col-span-6">
              <div className="text-sm font-semibold">Inspection pressure</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Inspection required: <span className="font-semibold">{inspectionRatePct}%</span>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                <div
                  className="h-2 rounded-full bg-gray-900 dark:bg-gray-100"
                  style={{ width: `${clamp(inspectionRatePct, 0, 100)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Higher numbers may indicate unclear photos or complex jobs.
              </div>
            </div>
          </div>
        </section>

        {/* Recent activity (supporting, not focal) */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Recent activity</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                A quick view of what just came in.
              </p>
            </div>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Open Admin
            </Link>
          </div>

          {!quotesLoading && quotesResp && "ok" in quotesResp && quotesResp.ok ? (
            quotesResp.quotes.length ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
                  <div className="col-span-4">Created</div>
                  <div className="col-span-5">Quote</div>
                  <div className="col-span-3 text-right">Status</div>
                </div>

                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {quotesResp.quotes.slice(0, 10).map((q) => {
                    const statusRaw = (q.renderStatus || "").toString().toLowerCase();
                    const statusPill =
                      statusRaw === "rendered"
                        ? pill("Rendered", "green")
                        : statusRaw === "failed"
                          ? pill("Render failed", "red")
                          : statusRaw === "queued" || statusRaw === "running"
                            ? pill("Rendering", "blue")
                            : pill("Estimate", "gray");

                    const showRange =
                      typeof q.estimateLow === "number" || typeof q.estimateHigh === "number";
                    const rangeText = showRange
                      ? `${money(q.estimateLow)}${q.estimateHigh != null ? ` – ${money(q.estimateHigh)}` : ""}`
                      : "";

                    return (
                      <li
                        key={q.id}
                        className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 dark:hover:bg-black"
                      >
                        <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                          {fmtDate(q.createdAt)}
                        </div>

                        <div className="col-span-5">
                          <div className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {q.id}
                          </div>
                          {rangeText ? (
                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                              {rangeText}
                            </div>
                          ) : (
                            <div className="mt-1 text-sm text-gray-500">No estimate</div>
                          )}
                        </div>

                        <div className="col-span-3 flex items-center justify-end gap-2">
                          {statusPill}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                No quotes yet. Run a quick test from your{" "}
                <Link className="underline" href={computed.publicPath}>
                  public quote page
                </Link>
                .
              </div>
            )
          ) : (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              {quotesLoading ? "Loading recent quotes…" : "Couldn’t load recent quotes yet."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
