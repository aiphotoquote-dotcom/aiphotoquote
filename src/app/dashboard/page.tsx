"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";

type SetupStatus = {
  ok?: boolean;
  // tolerate any shape; we'll map safely
  [k: string]: any;
};

type TenantContextResp =
  | {
      ok: true;
      tenantId?: string | null;
      tenantSlug?: string | null;
      tenantName?: string | null;
      // tolerate any extra fields
      [k: string]: any;
    }
  | { ok: false; error?: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function BoolPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border",
        ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {ok ? "Configured" : "Missing"}
    </span>
  );
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);

  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        // 1) Tenant context (active tenant + slug)
        const ctxRes = await fetch("/api/tenant/context", {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        });

        const ctxText = await ctxRes.text();
        const ctxJson = ctxText ? (JSON.parse(ctxText) as TenantContextResp) : null;

        if (alive && ctxJson && (ctxJson as any).ok) {
          setTenantSlug((ctxJson as any).tenantSlug ?? null);
          setTenantName((ctxJson as any).tenantName ?? null);
        }

        // 2) Setup status (OpenAI key, AI policy, pricing, etc.)
        const stRes = await fetch("/api/admin/setup/status", {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        });

        const stText = await stRes.text();
        const stJson = stText ? (JSON.parse(stText) as SetupStatus) : null;

        if (alive) setSetup(stJson ?? null);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load dashboard status.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Map “setup status” in a defensive way (works even if response shape changes)
  const checklist = useMemo(() => {
    const s = setup || {};
    // Common patterns:
    // - s.openai_key_configured / s.hasOpenAiKey
    // - s.ai_policy_configured
    // - s.pricing_configured
    // - s.redirects_configured (redirect_url / thank_you_url)
    const openaiOk = Boolean(
      (s as any).openai_key_configured ??
        (s as any).has_openai_key ??
        (s as any).hasOpenAiKey ??
        (s as any).openaiConfigured
    );

    const aiPolicyOk = Boolean(
      (s as any).ai_policy_configured ??
        (s as any).has_ai_policy ??
        (s as any).aiPolicyConfigured
    );

    const pricingOk = Boolean(
      (s as any).pricing_configured ??
        (s as any).has_pricing ??
        (s as any).pricingConfigured
    );

    const redirectsOk = Boolean(
      (s as any).redirects_configured ??
        (s as any).has_redirects ??
        (s as any).redirectUrl ||
        (s as any).thankYouUrl
    );

    return [
      {
        key: "openai",
        label: "OpenAI key (tenant-owned)",
        ok: openaiOk,
        href: "/admin/setup/openai",
        hint: "Required to run estimates and renderings using the tenant’s key.",
      },
      {
        key: "aipolicy",
        label: "AI policy",
        ok: aiPolicyOk,
        href: "/admin/setup/ai-policy",
        hint: "Controls whether customers can opt into AI rendering preview.",
      },
      {
        key: "pricing",
        label: "Pricing guardrails",
        ok: pricingOk,
        href: "/admin/settings",
        hint: "Helps keep estimates within safe ranges and language.",
      },
      {
        key: "redirects",
        label: "Redirect + Thank-you URLs",
        ok: redirectsOk,
        href: "/admin/settings",
        hint: "Where customers go after submission + confirmation page.",
      },
    ];
  }, [setup]);

  const quoteLink = tenantSlug ? `/q/${tenantSlug}` : null;

  return (
    <main className="min-h-screen bg-white dark:bg-black">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Dashboard
            </h1>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {tenantName ? (
                <>
                  Tenant: <span className="font-semibold text-gray-900 dark:text-gray-100">{tenantName}</span>
                  {tenantSlug ? (
                    <>
                      <span className="mx-2">•</span>
                      Slug: <span className="font-mono">{tenantSlug}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>Tenant: <span className="font-mono">not selected</span></>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="/onboarding"
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800"
            >
              Onboarding
            </a>
            <a
              href="/admin/quotes"
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800"
            >
              Quotes
            </a>
            <a
              href="/admin/settings"
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800"
            >
              Settings
            </a>
            {quoteLink ? (
              <a
                href={quoteLink}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
              >
                Open Quote Link
              </a>
            ) : (
              <a
                href="/onboarding"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
              >
                Finish Setup
              </a>
            )}
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {err}
          </div>
        ) : null}

        <Card
          title="Setup checklist"
          right={
            loading ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>
            ) : (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {checklist.filter((c) => c.ok).length}/{checklist.length} complete
              </span>
            )
          }
        >
          <div className="space-y-3">
            {checklist.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-950"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {item.label}
                  </div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {item.hint}
                  </div>
                </div>
                <BoolPill ok={Boolean(item.ok)} />
              </a>
            ))}
          </div>
        </Card>

        <Card title="Public quote link">
          {quoteLink ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-gray-700 dark:text-gray-200">
                This is your customer-facing link:
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                {quoteLink}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                Tip: bookmark it on your phone so you can demo instantly.
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-700 dark:text-gray-200">
              No tenant slug detected yet. Go to <span className="font-semibold">Onboarding</span> to finish setup.
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
