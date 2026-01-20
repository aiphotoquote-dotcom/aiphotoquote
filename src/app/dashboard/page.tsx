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

type WeekCounts = {
  quotes: number;
  renderOptIns: number;
  rendered: number;
  renderFailures: number;
};

type WeeklyMetricsResp =
  | {
      ok: true;
      thisWeek?: Partial<WeekCounts> | null;
      lastWeek?: Partial<WeekCounts> | null;

      // legacy/alternate shapes we may have used before
      this_week?: Partial<WeekCounts> | null;
      last_week?: Partial<WeekCounts> | null;
      weekly?: { thisWeek?: Partial<WeekCounts> | null; lastWeek?: Partial<WeekCounts> | null } | null;

      // meta is optional (new)
      meta?: {
        tenantId?: string;
        timeZone?: string;
        weekStartsOn?: string;
        thisWeekStart?: string;
        thisWeekEnd?: string;
        lastWeekStart?: string;
        lastWeekEnd?: string;
      } | null;
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

function fmtShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function clampInt(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function pctDelta(curr: number, prev: number) {
  if (prev <= 0) {
    if (curr <= 0) return { label: "—", tone: "gray" as const };
    return { label: "new", tone: "blue" as const };
  }
  const p = Math.round(((curr - prev) / prev) * 100);
  if (p === 0) return { label: "0%", tone: "gray" as const };
  if (p > 0) return { label: `+${p}%`, tone: "green" as const };
  return { label: `${p}%`, tone: "red" as const };
}

function renderStatusPill(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");
  return pill("Estimate", "gray");
}

function normalizeWeekly(resp: WeeklyMetricsResp | null): {
  ready: boolean;
  thisWeek: WeekCounts;
  lastWeek: WeekCounts;
  meta: {
    timeZone?: string;
    weekStartsOn?: string;
    thisWeekStart?: string;
    thisWeekEnd?: string;
  };
} {
  const zero: WeekCounts = { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 };

  if (!resp || !("ok" in resp) || !resp.ok) {
    return { ready: false, thisWeek: zero, lastWeek: zero, meta: {} };
  }

  // Prefer the current API shape first
  const a =
    (resp as any).thisWeek ??
    (resp as any).weekly?.thisWeek ??
    (resp as any).this_week ??
    (resp as any).weekly?.thisWeek ??
    null;

  const b =
    (resp as any).lastWeek ??
    (resp as any).weekly?.lastWeek ??
    (resp as any).last_week ??
    (resp as any).weekly?.lastWeek ??
    null;

  const meta = (resp as any).meta ?? {};

  // If the API is ok:true but missing payload, treat as not-ready
  if (!a && !b) {
    return { ready: false, thisWeek: zero, lastWeek: zero, meta };
  }

  const tw: WeekCounts = {
    quotes: clampInt(a?.quotes),
    renderOptIns: clampInt(a?.renderOptIns ?? a?.render_opt_ins ?? a?.render_optins),
    rendered: clampInt(a?.rendered),
    renderFailures: clampInt(a?.renderFailures ?? a?.render_failures),
  };

  const lw: WeekCounts = {
    quotes: clampInt(b?.quotes),
    renderOptIns: clampInt(b?.renderOptIns ?? b?.render_opt_ins ?? b?.render_optins),
    rendered: clampInt(b?.rendered),
    renderFailures: clampInt(b?.renderFailures ?? b?.render_failures),
  };

  return { ready: true, thisWeek: tw, lastWeek: lw, meta };
}

export default function Dashboard() {
  const [meLoading, setMeLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [weeklyResp, setWeeklyResp] = useState<WeeklyMetricsResp | null>(null);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
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

    loadMe();
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

    async function loadWeekly() {
      try {
        const res = await fetch("/api/tenant/metrics-week", { cache: "no-store" });
        const json: WeeklyMetricsResp = await res.json();
        if (!cancelled) setWeeklyResp(json);
      } catch {
        if (!cancelled) setWeeklyResp({ ok: false, error: "FETCH_FAILED" });
      } finally {
        if (!cancelled) setWeeklyLoading(false);
      }
    }

    loadWeekly();
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

    return { ok, tenantName, tenantSlug, hasSlug, hasIndustry, isReady, publicPath };
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

  const setupTone = meLoading ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = meLoading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup";

  const wk = normalizeWeekly(weeklyResp);
  const qCount = wk.thisWeek.quotes;
  const qPrev = wk.lastWeek.quotes;

  const windowLabel =
    wk.meta?.thisWeekStart && wk.meta?.thisWeekEnd
      ? `Week window: ${fmtShortDate(wk.meta.thisWeekStart)} – ${fmtShortDate(
          wk.meta.thisWeekEnd
        )} · TZ: ${wk.meta.timeZone ?? "America/New_York"} · Starts: ${
          wk.meta.weekStartsOn ?? "monday"
        }`
      : `TZ: ${wk.meta.timeZone ?? "America/New_York"} · Starts: ${wk.meta.weekStartsOn ?? "monday"}`;

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

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Performance */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">This week performance</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Compared to last week. Counts only for now.
                </p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{windowLabel}</p>
              </div>

              <div className="flex items-center gap-2">
                {pill("Live", "blue")}
                {weeklyLoading ? pill("Loading…", "gray") : null}
              </div>
            </div>

            {!weeklyLoading && wk.ready ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  { title: "Quotes", curr: wk.thisWeek.quotes, prev: wk.lastWeek.quotes },
                  { title: "Render opt-ins", curr: wk.thisWeek.renderOptIns, prev: wk.lastWeek.renderOptIns },
                  { title: "Rendered", curr: wk.thisWeek.rendered, prev: wk.lastWeek.rendered },
                  { title: "Render failures", curr: wk.thisWeek.renderFailures, prev: wk.lastWeek.renderFailures },
                ].map((m) => {
                  const d = pctDelta(m.curr, m.prev);
                  return (
                    <div
                      key={m.title}
                      className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black"
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {m.title}
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <div className="text-3xl font-semibold">{m.curr}</div>
                        {pill(d.label, d.tone)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Last week: <span className="font-semibold">{m.prev}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                Weekly metrics not available yet.
              </div>
            )}

            {/* Small nudge row */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm dark:border-gray-800 dark:bg-black">
              <div className="text-gray-700 dark:text-gray-300">
                {wk.ready ? (
                  <>
                    You’ve got <b>{qCount}</b> quote{s(qCount)} so far this week
                    {qPrev > 0 ? (
                      <>
                        {" "}
                        (last week: <b>{qPrev}</b>).
                      </>
                    ) : (
                      <>.</>
                    )}
                  </>
                ) : (
                  <>Run a few quotes to start seeing performance trends.</>
                )}
              </div>

              <Link
                href="/admin/quotes"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-white dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Review quotes
              </Link>
            </div>
          </section>

          {/* Public link */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Public quote page</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Share this with customers.
                </p>
              </div>
              {computed.tenantSlug ? null : pill("Needs slug", "yellow")}
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs text-gray-500">Path</div>
              <div className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                {computed.publicPath}
              </div>
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
                  Set slug in Settings
                </Link>
              )}
            </div>

            <div className="mt-4 text-xs text-gray-600 dark:text-gray-400">
              Tip: do one full end-to-end test (estimate + optional render).
            </div>
          </section>
        </div>

        {/* Recent Quotes */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent quotes</h2>
            {quotesLoading ? pill("Loading…", "gray") : null}
          </div>

          {!quotesLoading && quotesResp && "ok" in quotesResp && quotesResp.ok ? (
            quotesResp.quotes.length ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
                  <div className="col-span-4">Created</div>
                  <div className="col-span-5">Quote ID</div>
                  <div className="col-span-3 text-right">Status</div>
                </div>

                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {quotesResp.quotes.map((q) => (
                    <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                      <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                        {fmtDate(q.createdAt)}
                      </div>

                      <div className="col-span-5 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {q.id}
                      </div>

                      <div className="col-span-3 flex items-center justify-end gap-3">
                        {typeof q.estimateLow === "number" || typeof q.estimateHigh === "number" ? (
                          <div className="text-xs text-gray-700 dark:text-gray-300">
                            {money(q.estimateLow)}{" "}
                            {q.estimateHigh != null ? `– ${money(q.estimateHigh)}` : ""}
                          </div>
                        ) : null}

                        {renderStatusPill(q.renderStatus)}
                      </div>
                    </li>
                  ))}
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
    </main>
  );
}

function s(n: number) {
  return n === 1 ? "" : "s";
}
