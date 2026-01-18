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

type RecentQuotesResponse =
  | { ok: true; quotes: any[] }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function item(ok: boolean) {
  return ok ? "✅" : "⬜️";
}

function safeStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDate(v: any) {
  const s = safeStr(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function fmtMoney(n: any) {
  const v = safeNum(n);
  if (v == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function pick<T = any>(obj: any, keys: string[]): T | null {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k] as T;
  }
  return null;
}

export default function Dashboard() {
  const [loadingMe, setLoadingMe] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [quotesErr, setQuotesErr] = useState<string | null>(null);

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
        if (!cancelled) setLoadingMe(false);
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
      setLoadingQuotes(true);
      setQuotesErr(null);

      try {
        const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
        const json: RecentQuotesResponse = await res.json();

        if (cancelled) return;

        if (!json || (json as any).ok !== true) {
          setQuotes([]);
          setQuotesErr(
            safeStr((json as any)?.message) || safeStr((json as any)?.error) || "Failed to load recent quotes."
          );
          return;
        }

        const q = Array.isArray((json as any).quotes) ? (json as any).quotes : [];
        setQuotes(q);
      } catch (e: any) {
        if (!cancelled) {
          setQuotes([]);
          setQuotesErr(e?.message ? String(e.message) : "Failed to load recent quotes.");
        }
      } finally {
        if (!cancelled) setLoadingQuotes(false);
      }
    }

    loadQuotes();

    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    const ok = Boolean(me && "ok" in me && (me as any).ok === true);
    const tenant = ok ? (me as any).tenant : null;
    const settings = ok ? (me as any).settings : null;

    const tenantName = safeStr(tenant?.name);
    const tenantSlug = safeStr(tenant?.slug);

    const industryKey = safeStr(settings?.industry_key);
    const redirectUrl = safeStr(settings?.redirect_url);
    const thankYouUrl = safeStr(settings?.thank_you_url);

    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    const isReady = hasIndustry; // tighten later if you want redirect required

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

    return {
      ok,
      tenantName,
      tenantSlug,
      industryKey,
      redirectUrl,
      thankYouUrl,
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

  function openTestQuote() {
    if (!computed.tenantSlug) return;
    if (typeof window === "undefined") return;
    window.open(computed.publicPath, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant status + shortcuts + recent quotes.
            </p>
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

            <button
              type="button"
              onClick={openTestQuote}
              disabled={!computed.tenantSlug}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-semibold",
                computed.tenantSlug ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
              )}
            >
              Test quote
            </button>
          </div>
        </div>

        {/* Setup banner */}
        <div
          className={cn(
            "rounded-2xl border p-4",
            loadingMe
              ? "border-gray-200 bg-gray-50"
              : computed.isReady
                ? "border-green-200 bg-green-50"
                : "border-yellow-200 bg-yellow-50"
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-semibold">
              {loadingMe
                ? "Loading your tenant…"
                : computed.isReady
                  ? "Setup complete ✅"
                  : "Setup incomplete ⚠️"}
            </div>
            <div className="text-sm text-gray-700">
              {loadingMe
                ? "Fetching settings…"
                : computed.isReady
                  ? "You’re ready to share your quote page."
                  : "Finish onboarding to set your tenant industry (minimum)."}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Setup checklist */}
          <div className="rounded-2xl border p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Setup checklist</h2>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  loadingMe
                    ? "border-gray-200 bg-gray-50 text-gray-700"
                    : computed.isReady
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-yellow-200 bg-yellow-50 text-yellow-900"
                )}
              >
                {loadingMe ? "Loading…" : computed.isReady ? "Ready" : "Needs setup"}
              </span>
            </div>

            {!loadingMe && computed.ok ? (
              <ul className="mt-4 space-y-2 text-sm text-gray-800">
                <li>
                  {item(computed.tenantSlug.length > 0)} Tenant slug{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.tenantSlug || "—"}
                  </span>
                </li>
                <li>
                  {item(computed.hasIndustry)} Industry{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.industryKey || "—"}
                  </span>
                </li>
                <li>{item(computed.hasRedirect)} Redirect URL (optional)</li>
                <li>{item(computed.hasThankYou)} Thank-you URL (optional)</li>
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-600">
                {loadingMe
                  ? "Loading your tenant…"
                  : "Couldn’t load tenant settings. Refresh and try again."}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Open onboarding
              </Link>
              <Link
                href="/admin/setup/openai"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                OpenAI setup
              </Link>
              <Link
                href="/admin/setup/ai-policy"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                AI policy
              </Link>
              <Link
                href="/admin"
                className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Admin home
              </Link>
            </div>
          </div>

          {/* Public quote page */}
          <div className="rounded-2xl border p-6">
            <h2 className="font-semibold">Public quote page</h2>
            <p className="mt-2 text-sm text-gray-600">
              This is what customers use. Share it after setup.
            </p>

            <div className="mt-4 rounded-xl border bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Path</div>
              <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {computed.tenantSlug ? (
                <>
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open quote page
                  </Link>
                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </>
              ) : (
                <Link
                  href="/onboarding"
                  className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                >
                  Set tenant slug first
                </Link>
              )}
            </div>

            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold">Quick actions</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Finish onboarding to set slug + industry</li>
                <li>Confirm tenant OpenAI key is set</li>
                <li>Run one test quote end-to-end</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Recent Quotes */}
        <div className="rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Latest quotes</h2>
            <Link href="/admin/quotes" className="text-sm font-semibold underline">
              View all
            </Link>
          </div>

          {loadingQuotes ? (
            <p className="mt-4 text-sm text-gray-600">Loading recent quotes…</p>
          ) : quotesErr ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
              {quotesErr}
            </div>
          ) : quotes.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">
              No quotes yet. Run a test quote from your public page.
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border">
              <div className="grid grid-cols-12 gap-3 border-b bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600">
                <div className="col-span-5">Quote</div>
                <div className="col-span-3">Created</div>
                <div className="col-span-2 text-right">Estimate</div>
                <div className="col-span-2 text-right">Render</div>
              </div>

              <div className="divide-y">
                {quotes.slice(0, 10).map((q, idx) => {
                  const id = safeStr(pick(q, ["id", "quoteLogId", "quote_log_id"]) || "");
                  const createdAt = pick(q, ["createdAt", "created_at", "created_at_iso", "created"]) || "";
                  const renderStatus = safeStr(pick(q, ["renderStatus", "render_status"]) || "");
                  const renderOptIn = Boolean(pick(q, ["renderOptIn", "render_opt_in"]) || false);

                  // estimates may be at top-level or inside output JSON
                  const estLow =
                    pick(q, ["estimateLow", "estimate_low"]) ??
                    pick(q?.output, ["estimateLow", "estimate_low"]) ??
                    pick(q?.output?.estimate, ["low", "estimateLow", "estimate_low"]);
                  const estHigh =
                    pick(q, ["estimateHigh", "estimate_high"]) ??
                    pick(q?.output, ["estimateHigh", "estimate_high"]) ??
                    pick(q?.output?.estimate, ["high", "estimateHigh", "estimate_high"]);

                  const estimateText =
                    estLow != null || estHigh != null
                      ? `${fmtMoney(estLow) || "—"} – ${fmtMoney(estHigh) || "—"}`
                      : "—";

                  const adminHref = id ? `/admin/quotes/${id}` : "/admin/quotes";

                  return (
                    <div
                      key={`${id || idx}`}
                      className="grid cursor-pointer grid-cols-12 gap-3 px-4 py-3 text-sm hover:bg-gray-50"
                      onClick={() => {
                        if (typeof window !== "undefined") window.location.href = adminHref;
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          if (typeof window !== "undefined") window.location.href = adminHref;
                        }
                      }}
                    >
                      <div className="col-span-5">
                        <div className="font-mono text-xs text-gray-700">{id || "—"}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {renderOptIn ? "Render opted-in" : "No render"}
                        </div>
                      </div>

                      <div className="col-span-3 text-gray-700">{fmtDate(createdAt) || "—"}</div>

                      <div className="col-span-2 text-right font-semibold text-gray-900">
                        {estimateText}
                      </div>

                      <div className="col-span-2 text-right">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                            renderStatus === "rendered"
                              ? "border-green-200 bg-green-50 text-green-800"
                              : renderStatus === "failed"
                                ? "border-red-200 bg-red-50 text-red-800"
                                : renderStatus === "queued" || renderStatus === "running"
                                  ? "border-yellow-200 bg-yellow-50 text-yellow-900"
                                  : "border-gray-200 bg-gray-50 text-gray-700"
                          )}
                        >
                          {renderStatus || "n/a"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500">
            Tip: click any row to open the Admin quote detail.
          </div>
        </div>

        {/* Next */}
        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next improvements</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Make onboarding redirect back here when complete.</li>
            <li>Add “render status” badges to Admin quotes list too.</li>
            <li>Polish the Quote UI during the polishing phase.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
