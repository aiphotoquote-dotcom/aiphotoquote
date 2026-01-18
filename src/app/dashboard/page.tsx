"use client";

import TopNav from "@/components/TopNav";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-neutral-200 bg-neutral-50 text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-200";

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
  const router = useRouter();

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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              Tenant status, public link, and recent activity.
            </p>

            {computed.tenantName ? (
              <div className="mt-3 text-sm text-neutral-800 dark:text-neutral-100">
                Tenant: <span className="font-semibold">{computed.tenantName}</span>
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs text-neutral-600 dark:text-neutral-300">
                    ({computed.tenantSlug})
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {pill(setupLabel, setupTone as any)}

            {/* Primary CTA: BUTTON + router.push to avoid Link click issues */}
            <button
              type="button"
              onClick={() => router.push("/onboarding")}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                computed.isReady
                  ? "border border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
                  : "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
              )}
            >
              {computed.isReady ? "Settings" : "Finish setup"}
            </button>

            {/* Secondary: keep a plain Link for accessibility */}
            <Link
              href="/onboarding"
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
            >
              Open onboarding
            </Link>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Setup card */}
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Setup checklist</h2>
              {pill(setupLabel, setupTone as any)}
            </div>

            {!loading && computed.ok ? (
              <ul className="mt-4 space-y-2 text-sm text-neutral-800 dark:text-neutral-100">
                <li>
                  <span className="mr-2">{computed.hasSlug ? "✅" : "⬜️"}</span>
                  Tenant slug{" "}
                  <span className="ml-2 font-mono text-xs text-neutral-600 dark:text-neutral-300">
                    {computed.tenantSlug || "—"}
                  </span>
                </li>
                <li>
                  <span className="mr-2">{computed.hasIndustry ? "✅" : "⬜️"}</span>
                  Industry{" "}
                  <span className="ml-2 font-mono text-xs text-neutral-600 dark:text-neutral-300">
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
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
                {loading
                  ? "Loading your tenant…"
                  : "Couldn’t load tenant settings. Refresh and try again."}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/admin/setup/openai"
                className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
              >
                OpenAI setup
              </Link>
              <Link
                href="/admin/setup/ai-policy"
                className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
              >
                AI policy
              </Link>
            </div>
          </section>

          {/* Public link + Recent quotes */}
          <div className="grid gap-6 lg:col-span-2">
            {/* Public quote page */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">Public quote page</h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    This is what customers use. Share it after setup.
                  </p>
                </div>

                {computed.tenantSlug ? (
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={computed.publicPath}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => router.push("/onboarding")}
                    className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
                  >
                    Set tenant slug first
                  </button>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
                <div className="text-xs text-neutral-500">Path</div>
                <div className="mt-1 font-mono text-sm">{computed.publicPath}</div>
              </div>

              <div className="mt-4 text-xs text-neutral-600 dark:text-neutral-300">
                Tip: run one complete test quote (estimate + optional rendering) after setup.
              </div>
            </section>

            {/* Recent Quotes */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Recent quotes</h2>
                {quotesLoading ? pill("Loading…", "gray") : null}
              </div>

              {!quotesLoading && quotesResp && "ok" in quotesResp && quotesResp.ok ? (
                quotesResp.quotes.length ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                    <div className="grid grid-cols-12 bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-600 dark:bg-neutral-900/40 dark:text-neutral-300">
                      <div className="col-span-4">Created</div>
                      <div className="col-span-4">Quote ID</div>
                      <div className="col-span-4 text-right">Status</div>
                    </div>

                    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
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
                            <div className="col-span-4 text-sm text-neutral-800 dark:text-neutral-100">
                              {fmtDate(q.createdAt)}
                            </div>

                            <div className="col-span-4 font-mono text-xs text-neutral-700 dark:text-neutral-200">
                              {q.id}
                            </div>

                            <div className="col-span-4 flex items-center justify-end gap-3">
                              {typeof q.estimateLow === "number" || typeof q.estimateHigh === "number" ? (
                                <div className="text-xs text-neutral-700 dark:text-neutral-200">
                                  {money(q.estimateLow)}
                                  {q.estimateHigh != null ? ` – ${money(q.estimateHigh)}` : ""}
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
                  <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
                    No quotes yet. Run a test quote.
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
                  {quotesLoading ? "Loading…" : "Couldn’t load recent quotes yet."}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/admin/quotes"
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
                >
                  View in Admin
                </Link>
                {computed.tenantSlug ? (
                  <Link
                    href={computed.publicPath}
                    className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
                  >
                    Open public quote page
                  </Link>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
