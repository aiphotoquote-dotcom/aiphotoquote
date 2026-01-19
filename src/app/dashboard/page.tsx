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
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        cls
      )}
    >
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

function CodeBox(props: {
  title: string;
  code: string;
  onCopy: () => void;
  copied: boolean;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{props.title}</div>
          {props.subtitle ? (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {props.subtitle}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={props.onCopy}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
        >
          {props.copied ? "Copied ✅" : "Copy"}
        </button>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

  const [origin, setOrigin] = useState<string>("");

  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedIframe, setCopiedIframe] = useState(false);

  const [showEmbed, setShowEmbed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

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

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);

    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";
    const publicFull = origin && tenantSlug ? `${origin}${publicPath}` : publicPath;

    const embedScriptSrc =
      origin && tenantSlug
        ? `${origin}/embed.js?tenant=${encodeURIComponent(tenantSlug)}`
        : `/embed.js?tenant=<tenant-slug>`;

    const iframeSrc =
      origin && tenantSlug ? `${origin}${publicPath}?embed=1` : `${publicPath}?embed=1`;

    const scriptSnippet = `<script async src="${embedScriptSrc}"></script>\n<div id="aiphotoquote-widget"></div>`;

    const iframeSnippet = `<iframe src="${iframeSrc}" style="width:100%;max-width:720px;height:860px;border:0;border-radius:16px;overflow:hidden;" loading="lazy"></iframe>`;

    return {
      ok,
      tenantName,
      tenantSlug,
      industryKey,
      hasSlug,
      hasIndustry,
      isReady,
      publicPath,
      publicFull,
      scriptSnippet,
      iframeSnippet,
    };
  }, [me, origin]);

  const quoteStats = useMemo(() => {
    const ok = quotesResp && "ok" in quotesResp && quotesResp.ok;
    const quotes = ok ? quotesResp.quotes : [];

    const total = quotes.length;

    const rendered = quotes.filter(
      (q) => (q.renderStatus || "").toLowerCase() === "rendered"
    ).length;
    const failed = quotes.filter(
      (q) => (q.renderStatus || "").toLowerCase() === "failed"
    ).length;
    const rendering = quotes.filter((q) => {
      const s = (q.renderStatus || "").toLowerCase();
      return s === "queued" || s === "running";
    }).length;

    const mids: number[] = [];
    for (const q of quotes) {
      const lo = typeof q.estimateLow === "number" ? q.estimateLow : null;
      const hi = typeof q.estimateHigh === "number" ? q.estimateHigh : null;
      const mid =
        lo != null && hi != null ? (lo + hi) / 2 : lo != null ? lo : hi != null ? hi : null;
      if (mid != null && !Number.isNaN(mid)) mids.push(mid);
    }
    const avg = mids.length ? Math.round(mids.reduce((a, b) => a + b, 0) / mids.length) : null;

    const newestAt = quotes[0]?.createdAt ? quotes[0].createdAt : null;

    return { total, rendered, failed, rendering, avg, newestAt, quotes };
  }, [quotesResp]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function copyPublicLink() {
    if (!computed.tenantSlug) return;
    const ok = await copyText(computed.publicFull);
    if (!ok) return;
    setCopiedPublic(true);
    setTimeout(() => setCopiedPublic(false), 1200);
  }

  async function copyScript() {
    const ok = await copyText(computed.scriptSnippet);
    if (!ok) return;
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 1200);
  }

  async function copyIframe() {
    const ok = await copyText(computed.iframeSnippet);
    if (!ok) return;
    setCopiedIframe(true);
    setTimeout(() => setCopiedIframe(false), 1200);
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
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  {computed.tenantSlug ? (
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      /{computed.tenantSlug}
                    </span>
                  ) : (
                    <span>Tenant command center</span>
                  )}
                  {computed.industryKey ? pill(computed.industryKey, "gray") : null}
                </div>
              </div>
            </div>

            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
              Focus on what matters: activity, follow-up, and customer flow.
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
              <Link
                href={computed.publicPath}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Open quote page
              </Link>
            )}
          </div>
        </div>

        {/* NOT READY */}
        {!computed.isReady ? (
          <div className="rounded-3xl border border-yellow-200 bg-yellow-50 p-6 shadow-sm dark:border-yellow-900/40 dark:bg-yellow-950/40">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-yellow-900 dark:text-yellow-200">
                  Finish tenant setup
                </div>
                <div className="mt-1 text-sm text-yellow-900/80 dark:text-yellow-200/80">
                  Set tenant slug + industry to unlock the full dashboard experience.
                </div>
              </div>

              <Link
                href="/onboarding"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Open Settings
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* HERO: ACTIVITY */}
            <div className="rounded-3xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-6 shadow-sm dark:border-gray-800 dark:from-black dark:to-gray-950">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {pill("Activity", "green")}
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Your last 10 quotes
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                        Most recent
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {quoteStats.newestAt ? fmtDate(quoteStats.newestAt) : "—"}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                        Avg estimate
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {quoteStats.avg != null ? money(quoteStats.avg) : "—"}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                        Rendering
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {quoteStats.rendered} rendered · {quoteStats.rendering} running · {quoteStats.failed} failed
                      </div>
                    </div>
                  </div>

                  {/* Compact share strip */}
                  <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Share link
                        </div>
                        <div className="mt-1 truncate font-mono text-sm text-gray-900 dark:text-gray-100">
                          {computed.publicFull}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={copyPublicLink}
                          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                        >
                          {copiedPublic ? "Copied ✅" : "Copy"}
                        </button>
                        <Link
                          href="/onboarding"
                          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                        >
                          Settings
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/admin/quotes"
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                  >
                    Open Admin
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowEmbed((v) => !v)}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                  >
                    {showEmbed ? "Hide embed" : "Share & embed"}
                  </button>
                </div>
              </div>

              {/* EMBED DRAWER (collapsed by default) */}
              {showEmbed ? (
                <div className="mt-6 grid gap-4">
                  <div className="flex items-center gap-2">
                    {pill("Embed widget", "blue")}
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Use this only when you’re adding it to your website
                    </span>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <CodeBox
                      title="Option A — Script (recommended)"
                      subtitle="Paste near </body> and add the widget div where you want it."
                      code={computed.scriptSnippet}
                      onCopy={copyScript}
                      copied={copiedScript}
                    />
                    <CodeBox
                      title="Option B — iFrame (fallback)"
                      subtitle="Works anywhere; less flexible than the script."
                      code={computed.iframeSnippet}
                      onCopy={copyIframe}
                      copied={copiedIframe}
                    />
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                    <div className="font-semibold">Next step (we’ll implement)</div>
                    <div className="mt-1">
                      We’ll ship <span className="font-mono">/embed.js</span> so the script loads your widget automatically.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* BELOW HERO: RECENT QUOTES + RIGHT RAIL */}
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
                          Share your public link and activity will appear here.
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <Link
                            href={computed.publicPath}
                            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                          >
                            Open quote page
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

              {/* Right rail */}
              <div className="grid gap-6">
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
                      Open quote page
                    </Link>

                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
                    >
                      {copiedPublic ? "Copied ✅" : "Copy share link"}
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
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
