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
      tenant: { id: string; name: string; slug: string };
      quotes: Array<{
        id: string;
        createdAt: string;
        input: any;
        output: any;

        renderOptIn: boolean;
        renderStatus: string;
        renderImageUrl: string | null;
        renderError: string | null;
      }>;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function item(ok: boolean) {
  return ok ? "✅" : "⬜️";
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n}`;
  }
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderBadge(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "rendered") {
    return (
      <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
        Rendered
      </span>
    );
  }

  if (s === "queued" || s === "running") {
    return (
      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
        Rendering
      </span>
    );
  }

  if (s === "failed") {
    return (
      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">
        Failed
      </span>
    );
  }

  return (
    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
      Not requested
    </span>
  );
}

function pickEstimateFromOutput(output: any): { low?: number; high?: number; confidence?: string } {
  const o = output ?? {};

  // Common shapes we’ve used across routes:
  // 1) { estimate: { low, high }, confidence }
  // 2) { estimateLow, estimateHigh, confidence }
  // 3) { output: { estimate: ... } } (nested)
  const directLow =
    typeof o?.estimateLow === "number" ? o.estimateLow : undefined;
  const directHigh =
    typeof o?.estimateHigh === "number" ? o.estimateHigh : undefined;

  const estObj = o?.estimate && typeof o.estimate === "object" ? o.estimate : null;
  const objLow =
    typeof estObj?.low === "number" ? estObj.low : undefined;
  const objHigh =
    typeof estObj?.high === "number" ? estObj.high : undefined;

  const conf =
    typeof o?.confidence === "string" ? o.confidence : undefined;

  // prefer nested estimate object if present
  const low = objLow ?? directLow;
  const high = objHigh ?? directHigh;

  return { low, high, confidence: conf };
}

export default function Dashboard() {
  const [loadingMe, setLoadingMe] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quotesResp, setQuotesResp] = useState<RecentQuotesResp | null>(null);

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
      try {
        const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
        const json: RecentQuotesResp = await res.json();
        if (!cancelled) setQuotesResp(json);
      } catch {
        if (!cancelled) setQuotesResp({ ok: false, error: "FETCH_FAILED" });
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
    const ok = Boolean(me && "ok" in me && (me as any).ok);
    const tenant = ok ? (me as any).tenant : null;
    const settings = ok ? (me as any).settings : null;

    const tenantName = tenant?.name ? String(tenant.name) : "";
    const tenantSlug = tenant?.slug ? String(tenant.slug) : "";

    const industryKey = settings?.industry_key ? String(settings.industry_key) : "";
    const redirectUrl = settings?.redirect_url ? String(settings.redirect_url) : "";
    const thankYouUrl = settings?.thank_you_url ? String(settings.thank_you_url) : "";

    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    const isReady = hasIndustry;

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

  const quotes = useMemo(() => {
    if (!quotesResp || !(quotesResp as any).ok) return [];
    return (quotesResp as any).quotes as any[];
  }, [quotesResp]);

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

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant flow status + latest quotes.
            </p>
          </div>

          <Link
            href="/onboarding"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {computed.isReady ? "Settings" : "Finish setup"}
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Setup Checklist */}
          <div className="rounded-2xl border p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Setup checklist</h2>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  computed.isReady
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
            </div>
          </div>

          {/* Public Quote Page */}
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

        {/* Latest Quotes */}
        <div className="rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Latest quotes</h2>
            <Link
              href="/admin/quotes"
              className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              View all (Admin)
            </Link>
          </div>

          {loadingQuotes ? (
            <p className="mt-4 text-sm text-gray-600">Loading quotes…</p>
          ) : quotesResp && (quotesResp as any).ok === false ? (
            <p className="mt-4 text-sm text-gray-600">
              Couldn’t load quotes. Refresh and try again.
            </p>
          ) : quotes.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">
              No quotes yet. Run a test quote from your public page.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500">
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Estimate</th>
                    <th className="py-2 pr-3">Confidence</th>
                    <th className="py-2 pr-3">Render</th>
                    <th className="py-2 pr-0 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q: any) => {
                    const picked = pickEstimateFromOutput(q.output);
                    const est =
                      picked.low != null || picked.high != null
                        ? `${fmtMoney(picked.low)} – ${fmtMoney(picked.high)}`
                        : "—";

                    const conf = picked.confidence ?? "—";

                    return (
                      <tr key={q.id} className="border-b last:border-b-0">
                        <td className="py-3 pr-3 whitespace-nowrap">{fmtDate(q.createdAt)}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">{est}</td>
                        <td className="py-3 pr-3">{conf}</td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2">
                            {renderBadge(q.renderStatus)}
                            {q.renderImageUrl ? (
                              <span className="text-xs text-gray-500">(image)</span>
                            ) : null}
                            {q.renderError ? (
                              <span className="text-xs text-red-600">(error)</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 pr-0 text-right">
                          <Link
                            href={`/admin/quotes/${q.id}`}
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-gray-50"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Next */}
        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next improvements (today)</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Show a “Setup complete” banner once industry is set.</li>
            <li>Dashboard: add a mini “Test quote” CTA (opens /q/&lt;slug&gt;).</li>
            <li>Navigation: unify Admin ↔ Dashboard ↔ Onboarding flow.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
