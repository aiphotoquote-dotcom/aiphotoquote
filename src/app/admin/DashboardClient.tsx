// src/app/admin/DashboardClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  logoUrl?: string | null;
  brandLogoUrl?: string | null;
};

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
    }
  | { ok: false; error: string; message?: string };

type MetricsResp =
  | {
      ok: true;
      metrics: {
        newLeads7d: number;
        quoted7d: number;
        avgResponseMinutes7d: number | null;
        renderEnabled: boolean | null;
      };
    }
  | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pickTenantLogo(t: TenantRow | null): string {
  if (!t) return "";
  return safeTrim(t.logoUrl) || safeTrim(t.brandLogoUrl) || "";
}

function initialsFromTenant(t: TenantRow | null): string {
  const source = safeTrim(t?.name) || safeTrim(t?.slug) || "T";
  const parts = source
    .replace(/[-_]+/g, " ")
    .split(/\s+/g)
    .filter(Boolean);

  const a = parts[0]?.[0] ?? "T";
  const b = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

function roleTone(role: TenantRow["role"] | undefined) {
  if (role === "owner") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (role === "admin") {
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200";
  }
  return "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";
}

export default function DashboardClient() {
  const [context, setContext] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });

  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [needsPick, setNeedsPick] = useState(false);

  const CONTEXT_URL = "/api/tenant/context";
  const METRICS_URL = "/api/admin/dashboard/metrics";

  async function loadContext() {
    const res = await fetch(CONTEXT_URL, { cache: "no-store" });
    const data = await safeJson<ContextResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");

    setContext({ activeTenantId: data.activeTenantId, tenants: data.tenants });
    setNeedsPick(!!data.needsTenantSelection);

    return {
      activeTenantId: data.activeTenantId,
      tenants: data.tenants,
      needsTenantSelection: !!data.needsTenantSelection,
    };
  }

  async function loadMetrics() {
    const res = await fetch(METRICS_URL, { cache: "no-store" });
    const data = await safeJson<MetricsResp>(res);
    setMetrics(data);
  }

  async function bootstrap() {
    setErr(null);
    setLoading(true);
    try {
      const ctx = await loadContext();

      if (!ctx.activeTenantId && (ctx.tenants?.length || 0) > 1) {
        setMetrics(null);
        setErr("No active tenant selected yet. Use the Tenant switcher in the top nav to pick one.");
        return;
      }

      await loadMetrics();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTenant = useMemo(
    () => context.tenants.find((t) => t.tenantId === context.activeTenantId) || null,
    [context]
  );

  const activeTenantLogo = useMemo(() => pickTenantLogo(activeTenant), [activeTenant]);
  const activeTenantDisplayName = useMemo(
    () => safeTrim(activeTenant?.name) || safeTrim(activeTenant?.slug) || "Active tenant",
    [activeTenant]
  );

  const m = metrics && metrics.ok ? metrics.metrics : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              Admin Dashboard
            </div>

            <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
              {activeTenant ? (
                <>
                  {activeTenant.name || activeTenant.slug}{" "}
                  <span className="text-gray-400 dark:text-gray-500">({activeTenant.slug})</span>
                </>
              ) : (
                "Welcome"
              )}
            </h1>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Track your pipeline, keep momentum, and move leads through stages.
            </p>

            {err ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {err}
              </div>
            ) : null}

            {needsPick ? (
              <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-100">
                You belong to multiple tenants. Please pick one in the top nav Tenant switcher.
              </div>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[360px]">
            {activeTenant ? (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white shadow-sm dark:border-gray-800 dark:from-gray-950 dark:to-black">
                <div className="flex items-center gap-4 p-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
                    {activeTenantLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeTenantLogo}
                        alt={activeTenantDisplayName}
                        className="h-full w-full object-contain bg-white p-2"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-900 to-gray-700 text-lg font-extrabold tracking-wide text-white dark:from-white dark:to-gray-300 dark:text-black">
                        {initialsFromTenant(activeTenant)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                      Active tenant
                    </div>

                    <div className="mt-1 truncate text-lg font-extrabold text-gray-900 dark:text-gray-100">
                      {activeTenantDisplayName}
                    </div>

                    <div className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {activeTenant.slug}
                    </div>

                    <div className="mt-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize",
                          roleTone(activeTenant.role)
                        )}
                      >
                        {activeTenant.role}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <a
                href="/admin/quotes"
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Open Quotes
              </a>
              <a
                href="/admin/settings"
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                Tenant Settings
              </a>
              <button
                type="button"
                onClick={bootstrap}
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="New leads" value={loading ? "…" : String(m?.newLeads7d ?? 0)} sub="Last 7 days" />
          <MetricCard title="Quoted" value={loading ? "…" : String(m?.quoted7d ?? 0)} sub="Last 7 days" />
          <MetricCard
            title="Avg response"
            value={
              loading
                ? "…"
                : m?.avgResponseMinutes7d == null
                  ? "—"
                  : `${Math.max(0, Math.round(m.avgResponseMinutes7d))}m`
            }
            sub="Last 7 days"
          />
          <MetricCard title="Rendering" value={loading ? "…" : m?.renderEnabled ? "On" : "Off"} sub="Per-tenant" />
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Workflow stages</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <StageChip label="New" tone="blue" />
            <StageChip label="Read" tone="gray" />
            <StageChip label="Estimate" tone="indigo" />
            <StageChip label="Quoted" tone="green" />
            <StageChip label="Closed" tone="yellow" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black">
        <div className="text-sm font-semibold">Next</div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Next we’ll add: tenant switcher + sign out / switch user in the top nav.
        </p>
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Tenants loaded: {context.tenants.length}
          {activeTenant ? ` • Active: ${activeTenant.slug}` : ""}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-xs text-gray-500 dark:text-gray-400">{title}</div>
      <div className="mt-2 text-2xl font-extrabold">{value}</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</div>
    </div>
  );
}

function StageChip({ label, tone }: { label: string; tone: "blue" | "gray" | "indigo" | "green" | "yellow" }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
      : tone === "gray"
        ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
        : tone === "indigo"
          ? "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
          : tone === "green"
            ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
            : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200";

  return <span className={cn(base, cls)}>{label}</span>;
}