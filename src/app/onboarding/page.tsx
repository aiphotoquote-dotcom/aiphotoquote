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

function StatusPill(props: { label: string; tone: "green" | "yellow" | "gray" }) {
  const cls =
    props.tone === "green"
      ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : props.tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {props.label}
    </span>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "w-full rounded-xl border px-4 py-3 text-left transition",
        props.active
          ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
          : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
      )}
    >
      <div className="text-sm font-semibold">{props.label}</div>
      {props.sub ? <div className="mt-1 text-xs opacity-80">{props.sub}</div> : null}
    </button>
  );
}

function CodeCard(props: {
  title: string;
  value: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

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
          onClick={copy}
          disabled={props.disabled}
          className={cn(
            "rounded-lg border px-3 py-2 text-xs font-semibold",
            props.disabled
              ? "border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-500"
              : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          )}
        >
          {copied ? "Copied ✅" : "Copy"}
        </button>
      </div>

      <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

type EmbedTab = "link" | "iframe" | "script";

export default function Onboarding() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<MeSettingsResponse | null>(null);
  const [tab, setTab] = useState<EmbedTab>("link");

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

    const iframeSnippet = tenantSlug
      ? `<iframe
  src="${publicUrl}"
  style="width:100%;max-width:900px;height:1000px;border:0;border-radius:16px;"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>`
      : `<iframe
  src="${origin}/q/<tenant-slug>"
  style="width:100%;max-width:900px;height:1000px;border:0;border-radius:16px;"
  loading="lazy"
></iframe>`;

    // NOTE: embed.js is a placeholder for now (future-proof UX).
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
      origin,
      publicPath,
      publicUrl,
      iframeSnippet,
      scriptSnippet,
    };
  }, [me]);

  const tone: "green" | "yellow" | "gray" = checking
    ? "gray"
    : computed.isReady
      ? "green"
      : "yellow";

  const label = checking ? "Checking…" : computed.isReady ? "Setup complete ✅" : "Setup needed";

  const shareValue =
    tab === "link"
      ? computed.publicUrl
      : tab === "iframe"
        ? computed.iframeSnippet
        : computed.scriptSnippet;

  const shareTitle =
    tab === "link"
      ? "Share link"
      : tab === "iframe"
        ? "Embed with iframe"
        : "Embed with script (recommended)";

  const shareHint =
    tab === "link"
      ? "Send this to customers or link it from your site."
      : tab === "iframe"
        ? "Fastest drop-in on any website builder. Good default."
        : "Best long-term. We’ll provide the real embed.js soon; keep this ready.";

  const embedDisabled = tab !== "link" ? !computed.tenantSlug : !computed.tenantSlug;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-12 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Configure your tenant and publish your customer quote page.
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

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill label={label} tone={tone} />
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

        {/* Two-column centerpiece */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Form */}
          <section className="lg:col-span-5">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Tenant configuration</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Your slug + industry turn on your public quote page. URLs control where customers
                    land after submitting.
                  </p>
                </div>

                <div className="hidden sm:block">
                  <StatusPill
                    label={computed.isReady ? "Ready" : "Not ready"}
                    tone={computed.isReady ? "green" : "yellow"}
                  />
                </div>
              </div>

              <div className="mt-6">
                <TenantOnboardingForm redirectToDashboard />
              </div>
            </div>
          </section>

          {/* Right: Share & Embed */}
          <section className="lg:col-span-7 space-y-6">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Share & embed</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Make this feel “live” for tenants: copy the link, drop in an embed, and preview.
                  </p>
                </div>

                {computed.tenantSlug ? (
                  <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                    Public path
                    <div className="mt-1 font-mono text-gray-700 dark:text-gray-200">
                      {computed.publicPath}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Tabs */}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <TabButton
                  active={tab === "link"}
                  onClick={() => setTab("link")}
                  label="Link"
                  sub="Share with customers"
                />
                <TabButton
                  active={tab === "iframe"}
                  onClick={() => setTab("iframe")}
                  label="Iframe"
                  sub="Fast embed anywhere"
                />
                <TabButton
                  active={tab === "script"}
                  onClick={() => setTab("script")}
                  label="Script"
                  sub="Recommended (future)"
                />
              </div>

              {/* Code card */}
              <div className="mt-5">
                <CodeCard
                  title={shareTitle}
                  value={shareValue}
                  hint={
                    computed.tenantSlug
                      ? shareHint
                      : "Set a tenant slug first, then your link + embed snippets will populate."
                  }
                  disabled={embedDisabled}
                />
              </div>

              {/* Preview */}
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Live preview</div>
                  {computed.tenantSlug ? (
                    <Link
                      href={computed.publicPath}
                      className="text-sm font-semibold underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50"
                    >
                      Open full page
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Set slug to enable</span>
                  )}
                </div>

                <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                  {computed.tenantSlug ? (
                    <iframe
                      title="AIPhotoQuote Preview"
                      src={computed.publicPath}
                      className="h-[520px] w-full"
                    />
                  ) : (
                    <div className="p-6 text-sm text-gray-600 dark:text-gray-300">
                      Add your tenant slug, then you’ll see a live preview of your public quote
                      page here.
                    </div>
                  )}
                </div>

                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Tip: after setup, run one end-to-end test (estimate + optional render) to validate
                  the full tenant experience.
                </div>
              </div>
            </div>

            {/* Tiny “What tenants do next” card */}
            <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold">Next: go live</div>
              <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                <li>Copy the link and add it to your site navigation.</li>
                <li>Or embed with iframe if you want it inside your site page.</li>
                <li>Send yourself a test quote to confirm email + rendering behavior.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
