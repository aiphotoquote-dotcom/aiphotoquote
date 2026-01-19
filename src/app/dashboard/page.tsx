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
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
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

function renderTone(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "rendered") return "green";
  if (s === "failed") return "red";
  if (s === "queued" || s === "running") return "blue";
  return "gray";
}

function renderLabel(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "rendered") return "Rendered";
  if (s === "failed") return "Render failed";
  if (s === "queued" || s === "running") return "Rendering";
  if (s === "not_requested") return "Estimate";
  return s ? s : "Estimate";
}

function StatCard(props: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            {props.label}
          </div>
          <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {props.value}
          </div>
          {props.hint ? (
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {props.hint}
            </div>
          ) : null}
        </div>
        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [copied, setCopied] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

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

    // minimal "ready"
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

  const quoteStats = useMemo(() => {
    const ok = quotesResp && "ok" in quotesResp && quotesResp.ok;
    const quotes = ok ? quotesResp.quotes : [];

    const total = quotes.length;

    const rendered = quotes.filter((q) => (q.renderStatus || "").toLowerCase() === "rendered").length;
    const failed = quotes.filter((q) => (q.renderStatus || "").toLowerCase() === "failed").length;
    const rendering = quotes.filter((q) => {
      const s = (q.renderStatus || "").toLowerCase();
      return s === "queued" || s === "running";
    }).length;

    // Show “avg estimate” only if we have numbers
    const mids: number[] = [];
    for (const q of quotes) {
      const lo = typeof q.estimateLow === "number" ? q.estimateLow : null;
      const hi = typeof q.estimateHigh === "number" ? q.estimateHigh : null;
      const mid =
        lo != null && hi != null ? (lo + hi) / 2 : lo != null ? lo : hi != null ? hi : null;
      if (mid != null && !Number.isNaN(mid)) mids.push(mid);
    }
    const avg = mids.length ? Math.round(mids.reduce((a, b) => a + b, 0) / mids.length) : null;

    const latest = quotes[0] || null;

    return { total, rendered, failed, rendering, avg, latest, quotes };
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

  const setupTone = loading ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = loading ? "Loading…" : computed.isReady ? "Ready" : "Finish setup";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* HEADER */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm font-bold shadow-sm dark:border-gray-800 dark:bg-gray-950">
                AQ
              </div>
              <div>
                <h1 className="text-2xl font-semibold">
                  {computed.tenantName || (loading ? "Loading…" : "Dashboard")}
                </h1>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {computed.tenantSlug ? (
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      /{computed.tenantSlug}
                    </span>
                  ) : (
                    <span>Tenant command center</span>
                  )}
                  {computed.industryKey ? (
                    <span className="ml-2">{pill(computed.industryKey, "gray")}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
              Your tenant’s share link, recent activity, and the stuff you’ll actually use.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {pill(setupLabel, setupTone as any)}
            <Link
              href="/admin/quotes"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
            >
              View quotes
            </Link>

            {!computed.isReady ? (
              <Link
                href="/onboarding"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Finish setup
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setShowSetup((s) => !s)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
              >
                {showSetup ? "Hide setup" : "Setup"}
              </button>
            )}
          </div>
        </div>

        {/* MODE A: NOT READY */}
        {!computed.isReady ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-3xl border border-yellow-200 bg-yellow-50 p-6 shadow-sm dark:border-yellow-900/40 dark:bg-yellow-950/40">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-yellow-900 dark:text-yellow-200">
                    Publish your tenant quote page
                  </div>
                  <div className="mt-1 text-sm text-yellow-900/80 dark:text-yellow-200/80">
                    Set your tenant slug + industry. (OpenAI key is configured in Admin setup.)
                  </div>
                </div>

                <Link
                  href="/onboarding"
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Open Settings
                </Link>
              </div>

              <div className="mt-5 rounded-2xl border border-yellow-200 bg-white p-5 dark:border-yellow-900/30 dark:bg-black/30">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Setup checklist
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-center justify-between">
                    <span className="text-gray-800 dark:text-gray-200">
                      <span className="mr-2">{computed.hasSlug ? "✅" : "⬜️"}</span>
                      Tenant slug
                    </span>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      {computed.tenantSlug || "—"}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-gray-800 dark:text-gray-200">
                      <span className="mr-2">{computed.hasIndustry ? "✅" : "⬜️"}</span>
                      Industry key
                    </span>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      {computed.industryKey || "—"}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-gray-800 dark:text-gray-200">
                      <span className="mr-2">{computed.redirectUrl ? "✅" : "⬜️"}</span>
                      Redirect URL
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Optional</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-gray-800 dark:text-gray-200">
                      <span className="mr-2">{computed.thankYouUrl ? "✅" : "⬜️"}</span>
                      Thank-you URL
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Optional</span>
                  </li>
                </ul>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href="/admin/setup/openai"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                  >
                    OpenAI setup
                  </Link>
                  <Link
                    href="/admin/setup/ai-policy"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                  >
                    AI policy
                  </Link>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold">Public link (preview)</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Once setup is complete, share this with customers:
              </div>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm dark:border-gray-800 dark:bg-gray-900/40">
                {computed.publicPath}
              </div>
              <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                Tip: pick a clean slug like <span className="font-mono">maggioupholstery</span>.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* MODE B: READY (CENTERPIECE) */}

            {/* Centerpiece: Share + Open */}
            <div className="rounded-3xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-6 shadow-sm dark:border-gray-800 dark:from-black dark:to-gray-950">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    {pill("Public link", "green")}
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Share this with customers
                    </span>
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Path</div>
                    <div className="mt-1 font-mono text-base text-gray-900 dark:text-gray-100">
                      {computed.publicPath}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href={computed.publicPath}
                        className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Open quote page
                      </Link>

                      <button
                        type="button"
                        onClick={copyPublicLink}
                        className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                      >
                        {copied ? "Copied ✅" : "Copy link"}
                      </button>

                      <Link
                        href="/onboarding"
                        className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                      >
                        Edit settings
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
                    Next step: add an <span className="font-semibold">Embed widget</span> section here (1-click copy script).
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid w-full gap-4 sm:max-w-sm">
                  <StatCard
                    label="Recent quotes"
                    value={quotesLoading ? "—" : quoteStats.total}
                    hint="Last 10 activity"
                    right={quotesLoading ? pill("Loading…", "gray") : pill("Live", "green")}
                  />
                  <StatCard
                    label="Avg estimate (recent)"
                    value={quoteStats.avg != null ? money(quoteStats.avg) : "—"}
                    hint="Based on available ranges"
                  />
                </div>
              </div>
            </div>

            {/* Optional collapsed setup panel */}
            {showSetup ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Setup (collapsed)</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      You’re ready — this is here only if you need to revisit.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSetup(false)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Tenant slug</div>
                    <div className="mt-1 font-mono">{computed.tenantSlug}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Industry key</div>
                    <div className="mt-1 font-mono">{computed.industryKey}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Redirect URL</div>
                    <div className="mt-1 break-all">{computed.redirectUrl || "—"}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Thank-you URL</div>
                    <div className="mt-1 break-all">{computed.thankYouUrl || "—"}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Activity grid */}
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Recent quotes list */}
              <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Recent quotes</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      Latest customer activity (last 10).
                    </div>
                  </div>
                  <Link
                    href="/admin/quotes"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                  >
                    Open admin
                  </Link>
                </div>

                <div className="mt-5">
                  {quotesLoading ? (
                    <div className="text-sm text-gray-600 dark:text-gray-300">Loading…</div>
                  ) : quotesResp && "ok" in quotesResp && quotesResp.ok ? (
                    quoteStats.quotes.length ? (
                      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                        <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                          <div className="col-span-4">Created</div>
                          <div className="col-span-5">Quote</div>
                          <div className="col-span-3 text-right">Status</div>
                        </div>

                        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                          {quoteStats.quotes.map((q) => {
                            const est =
                              typeof q.estimateLow === "number" || typeof q.estimateHigh === "number"
                                ? `${money(q.estimateLow)}${q.estimateHigh != null ? ` – ${money(q.estimateHigh)}` : ""}`
                                : "";

                            return (
                              <li
                                key={q.id}
                                className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/40"
                              >
                                <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                                  {fmtDate(q.createdAt)}
                                </div>

                                <div className="col-span-5">
                                  <div className="font-mono text-xs text-gray-700 dark:text-gray-300">
                                    {q.id}
                                  </div>
                                  {est ? (
                                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                      {est}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="col-span-3 flex justify-end">
                                  {pill(renderLabel(q.renderStatus), renderTone(q.renderStatus) as any)}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-200">
                        <div className="font-semibold">No quotes yet</div>
                        <div className="mt-1 text-gray-600 dark:text-gray-300">
                          Share your public link and you’ll see activity here.
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <Link
                            href={computed.publicPath}
                            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                          >
                            Open public quote page
                          </Link>
                          <button
                            type="button"
                            onClick={copyPublicLink}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                          >
                            Copy share link
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                      Couldn’t load recent quotes yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Right rail: Quick actions + render status */}
              <div className="grid gap-6">
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                  <div className="text-sm font-semibold">Quick actions</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Common tenant tasks.
                  </div>

                  <div className="mt-4 grid gap-3">
                    <Link
                      href={computed.publicPath}
                      className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Open public quote page
                    </Link>

                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                    >
                      {copied ? "Copied ✅" : "Copy share link"}
                    </button>

                    <Link
                      href="/admin/setup/openai"
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                    >
                      Verify OpenAI key
                    </Link>

                    <Link
                      href="/admin/setup/ai-policy"
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                    >
                      Edit AI policy
                    </Link>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                  <div className="text-sm font-semibold">Rendering status</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    What’s happening in the last 10.
                  </div>

                  <div className="mt-4 grid gap-3">
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
                      <span className="text-sm text-gray-700 dark:text-gray-200">Rendered</span>
                      <span className="text-sm font-semibold">{quoteStats.rendered}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
                      <span className="text-sm text-gray-700 dark:text-gray-200">Rendering</span>
                      <span className="text-sm font-semibold">{quoteStats.rendering}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
                      <span className="text-sm text-gray-700 dark:text-gray-200">Failed</span>
                      <span className="text-sm font-semibold">{quoteStats.failed}</span>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    Next: we can add an “embed widget” tile here.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
