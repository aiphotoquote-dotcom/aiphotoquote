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
        createdAt?: string | null;
        created_at?: string | null;

        // DB columns you *do* have
        render_opt_in?: boolean | null;
        render_status?: string | null;
        render_image_url?: string | null;

        // Some routes may also return summarized fields (optional)
        estimateLow?: number | null;
        estimateHigh?: number | null;
        inspectionRequired?: boolean | null;

        // Sometimes people pack summary into output
        output?: any;
      }>;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function badge(ok: boolean) {
  return ok ? "✅" : "⬜️";
}

function fmtDt(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString();
}

function safeStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function getSummaryFromOutput(output: any) {
  // Try a few common paths without assuming schema.
  if (!output) return "";
  const candidates = [
    output.summary,
    output.assessment?.summary,
    output.assessment?.damage,
    output.assessment?.item,
    output.item,
  ];
  for (const c of candidates) {
    const s = safeStr(c).trim();
    if (s) return s;
  }
  return "";
}

export default function DashboardPage() {
  const [meLoading, setMeLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotes, setQuotes] = useState<RecentQuotesResp | null>(null);

  const [copied, setCopied] = useState(false);

  // --- load tenant/settings ---
  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();
        if (!cancelled) setMe(json);
      } catch (e: any) {
        if (!cancelled) setMe({ ok: false, error: "FETCH_FAILED", message: e?.message });
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- load recent quotes ---
  useEffect(() => {
    let cancelled = false;

    async function loadQuotes() {
      try {
        const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
        const json: RecentQuotesResp = await res.json();
        if (!cancelled) setQuotes(json);
      } catch (e: any) {
        if (!cancelled) setQuotes({ ok: false, error: "FETCH_FAILED", message: e?.message });
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

    const tenantName = safeStr(tenant?.name);
    const tenantSlug = safeStr(tenant?.slug);

    const industryKey = safeStr(settings?.industry_key);
    const redirectUrl = safeStr(settings?.redirect_url);
    const thankYouUrl = safeStr(settings?.thank_you_url);

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    // Minimal “ready” for now (tighten later if you want)
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
      hasRedirect,
      hasThankYou,
      isReady,
      publicPath,
    };
  }, [me]);

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

  const recentRows = useMemo(() => {
    if (!quotes || !("ok" in quotes) || !quotes.ok) return [];
    return Array.isArray((quotes as any).quotes) ? (quotes as any).quotes : [];
  }, [quotes]);

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant status, share link, and recent activity.
            </p>
            {computed.tenantName ? (
              <p className="mt-2 text-xs text-gray-500">
                Tenant: <span className="font-mono">{computed.tenantName}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/onboarding"
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                computed.isReady ? "border border-gray-200 hover:bg-gray-50" : "bg-black text-white"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </Link>

            <Link
              href="/admin"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              Admin
            </Link>
          </div>
        </div>

        {/* Top cards */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Setup */}
          <div className="rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">Setup checklist</h2>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  meLoading
                    ? "border-gray-200 bg-gray-50 text-gray-800"
                    : computed.isReady
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-yellow-200 bg-yellow-50 text-yellow-900"
                )}
              >
                {meLoading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup"}
              </span>
            </div>

            {!meLoading && computed.ok ? (
              <ul className="mt-4 space-y-2 text-sm text-gray-800">
                <li>
                  {badge(computed.hasSlug)} Tenant slug{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.tenantSlug || "—"}
                  </span>
                </li>
                <li>
                  {badge(computed.hasIndustry)} Industry{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.industryKey || "—"}
                  </span>
                </li>
                <li>{badge(computed.hasRedirect)} Redirect URL (optional)</li>
                <li>{badge(computed.hasThankYou)} Thank-you URL (optional)</li>
              </ul>
            ) : (
              <div className="mt-4 text-sm text-gray-600">
                {meLoading ? (
                  <p>Loading your tenant…</p>
                ) : (
                  <>
                    <p className="font-semibold text-gray-800">Couldn’t load settings</p>
                    <p className="mt-1">
                      {safeStr((me as any)?.message) || "Failed to load tenant settings."}
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                      onClick={() => window.location.reload()}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Open onboarding
              </Link>
              <Link
                href="/admin/setup/openai"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                OpenAI setup
              </Link>
              <Link
                href="/admin/setup/ai-policy"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                AI policy
              </Link>
            </div>
          </div>

          {/* Public link */}
          <div className="rounded-2xl border border-gray-200 p-6">
            <h2 className="font-semibold">Public quote page</h2>
            <p className="mt-2 text-sm text-gray-600">
              This is what customers use. Share it when setup is complete.
            </p>

            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Path</div>
              <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {computed.tenantSlug ? (
                <>
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open quote page
                  </Link>
                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </>
              ) : (
                <Link
                  href="/onboarding"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                >
                  Set tenant slug first
                </Link>
              )}
            </div>

            <div className="mt-6 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold">Quick runbook</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Finish onboarding (slug + industry)</li>
                <li>Confirm tenant OpenAI key is set</li>
                <li>Run one test quote end-to-end</li>
                <li>Confirm lead email + customer receipt + (optional) render email</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Recent quotes */}
        <div className="rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Recent quotes</h2>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              View all (admin)
            </Link>
          </div>

          {quotesLoading ? (
            <p className="mt-4 text-sm text-gray-600">Loading recent quotes…</p>
          ) : quotes && "ok" in quotes && quotes.ok ? (
            recentRows.length ? (
              <div className="mt-4 overflow-auto rounded-xl border border-gray-200">
                <table className="min-w-[900px] w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Quote ID</th>
                      <th className="px-4 py-3">Estimate</th>
                      <th className="px-4 py-3">Inspection</th>
                      <th className="px-4 py-3">Render</th>
                      <th className="px-4 py-3">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentRows.map((q: any) => {
                      const created = q.createdAt ?? q.created_at ?? null;

                      const low = q.estimateLow ?? q.estimate_low ?? null;
                      const high = q.estimateHigh ?? q.estimate_high ?? null;

                      const insp =
                        q.inspectionRequired ?? q.inspection_required ?? null;

                      const renderOpt =
                        q.render_opt_in === true || q.renderOptIn === true;

                      const renderStatus = safeStr(
                        q.render_status ?? q.renderStatus ?? ""
                      );
                      const renderUrl = safeStr(
                        q.render_image_url ?? q.renderImageUrl ?? ""
                      );

                      const summary = getSummaryFromOutput(q.output);

                      return (
                        <tr key={q.id}>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                            {fmtDt(created) || "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-800">
                            {q.id}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {typeof low === "number" && typeof high === "number"
                              ? `$${low.toLocaleString()} – $${high.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {insp === true ? "Yes" : insp === false ? "No" : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-700">
                                {renderOpt ? "On" : "Off"}
                              </span>
                              {renderOpt ? (
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-xs font-semibold",
                                    renderStatus === "rendered"
                                      ? "border-green-200 bg-green-50 text-green-800"
                                      : renderStatus === "failed"
                                        ? "border-red-200 bg-red-50 text-red-800"
                                        : renderStatus
                                          ? "border-gray-200 bg-gray-50 text-gray-800"
                                          : "border-gray-200 bg-gray-50 text-gray-800"
                                  )}
                                >
                                  {renderStatus || "queued"}
                                </span>
                              ) : null}
                              {renderUrl ? (
                                <a
                                  className="text-xs font-semibold underline"
                                  href={renderUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  image
                                </a>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {summary ? (
                              <span className="line-clamp-2">{summary}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600">No quotes yet.</p>
            )
          ) : (
            <div className="mt-4 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Couldn’t load recent quotes</p>
              <p className="mt-1">
                {safeStr((quotes as any)?.message) || "Refresh and try again."}
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
