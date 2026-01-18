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

function pill(
  label: string,
  tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray"
) {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : "border-gray-200 bg-gray-50 text-gray-800";

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

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
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
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

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

  const setupTone = loading ? "gray" : computed.isReady ? "green" : "yellow";
  const setupLabel = loading ? "Loading…" : computed.isReady ? "Ready" : "Needs setup";

  const quotesOk = Boolean(quotesResp && "ok" in quotesResp && (quotesResp as any).ok);
  const quotes =
    quotesOk && quotesResp && "quotes" in quotesResp ? (quotesResp as any).quotes : [];

  const firstTimeEmpty = !quotesLoading && quotesOk && Array.isArray(quotes) && quotes.length === 0;

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tenant status, public link, and recent activity.
            </p>

            {computed.tenantName ? (
              <div className="mt-3 text-sm text-gray-800">
                Tenant: <span className="font-semibold">{computed.tenantName}</span>
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs text-gray-600">
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
                  ? "border border-gray-200 hover:bg-gray-50"
                  : "bg-black text-white"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </Link>
          </div>
        </div>

        {/* NEW: Start-here card (only shows when setup isn't complete) */}
        {!loading && computed.ok && !computed.isReady ? (
          <section className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-yellow-900">Start here</h2>
                <p className="mt-1 text-sm text-yellow-900/80">
                  Finish the minimum setup so your public quote page works and your tenant can run test quotes.
                </p>

                <ul className="mt-3 list-disc pl-5 text-sm text-yellow-900/80 space-y-1">
                  <li>Set a tenant slug</li>
                  <li>Select an industry</li>
                  <li>Save (OpenAI key + URLs are optional but recommended)</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/onboarding"
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                >
                  Open settings
                </Link>
                <Link
                  href="/admin/setup/openai"
                  className="rounded-lg border border-yellow-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-yellow-100/50"
                >
                  OpenAI setup
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Setup card */}
          <section className="rounded-2xl border p-6 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Setup checklist</h2>
              {pill(setupLabel, setupTone as any)}
            </div>

            {!loading && computed.ok ? (
              <ul className="mt-4 space-y-2 text-sm text-gray-800">
                <li>
                  <span className="mr-2">{computed.hasSlug ? "✅" : "⬜️"}</span>
                  Tenant slug{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.tenantSlug || "—"}
                  </span>
                </li>
                <li>
                  <span className="mr-2">{computed.hasIndustry ? "✅" : "⬜️"}</span>
                  Industry{" "}
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {computed.industryKey || "—"}
                  </span>
                </li>
                <li>
                  <span className="mr-2">{computed.hasRedirect ? "✅" : "⬜️"}</span>
                  Redirect URL (optional)
                </li>
                <li>
                  <span className="mr-2">{computed.hasThankYou ? "✅" : "⬜️"}</span>
                  Thank-you URL (optional)
                </li>
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-600">
                {loading
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
          </section>

          {/* Public link + Recent quotes */}
          <div className="grid gap-6 lg:col-span-2">
            {/* Public quote page */}
            <section className="rounded-2xl border p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">Public quote page</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    This is what customers use. Share it after setup.
                  </p>
                </div>

                {computed.tenantSlug ? (
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={computed.publicPath}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/onboarding"
                    className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    Set tenant slug first
                  </Link>
                )}
              </div>

              <div className="mt-4 rounded-xl border bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Path</div>
                <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {computed.tenantSlug ? (
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    Run a test quote
                  </Link>
                ) : (
                  <span className="text-xs text-gray-600">
                    Tip: Set slug + industry, then run a test quote end-to-end.
                  </span>
                )}
              </div>
            </section>

            {/* Recent Quotes */}
            <section className="rounded-2xl border p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Recent quotes</h2>
                {quotesLoading ? pill("Loading…", "gray") : null}
              </div>

              {firstTimeEmpty ? (
                <div className="mt-4 rounded-xl border bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">No quotes yet</div>
                  <p className="mt-1 text-sm text-gray-600">
                    Run a test quote to confirm: photos → estimate → (optional) render → emails + DB logs.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {computed.tenantSlug ? (
                      <Link
                        href={computed.publicPath}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                      >
                        Run test quote
                      </Link>
                    ) : (
                      <Link
                        href="/onboarding"
                        className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                      >
                        Set tenant slug first
                      </Link>
                    )}
                    <Link
                      href="/admin/quotes"
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      View admin quotes
                    </Link>
                  </div>
                </div>
              ) : !quotesLoading && quotesOk ? (
                Array.isArray(quotes) && quotes.length ? (
                  <div className="mt-4 overflow-hidden rounded-xl border">
                    <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600">
                      <div className="col-span-4">Created</div>
                      <div className="col-span-4">Quote ID</div>
                      <div className="col-span-4 text-right">Status</div>
                    </div>

                    <ul className="divide-y">
                      {quotes.map((q: any) => {
                        const statusRaw = (q.renderStatus || "")
                          .toString()
                          .toLowerCase();

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
                            <div className="col-span-4 text-sm text-gray-800">
                              {fmtDate(q.createdAt)}
                            </div>

                            <div className="col-span-4 font-mono text-xs text-gray-700">
                              {q.id}
                            </div>

                            <div className="col-span-4 flex items-center justify-end gap-3">
                              {typeof q.estimateLow === "number" ||
                              typeof q.estimateHigh === "number" ? (
                                <div className="text-xs text-gray-700">
                                  {money(q.estimateLow)}{" "}
                                  {q.estimateHigh != null
                                    ? `– ${money(q.estimateHigh)}`
                                    : ""}
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
                  <p className="mt-4 text-sm text-gray-600">
                    No quotes yet. Run a test quote.
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-gray-600">
                  {quotesLoading ? "Loading…" : "Couldn’t load recent quotes yet."}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/admin/quotes"
                  className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                >
                  View in Admin
                </Link>
                {computed.tenantSlug ? (
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    Open public quote page
                  </Link>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        {/* Next */}
        <section className="rounded-2xl border p-6">
          <h2 className="font-semibold">Next (flow polish)</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Make TopNav “Admin” optional for non-admin tenants later.</li>
            <li>Add “Quotes” page for tenant (not Admin) once ready.</li>
            <li>Add a small “Share link” button in TopNav when setup is ready.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
