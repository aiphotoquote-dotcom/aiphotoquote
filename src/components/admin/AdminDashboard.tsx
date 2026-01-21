// src/components/admin/AdminDashboard.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[] }
  | { ok: false; error: string; message?: string };

type MetricsResp =
  | {
      ok: true;
      tenantId: string;
      window: { last24hStart: string; last7dStart: string };
      kpis: {
        new24h: number;
        total7d: number;
        unread: number;
        needsAction: number;
        renderQueued: number;
      };
      recent: Array<{
        id: string;
        createdAt: string;
        stage: string;
        isRead: boolean;
        renderStatus: string;
        lead: { name: string; phone?: string | null; email?: string | null };
      }>;
    }
  | { ok: false; error: string; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). ` +
        `First 120 chars: ${text.slice(0, 120)}`
    );
  }
  return (await res.json()) as T;
}

function prettyTime(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function stageBadge(stageRaw: string) {
  const s = (stageRaw || "new").toLowerCase().trim();
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (s === "new")
    return cn(base, "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200");
  if (s === "read")
    return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
  if (s === "estimate")
    return cn(base, "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200");
  if (s === "quoted")
    return cn(base, "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200");
  if (s === "closed")
    return cn(base, "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200");

  return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
}

function renderBadge(renderStatusRaw: string) {
  const s = (renderStatusRaw || "not_requested").toLowerCase().trim();
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (!s || s === "not_requested")
    return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
  if (s === "queued" || s === "requested")
    return cn(base, "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200");
  if (s === "running" || s === "rendering")
    return cn(base, "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200");
  if (s === "rendered" || s === "done")
    return cn(base, "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200");
  if (s === "failed")
    return cn(base, "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200");

  return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
}

export default function AdminDashboard() {
  const [context, setContext] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });

  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const activeTenant = useMemo(
    () => context.tenants.find((t) => t.tenantId === context.activeTenantId) || null,
    [context.activeTenantId, context.tenants]
  );

  async function loadContext() {
    const res = await fetch("/api/tenant/context", { cache: "no-store" });
    const data = await safeJson<ContextResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");
    setContext({ activeTenantId: data.activeTenantId, tenants: data.tenants });
    return data.activeTenantId;
  }

  async function loadMetrics() {
    const res = await fetch("/api/admin/dashboard/metrics", { cache: "no-store" });
    const data = await safeJson<MetricsResp>(res);
    setMetrics(data);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load dashboard metrics");
  }

  async function bootstrap() {
    setErr(null);
    setLoading(true);
    try {
      const activeTenantId = await loadContext();
      if (!activeTenantId) {
        setMetrics(null);
        setErr("No active tenant selected yet.");
        return;
      }
      await loadMetrics();
    } catch (e: any) {
      setMetrics(null);
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Card = ({ title, value, sub }: { title: string; value: React.ReactNode; sub?: string }) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      {sub ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{sub}</div> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-300">Admin Dashboard</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {activeTenant?.name || activeTenant?.slug || "Your workspace"}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {activeTenant ? (
              <>
                <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800 dark:bg-gray-950 dark:border-gray-800 dark:text-gray-200">
                  Tenant: <span className="font-mono">{activeTenant.slug}</span>
                </span>
                <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800 dark:bg-gray-950 dark:border-gray-800 dark:text-gray-200">
                  Role: <span className="font-mono">{activeTenant.role}</span>
                </span>
              </>
            ) : (
              <span className="text-gray-600 dark:text-gray-300">No active tenant selected.</span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={bootstrap}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Refresh
          </button>

          <Link
            href="/admin/quotes"
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            View Quotes →
          </Link>
        </div>
      </div>

      {/* Error / empty */}
      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card title="New (24h)" value={loading ? "…" : metrics?.ok ? metrics.kpis.new24h : "—"} sub="Created in last 24 hours" />
        <Card title="Total (7d)" value={loading ? "…" : metrics?.ok ? metrics.kpis.total7d : "—"} sub="Created in last 7 days" />
        <Card title="Unread" value={loading ? "…" : metrics?.ok ? metrics.kpis.unread : "—"} sub="Not opened yet" />
        <Card title="Needs action" value={loading ? "…" : metrics?.ok ? metrics.kpis.needsAction : "—"} sub="New + Estimate stages" />
        <Card title="Renders queued" value={loading ? "…" : metrics?.ok ? metrics.kpis.renderQueued : "—"} sub="Queued / requested / running" />
      </div>

      {/* Recent */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent quotes</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Last 5 submissions for the active tenant.</div>
          </div>
          <Link
            href="/admin/quotes"
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Open Quotes List
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Render</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-gray-600 dark:text-gray-300" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : metrics?.ok && metrics.recent.length ? (
                metrics.recent.map((r) => (
                  <tr key={r.id} className={cn(!r.isRead && "bg-blue-50/40 dark:bg-blue-950/20")}>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{r.lead.name}</div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {r.lead.email ? <span className="font-mono">{r.lead.email}</span> : null}
                        {r.lead.email && r.lead.phone ? <span> · </span> : null}
                        {r.lead.phone ? <span className="font-mono">{r.lead.phone}</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={stageBadge(r.stage)}>{r.stage}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={renderBadge(r.renderStatus)}>{r.renderStatus}</span>
                    </td>
                    <td className="px-4 py-4 text-gray-700 dark:text-gray-200">{prettyTime(r.createdAt)}</td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/admin/quotes/${r.id}`}
                        className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-4 text-gray-600 dark:text-gray-300" colSpan={5}>
                    No quotes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {metrics?.ok ? (
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Window: last 24h from <span className="font-mono">{metrics.window.last24hStart}</span>, last 7d from{" "}
            <span className="font-mono">{metrics.window.last7dStart}</span>.
          </div>
        ) : null}
      </div>
    </div>
  );
}