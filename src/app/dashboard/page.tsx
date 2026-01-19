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

type WeeklyPerformanceResp =
  | {
      ok: true;
      live?: boolean;
      thisWeek: {
        quotes: number;
        renderOptIns: number;
        rendered: number;
        renderFailures: number;
      };
      lastWeek: {
        quotes: number;
        renderOptIns: number;
        rendered: number;
        renderFailures: number;
      };
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
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pctDelta(thisWeek: number, lastWeek: number) {
  // Avoid ugly “-100%” noise when both are 0
  if (!lastWeek && !thisWeek) return { pct: null as number | null, dir: "flat" as const };
  if (!lastWeek && thisWeek > 0) return { pct: 100, dir: "up" as const };
  const pct = ((thisWeek - lastWeek) / Math.max(1, lastWeek)) * 100;
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { pct, dir };
}

function DeltaPill({
  thisWeek,
  lastWeek,
  positiveIsGood = true,
}: {
  thisWeek: number;
  lastWeek: number;
  positiveIsGood?: boolean;
}) {
  const d = pctDelta(thisWeek, lastWeek);

  if (d.pct == null) {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        vs last week: —
      </span>
    );
  }

  const pct = Math.round(d.pct);
  const isUp = d.dir === "up";
  const isDown = d.dir === "down";

  // tone: green for good direction, red for bad direction, gray if flat
  let tone: "green" | "red" | "gray" = "gray";
  if (isUp) tone = positiveIsGood ? "green" : "red";
  if (isDown) tone = positiveIsGood ? "red" : "green";

  const arrow = isUp ? "▲" : isDown ? "▼" : "•";
  const label = `${arrow} ${Math.abs(pct)}%`;

  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", cls)}>
      {label}
    </span>
  );
}

function StatTile({
  label,
  value,
  subLeft,
  subRight,
}: {
  label: string;
  value: React.ReactNode;
  subLeft?: React.ReactNode;
  subRight?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        {value}
      </div>
      {(subLeft || subRight) ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">{subLeft}</div>
          <div className="shrink-0">{subRight}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [perfLoading, setPerfLoading] = useState(true);
  const [perfResp, setPerfResp] = useState<WeeklyPerformanceResp | null>(null);

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

    async function loadPerf() {
      try {
        // Optional endpoint — dashboard still works if it doesn't exist.
        const res = await fetch("/api/tenant/weekly-performance", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const json: WeeklyPerformanceResp = await res.json();
        if (!cancelled) setPerfResp(json);
      } catch {
        // graceful fallback
        if (!cancelled) setPerfResp({ ok: false, error: "NOT_AVAILABLE" });
      } finally {
        if (!cancelled) setPerfLoading(false);
      }
    }

    loadPerf();
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
    if (!computed.tenantSlug) return;

    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

    const full = origin ? `${origin}${computed.publicPath}` : computed.publicPath;

    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const setupTone = loading ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = loading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup";

  const perfOk = Boolean(perfResp && "ok" in perfResp && perfResp.ok);
  const live = perfOk ? Boolean((perfResp as any).live) : false;

  const thisWeek = perfOk
    ? (perfResp as any).thisWeek
    : { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 };

  const lastWeek = perfOk
    ? (perfResp as any).lastWeek
    : { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 };

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
                  <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
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
                computed.isReady
                  ? "border border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  : "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </Link>
          </div>
        </div>

        {/* C1: This week performance (centerpiece card) */}
        <section className="rounded-3xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-6 dark:border-gray-800 dark:from-gray-950 dark:to-black">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">This week performance</h2>
                {perfLoading ? pill("Loading…", "gray") : null}
                {!perfLoading && perfOk && live ? pill("Live", "blue") : null}
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Compared to last week. Counts only for now.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {perfOk ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Last week baseline helps spot trend shifts fast.
                </span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Weekly metrics not available yet.
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Quotes"
              value={perfOk ? thisWeek.quotes : "—"}
              subLeft={perfOk ? `Last week: ${lastWeek.quotes}` : "—"}
              subRight={
                perfOk ? (
                  <DeltaPill thisWeek={thisWeek.quotes} lastWeek={lastWeek.quotes} positiveIsGood />
                ) : null
              }
            />

            <StatTile
              label="Render opt-ins"
              value={perfOk ? thisWeek.renderOptIns : "—"}
              subLeft={perfOk ? `Last week: ${lastWeek.renderOptIns}` : "—"}
              subRight={
                perfOk ? (
                  <DeltaPill
                    thisWeek={thisWeek.renderOptIns}
                    lastWeek={lastWeek.renderOptIns}
                    positiveIsGood
                  />
                ) : null
              }
            />

            <StatTile
              label="Rendered"
              value={perfOk ? thisWeek.rendered : "—"}
              subLeft={perfOk ? `Last week: ${lastWeek.rendered}` : "—"}
              subRight={
                perfOk ? (
                  <DeltaPill thisWeek={thisWeek.rendered} lastWeek={lastWeek.rendered} positiveIsGood />
                ) : null
              }
            />

            <StatTile
              label="Render failures"
              value={perfOk ? thisWeek.renderFailures : "—"}
              subLeft={perfOk ? `Last week: ${lastWeek.renderFailures}` : "—"}
              subRight={
                perfOk ? (
                  <DeltaPill
                    thisWeek={thisWeek.renderFailures}
                    lastWeek={lastWeek.renderFailures}
                    // for failures, DOWN is good
                    positiveIsGood={false}
                  />
                ) : null
              }
            />
          </div>
        </section>

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Public quote page */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="font-semibold">Public quote page</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Share this with customers.
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="text-xs text-gray-500 dark:text-gray-400">Path</div>
                <div className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                  {computed.publicPath}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
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

              <div className="text-xs text-gray-600 dark:text-gray-300">
                Tip: do one full end-to-end test (estimate + optional render).
              </div>
            </div>
          </section>

          {/* Recent quotes */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent quotes</h2>
              {quotesLoading ? pill("Loading…", "gray") : null}
            </div>

            {!quotesLoading && quotesResp && "ok" in quotesResp && quotesResp.ok ? (
              quotesResp.quotes.length ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                    <div className="col-span-4">Created</div>
                    <div className="col-span-5">Quote ID</div>
                    <div className="col-span-3 text-right">Status</div>
                  </div>

                  <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                    {quotesResp.quotes.map((q) => {
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
                          <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                            {fmtDate(q.createdAt)}
                          </div>

                          <div className="col-span-5 font-mono text-xs text-gray-700 dark:text-gray-300">
                            {q.id}
                          </div>

                          <div className="col-span-3 flex items-center justify-end gap-3">
                            {typeof q.estimateLow === "number" ||
                            typeof q.estimateHigh === "number" ? (
                              <div className="text-xs text-gray-700 dark:text-gray-300">
                                {money(q.estimateLow)}{" "}
                                {q.estimateHigh != null ? `– ${money(q.estimateHigh)}` : ""}
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
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
                  No quotes yet. Run a test quote.
                </p>
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
