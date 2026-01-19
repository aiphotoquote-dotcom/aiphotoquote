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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

function deltaPct(now: number, prev: number) {
  if (prev <= 0 && now <= 0) return "0%";
  if (prev <= 0 && now > 0) return "+∞";
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function MetricCard(props: {
  title: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const tone = props.tone ?? "neutral";
  const cls =
    tone === "good"
      ? "border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/40"
      : tone === "warn"
        ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/40"
        : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950";

  return (
    <div className={cn("rounded-2xl border p-5", cls)}>
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
        {props.title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {props.value}
      </div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{props.sub}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "rendered"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : s === "failed"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        : s === "queued" || s === "running"
          ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
          : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  const label =
    s === "rendered"
      ? "Rendered"
      : s === "failed"
        ? "Render failed"
        : s === "queued" || s === "running"
          ? "Rendering"
          : "Estimate";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

export default function Dashboard() {
  const [meLoading, setMeLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

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
    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);
    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    const publicUrl = origin && tenantSlug ? `${origin}${publicPath}` : publicPath;

    return {
      ok,
      tenantName,
      tenantSlug,
      industryKey,
      isReady,
      publicPath,
      publicUrl,
    };
  }, [me]);

  const metrics = useMemo(() => {
    const listOk = Boolean(quotesResp && "ok" in quotesResp && (quotesResp as any).ok);
    const quotes = listOk ? (quotesResp as any).quotes : [];

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const startThis = now - 7 * day;
    const startLast = now - 14 * day;

    const thisWeek = quotes.filter((q: any) => {
      const t = new Date(q.createdAt).getTime();
      return !Number.isNaN(t) && t >= startThis && t <= now;
    });

    const lastWeek = quotes.filter((q: any) => {
      const t = new Date(q.createdAt).getTime();
      return !Number.isNaN(t) && t >= startLast && t < startThis;
    });

    function countRenderOptIns(arr: any[]) {
      return arr.filter((q) => Boolean(q.renderOptIn)).length;
    }
    function countRendered(arr: any[]) {
      return arr.filter((q) => String(q.renderStatus || "").toLowerCase() === "rendered").length;
    }
    function countFailed(arr: any[]) {
      return arr.filter((q) => String(q.renderStatus || "").toLowerCase() === "failed").length;
    }

    const tw = {
      quotes: thisWeek.length,
      optIns: countRenderOptIns(thisWeek),
      rendered: countRendered(thisWeek),
      failed: countFailed(thisWeek),
    };
    const lw = {
      quotes: lastWeek.length,
      optIns: countRenderOptIns(lastWeek),
      rendered: countRendered(lastWeek),
      failed: countFailed(lastWeek),
    };

    return { listOk, quotes, thisWeek: tw, lastWeek: lw };
  }, [quotesResp]);

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(computed.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const heroSubtitle =
    meLoading
      ? "Loading your tenant…"
      : computed.ok
        ? "Performance, recent activity, and your public quote link."
        : "Couldn’t load tenant context. Refresh and try again.";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Hero */}
        <section className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Dashboard</h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{heroSubtitle}</p>

              {computed.tenantName ? (
                <div className="mt-4 text-sm text-gray-800 dark:text-gray-200">
                  Tenant: <span className="font-semibold">{computed.tenantName}</span>
                  {computed.tenantSlug ? (
                    <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                      ({computed.tenantSlug})
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/quotes"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Review leads
              </Link>
              <Link
                href="/onboarding"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Settings
              </Link>
              {computed.tenantSlug ? (
                <Link
                  href={computed.publicPath}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Preview public page
                </Link>
              ) : null}
            </div>
          </div>

          {/* “Ready” strip (tiny, non-invasive) */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold",
                computed.isReady
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
                  : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
              )}
            >
              <span>{computed.isReady ? "✅" : "⬜️"}</span>
              <span>{computed.isReady ? "Ready" : "Setup needed"}</span>
              {!computed.isReady ? (
                <span className="opacity-80">
                  (set tenant slug + industry in Settings)
                </span>
              ) : null}
            </div>

            {/* Public link (still handy, not dominant) */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 font-mono text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                {computed.publicPath}
              </div>
              <button
                type="button"
                onClick={copyPublicLink}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                disabled={!computed.tenantSlug}
              >
                {copied ? "Copied ✅" : "Copy link"}
              </button>
            </div>
          </div>
        </section>

        {/* Metrics */}
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">This week performance</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Compared to last week (counts only for now).
              </p>
            </div>

            <div className="text-xs text-gray-500">
              {quotesLoading ? "Loading…" : metrics.listOk ? "Live" : "Unavailable"}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Quotes"
              value={quotesLoading ? "—" : String(metrics.thisWeek.quotes)}
              sub={
                quotesLoading
                  ? "—"
                  : `${deltaPct(metrics.thisWeek.quotes, metrics.lastWeek.quotes)} · Last week: ${metrics.lastWeek.quotes}`
              }
              tone={metrics.thisWeek.quotes > 0 ? "good" : "neutral"}
            />
            <MetricCard
              title="Render opt-ins"
              value={quotesLoading ? "—" : String(metrics.thisWeek.optIns)}
              sub={
                quotesLoading
                  ? "—"
                  : `${deltaPct(metrics.thisWeek.optIns, metrics.lastWeek.optIns)} · Last week: ${metrics.lastWeek.optIns}`
              }
              tone={metrics.thisWeek.optIns > 0 ? "good" : "neutral"}
            />
            <MetricCard
              title="Rendered"
              value={quotesLoading ? "—" : String(metrics.thisWeek.rendered)}
              sub={
                quotesLoading
                  ? "—"
                  : `${deltaPct(metrics.thisWeek.rendered, metrics.lastWeek.rendered)} · Last week: ${metrics.lastWeek.rendered}`
              }
              tone={metrics.thisWeek.rendered > 0 ? "good" : "neutral"}
            />
            <MetricCard
              title="Render failures"
              value={quotesLoading ? "—" : String(metrics.thisWeek.failed)}
              sub={
                quotesLoading
                  ? "—"
                  : `Last week: ${metrics.lastWeek.failed}`
              }
              tone={metrics.thisWeek.failed > 0 ? "warn" : "neutral"}
            />
          </div>
        </section>

        {/* Activity + Recent quotes */}
        <section className="grid gap-6 lg:grid-cols-3">
          {/* Activity panel */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <h2 className="font-semibold">What to do next</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              The fastest path to “live and confident”.
            </p>

            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-gray-200 bg-gray-50 text-center text-xs font-semibold leading-6 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                  1
                </div>
                <div>
                  <div className="font-semibold">Run a full test quote</div>
                  <div className="text-gray-600 dark:text-gray-300">
                    Do estimate + opt-in render to validate the end-to-end experience.
                  </div>
                </div>
              </li>

              <li className="flex gap-3">
                <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-gray-200 bg-gray-50 text-center text-xs font-semibold leading-6 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                  2
                </div>
                <div>
                  <div className="font-semibold">Add it to your website</div>
                  <div className="text-gray-600 dark:text-gray-300">
                    Use Settings → Embed Widget (copy/paste).
                  </div>
                </div>
              </li>

              <li className="flex gap-3">
                <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-gray-200 bg-gray-50 text-center text-xs font-semibold leading-6 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                  3
                </div>
                <div>
                  <div className="font-semibold">Review early leads</div>
                  <div className="text-gray-600 dark:text-gray-300">
                    Watch real usage and iterate pricing guardrails as needed.
                  </div>
                </div>
              </li>
            </ol>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Open Settings
              </Link>
              <Link
                href="/admin/quotes"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Review leads
              </Link>
            </div>
          </div>

          {/* Recent Quotes */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Recent activity</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Latest quotes for your tenant.
                </p>
              </div>

              <Link
                href="/admin/quotes"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                View all
              </Link>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
              <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                <div className="col-span-4">Created</div>
                <div className="col-span-5">Quote ID</div>
                <div className="col-span-3 text-right">Status</div>
              </div>

              {!quotesLoading && quotesResp && "ok" in quotesResp && quotesResp.ok ? (
                (quotesResp.quotes?.length ?? 0) ? (
                  <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                    {quotesResp.quotes.slice(0, 12).map((q) => (
                      <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                        <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                          {fmtDate(q.createdAt)}
                        </div>

                        <div className="col-span-5 font-mono text-xs text-gray-700 dark:text-gray-300">
                          {q.id}
                        </div>

                        <div className="col-span-3 flex items-center justify-end gap-3">
                          {typeof q.estimateLow === "number" || typeof q.estimateHigh === "number" ? (
                            <div className="hidden sm:block text-xs text-gray-600 dark:text-gray-300">
                              {money(q.estimateLow)}
                              {q.estimateHigh != null ? ` – ${money(q.estimateHigh)}` : ""}
                            </div>
                          ) : null}

                          <StatusPill status={q.renderStatus || ""} />

                          <Link
                            href={`/admin/quotes/${q.id}`}
                            className="ml-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                          >
                            Review
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-4 py-8 text-sm text-gray-600 dark:text-gray-300">
                    No quotes yet. Run a test quote from your public page.
                  </div>
                )
              ) : (
                <div className="px-4 py-8 text-sm text-gray-600 dark:text-gray-300">
                  {quotesLoading ? "Loading…" : "Couldn’t load recent quotes yet."}
                </div>
              )}
            </div>

            <div className="mt-4 text-xs text-gray-500">
              Tip: keep Dashboard focused on performance + activity. Setup + embed belong in Settings.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
