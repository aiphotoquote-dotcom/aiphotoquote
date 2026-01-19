"use client";

import TopNav from "@/components/TopNav";
import TenantOnboardingForm from "@/components/TenantOnboardingForm";
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function item(ok: boolean) {
  return ok ? "✅" : "⬜️";
}

function codeBox({ title, value, onCopy, copied }: { title: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
        >
          {copied ? "Copied ✅" : "Copy"}
        </button>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export default function Onboarding() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedIframe, setCopiedIframe] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const computed = useMemo(() => {
    const ok = Boolean(me && "ok" in me && me.ok);
    const tenant = ok ? (me as any).tenant : null;
    const settings = ok ? (me as any).settings : null;

    const tenantSlug = tenant?.slug ? String(tenant.slug) : "";
    const tenantName = tenant?.name ? String(tenant.name) : "";

    const industryKey = settings?.industry_key ? String(settings.industry_key) : "";
    const redirectUrl = settings?.redirect_url ? String(settings.redirect_url) : "";
    const thankYouUrl = settings?.thank_you_url ? String(settings.thank_you_url) : "";

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);
    const hasRedirect = Boolean(redirectUrl);
    const hasThankYou = Boolean(thankYouUrl);

    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";

    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

    const publicUrl = origin && tenantSlug ? `${origin}${publicPath}` : publicPath;

    // If you already have a widget endpoint, swap this to it later.
    // For now, we give a clean embed that points to the existing public quote page.
    const iframeSrc = tenantSlug ? publicUrl : "https://<your-domain>/q/<tenant-slug>";
    const iframeSnippet = `<iframe src="${iframeSrc}" style="width:100%;height:820px;border:0;border-radius:16px;overflow:hidden" title="AI Photo Quote"></iframe>`;

    // “Script embed” placeholder (kept stable + copyable). You can wire it to a real widget.js later.
    // For now, it can be used as the future standard tenants paste once.
    const scriptSnippet = tenantSlug
      ? `<script async src="${origin || "https://aiphotoquote.vercel.app"}/widget.js" data-tenant="${tenantSlug}"></script>\n<div id="aiphotoquote-widget"></div>`
      : `<script async src="https://<your-domain>/widget.js" data-tenant="<tenant-slug>"></script>\n<div id="aiphotoquote-widget"></div>`;

    return {
      ok,
      tenantSlug,
      tenantName,
      industryKey,
      redirectUrl,
      thankYouUrl,
      hasSlug,
      hasIndustry,
      hasRedirect,
      hasThankYou,
      isReady,
      publicPath,
      publicUrl,
      iframeSnippet,
      scriptSnippet,
    };
  }, [me]);

  async function copyText(text: string, which: "script" | "iframe" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "script") {
        setCopiedScript(true);
        setTimeout(() => setCopiedScript(false), 1200);
      } else if (which === "iframe") {
        setCopiedIframe(true);
        setTimeout(() => setCopiedIframe(false), 1200);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 1200);
      }
    } catch {
      // ignore
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-12 space-y-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Configure your tenant and publish your quote experience.
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

          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to dashboard
            </Link>

            {computed.tenantSlug ? (
              <Link
                href={computed.publicPath}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Open public quote page
              </Link>
            ) : null}
          </div>
        </div>

        {/* Setup status (lives here, not on dashboard) */}
        <div
          className={cn(
            "rounded-2xl border p-5",
            computed.isReady
              ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
              : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-semibold">
              {loading ? "Checking setup…" : computed.isReady ? "Setup complete" : "Setup needed"}
            </div>
            <div className="text-xs opacity-80">
              {loading
                ? "—"
                : computed.isReady
                  ? "You’re ready to take customer quotes."
                  : "Complete the required items below to go live."}
            </div>
          </div>

          {!loading && computed.ok ? (
            <ul className="mt-3 space-y-1 text-sm">
              <li>
                {item(computed.hasSlug)} Tenant slug{" "}
                {computed.tenantSlug ? (
                  <span className="ml-2 font-mono text-xs opacity-80">({computed.tenantSlug})</span>
                ) : null}
              </li>
              <li>
                {item(computed.hasIndustry)} Industry key{" "}
                {computed.industryKey ? (
                  <span className="ml-2 font-mono text-xs opacity-80">({computed.industryKey})</span>
                ) : null}
              </li>
              <li>{item(computed.hasRedirect)} Redirect URL (optional)</li>
              <li>{item(computed.hasThankYou)} Thank-you URL (optional)</li>
            </ul>
          ) : null}
        </div>

        {/* Layout */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left: Form */}
          <div>
            <div className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
              Tenant configuration
            </div>
            <TenantOnboardingForm redirectToDashboard />
          </div>

          {/* Right: Embed widget */}
          <div className="space-y-5">
            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Embed widget
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Add AI Photo Quote to your website. Most tenants do this once, then only come back
                when they want to tweak copy or styling.
              </p>
            </div>

            {/* Public link */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Public quote link</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    Share this directly or use it inside your embed.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => copyText(computed.publicUrl, "link")}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  {copiedLink ? "Copied ✅" : "Copy"}
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                {computed.publicUrl}
              </div>

              <div className="mt-3 flex flex-wrap gap-3">
                <Link
                  href={computed.tenantSlug ? computed.publicPath : "/onboarding"}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Preview
                </Link>
                <Link
                  href="/admin/quotes"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Review leads
                </Link>
              </div>
            </div>

            {/* Script embed (future-proof) */}
            <codeBox
              title="Recommended embed (script)"
              value={computed.scriptSnippet}
              copied={copiedScript}
              onCopy={() => copyText(computed.scriptSnippet, "script")}
            />

            {/* Iframe embed (works immediately) */}
            <codeBox
              title="Instant embed (iframe)"
              value={computed.iframeSnippet}
              copied={copiedIframe}
              onCopy={() => copyText(computed.iframeSnippet, "iframe")}
            />

            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              <div className="font-semibold">Placement tip</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Best-performing placement is usually a{" "}
                <span className="font-semibold">“Get Quote”</span> button that scrolls to your
                embedded section (or opens a dedicated “Quote” page).
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
