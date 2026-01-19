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

        // support both
        redirect_url?: string | null;
        thank_you_url?: string | null;
        redirectUrl?: string | null;
        thankYouUrl?: string | null;

        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pickUrl(s: any, snake: string, camel: string) {
  const a = s?.[snake];
  if (typeof a === "string") return a;
  const b = s?.[camel];
  if (typeof b === "string") return b;
  return "";
}

function CodeBox(props: {
  title: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {props.title}
          </div>
          {props.hint ? (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{props.hint}</div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={props.onCopy}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
        >
          {props.copied ? "Copied ✅" : "Copy"}
        </button>
      </div>

      <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

export default function Onboarding() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedIframe, setCopiedIframe] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

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
        if (!cancelled) setChecking(false);
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

    const tenantName = tenant?.name ? String(tenant.name) : "";
    const tenantSlug = tenant?.slug ? String(tenant.slug) : "";

    const industryKey = settings?.industry_key ? String(settings.industry_key) : "";

    const redirectUrl = pickUrl(settings, "redirect_url", "redirectUrl");
    const thankYouUrl = pickUrl(settings, "thank_you_url", "thankYouUrl");

    const hasSlug = Boolean(tenantSlug && tenantSlug.length >= 3);
    const hasIndustry = Boolean(industryKey);
    const isReady = hasSlug && hasIndustry;

    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "/q/<tenant-slug>";
    const publicUrl = origin && tenantSlug ? `${origin}${publicPath}` : publicPath;

    // Embed snippets (static for now, but good UX)
    const iframeSnippet = tenantSlug
      ? `<iframe src="${publicUrl}" style="width:100%;max-width:900px;height:1000px;border:0;border-radius:16px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
      : `<iframe src="${origin}/q/<tenant-slug>" style="width:100%;max-width:900px;height:1000px;border:0;border-radius:16px;" loading="lazy"></iframe>`;

    // “Script embed” placeholder (future)
    const scriptSnippet = tenantSlug
      ? `<!-- AIPhotoQuote embed (recommended) -->
<div id="aiphotoquote-widget"></div>
<script
  async
  data-tenant="${tenantSlug}"
  src="${origin}/embed.js"
></script>`
      : `<!-- AIPhotoQuote embed (recommended) -->
<div id="aiphotoquote-widget"></div>
<script async data-tenant="<tenant-slug>" src="${origin}/embed.js"></script>`;

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
      publicUrl,
      iframeSnippet,
      scriptSnippet,
    };
  }, [me]);

  async function copy(text: string, which: "link" | "iframe" | "script") {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "link") {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 1200);
      } else if (which === "iframe") {
        setCopiedIframe(true);
        setTimeout(() => setCopiedIframe(false), 1200);
      } else {
        setCopiedScript(true);
        setTimeout(() => setCopiedScript(false), 1200);
      }
    } catch {
      // ignore
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-12 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Configure your tenant (industry, OpenAI key, pricing guardrails, and redirect URL).
            </p>
            {checking ? (
              <p className="mt-2 text-xs text-gray-500">Checking setup status…</p>
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
                Preview public page
              </Link>
            ) : null}
          </div>
        </div>

        {/* Setup status banner */}
        <div
          className={cn(
            "rounded-2xl border p-5 text-sm",
            computed.isReady
              ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
              : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
          )}
        >
          {computed.isReady ? (
            <div className="flex flex-col gap-1">
              <div className="font-semibold">Setup complete ✅</div>
              <div className="opacity-90">
                You can now embed your public quote page or share the link with customers.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="font-semibold">Setup needed</div>
              <div className="opacity-90">
                Add a tenant slug and industry key to enable your public quote page.
              </div>
            </div>
          )}
        </div>

        {/* Core form */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="lg:col-span-1">
            <TenantOnboardingForm redirectToDashboard />
          </div>

          {/* Embed & share */}
          <div className="space-y-6 lg:col-span-1">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <h2 className="text-lg font-semibold">Share & embed</h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Once your slug is set, this is the tenant-facing link customers will use.
              </p>

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="text-xs text-gray-500">Public quote page</div>
                <div className="mt-1 font-mono text-sm text-gray-800 dark:text-gray-100">
                  {computed.publicUrl}
                </div>

                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => copy(computed.publicUrl, "link")}
                    disabled={!computed.tenantSlug}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-950"
                  >
                    {copiedLink ? "Copied ✅" : "Copy link"}
                  </button>

                  {computed.tenantSlug ? (
                    <Link
                      href={computed.publicPath}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>

            <CodeBox
              title="Quick embed (iframe)"
              value={computed.iframeSnippet}
              copied={copiedIframe}
              onCopy={() => copy(computed.iframeSnippet, "iframe")}
              hint="Fastest drop-in. Works anywhere, looks good, minimal effort."
            />

            <CodeBox
              title="Recommended embed (script)"
              value={computed.scriptSnippet}
              copied={copiedScript}
              onCopy={() => copy(computed.scriptSnippet, "script")}
              hint="Future-proof. We’ll ship the real embed.js soon; keep this ready."
            />
          </div>
        </div>
      </div>
    </main>
  );
}
