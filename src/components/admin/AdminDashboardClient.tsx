// src/components/admin/AdminDashboardClient.tsx

"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  brandLogoUrl?: string | null;
};

type Totals = {
  totalLeads: number;
  unread: number;
  stageNew: number;
  inProgress: number;
};

type MetricsResp =
  | {
      ok: true;
      totals?: Totals;
      totalLeads?: number;
      unread?: number;
      stageNew?: number;
      inProgress?: number;
      [k: string]: any;
    }
  | { ok: false; error: string; message?: string };

type RecentResp =
  | {
      ok: true;
      leads: Array<{
        id: string;
        createdAt: string;
        stage: string;
        isRead: boolean;
        customerName: string;
        customerPhone: string;
        customerEmail?: string;
      }>;
    }
  | { ok: false; error: string; message?: string };

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeStage(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  return s;
}

function stageChip(st: string) {
  const s = normalizeStage(st);
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (s === "new")
    return cn(
      base,
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (s === "read")
    return cn(
      base,
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (s === "estimate")
    return cn(
      base,
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (s === "quoted")
    return cn(
      base,
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (s === "closed")
    return cn(
      base,
      "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
    );
  return cn(
    base,
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function prettyDate(d: string) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleString();
  } catch {
    return d;
  }
}

function initialsFromTenant(t: TenantRow | null) {
  const source = safeTrim(t?.name) || safeTrim(t?.slug) || "T";
  const parts = source
    .replace(/[-_]+/g, " ")
    .split(/\s+/g)
    .filter(Boolean);

  const a = parts[0]?.[0] ?? "T";
  const b = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

function roleChip(role: TenantRow["role"] | undefined) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize";
  if (role === "owner") {
    return cn(
      base,
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
    );
  }
  if (role === "admin") {
    return cn(
      base,
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  }
  return cn(
    base,
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function StatCard(props: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
        {props.label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
        {props.value}
      </div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">{props.sub}</div>
    </div>
  );
}

export default function AdminDashboardClient() {
  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [recent, setRecent] = useState<RecentResp | null>(null);
  const [context, setContext] = useState<ContextResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [mRes, rRes, cRes] = await Promise.all([
        fetch("/api/admin/dashboard/metrics", { cache: "no-store" }),
        fetch("/api/admin/dashboard/recent?limit=8", { cache: "no-store" }),
        fetch("/api/tenant/context", { cache: "no-store" }),
      ]);

      const mJson = await safeJson<MetricsResp>(mRes);
      const rJson = await safeJson<RecentResp>(rRes);
      const cJson = await safeJson<ContextResp>(cRes);

      setMetrics(mJson);
      setRecent(rJson);
      setContext(cJson);

      if (!mJson.ok) setErr(mJson.message || mJson.error || "Failed to load metrics");
      else if (!rJson.ok) setErr(rJson.message || rJson.error || "Failed to load recent leads");
      else if (!cJson.ok) setErr(cJson.message || cJson.error || "Failed to load tenant context");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      setMetrics({ ok: false, error: "FETCH_FAILED", message: msg });
      setRecent({ ok: false, error: "FETCH_FAILED", message: msg });
      setContext({ ok: false, error: "FETCH_FAILED", message: msg });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals: Totals = useMemo(() => {
    if (!metrics || !("ok" in metrics) || !metrics.ok) {
      return { totalLeads: 0, unread: 0, stageNew: 0, inProgress: 0 };
    }

    if (metrics.totals && typeof metrics.totals === "object") {
      return {
        totalLeads: Number(metrics.totals.totalLeads ?? 0) || 0,
        unread: Number(metrics.totals.unread ?? 0) || 0,
        stageNew: Number(metrics.totals.stageNew ?? 0) || 0,
        inProgress: Number(metrics.totals.inProgress ?? 0) || 0,
      };
    }

    return {
      totalLeads: Number((metrics as any).totalLeads ?? 0) || 0,
      unread: Number((metrics as any).unread ?? 0) || 0,
      stageNew: Number((metrics as any).stageNew ?? 0) || 0,
      inProgress: Number((metrics as any).inProgress ?? 0) || 0,
    };
  }, [metrics]);

  const activeTenant = useMemo(() => {
    if (!context || !context.ok) return null;
    return context.tenants.find((t) => t.tenantId === context.activeTenantId) ?? null;
  }, [context]);

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
              Admin Dashboard
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              What’s happening today
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Quick snapshot of inbound leads and where they are in your pipeline.
            </p>

            {err ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {err}
              </div>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[320px]">
            {activeTenant ? (
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-sm dark:border-gray-800 dark:from-gray-950 dark:to-black">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
                    {safeTrim(activeTenant.brandLogoUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={safeTrim(activeTenant.brandLogoUrl)}
                        alt={safeTrim(activeTenant.name) || activeTenant.slug}
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
                    <div className="mt-1 truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {safeTrim(activeTenant.name) || activeTenant.slug}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {activeTenant.slug}
                    </div>
                    <div className="mt-3">
                      <span className={roleChip(activeTenant.role)}>{activeTenant.role}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 md:justify-end">
              <Link
                href="/admin/quotes"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                View Quotes
              </Link>
              <Link
                href="/admin/settings"
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                Settings
              </Link>
              <Link
                href="/admin/setup"
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                Setup
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="TOTAL LEADS" value={totals.totalLeads} sub="All-time for active tenant" />
        <StatCard label="UNREAD" value={totals.unread} sub="Needs attention" />
        <StatCard label="NEW" value={totals.stageNew} sub="Stage: New" />
        <StatCard label="IN PROGRESS" value={totals.inProgress} sub="Read / Estimate / Quoted" />
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent leads</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest submissions for the active tenant.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              type="button"
            >
              Refresh
            </button>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Open full list
            </Link>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
            <div className="col-span-5">Customer</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-3">Submitted</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">Loading…</div>
          ) : recent && "ok" in recent && recent.ok ? (
            recent.leads.length ? (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {recent.leads.map((l) => {
                  const unread = !l.isRead;
                  return (
                    <li
                      key={l.id}
                      className={cn(
                        "grid grid-cols-12 items-center px-4 py-4 transition-colors",
                        unread ? "bg-blue-50/60 dark:bg-blue-950/25" : "bg-white dark:bg-gray-950"
                      )}
                    >
                      <div className="col-span-5 min-w-0">
                        <Link
                          href={`/admin/quotes/${l.id}`}
                          className="block truncate font-semibold text-gray-900 hover:underline dark:text-gray-100"
                        >
                          {l.customerName}
                        </Link>
                        <div className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                          {l.customerPhone || "—"}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <span className={stageChip(l.stage)}>{normalizeStage(l.stage)}</span>
                      </div>

                      <div className="col-span-3 text-sm text-gray-700 dark:text-gray-200">
                        {prettyDate(l.createdAt)}
                      </div>

                      <div className="col-span-2 flex justify-end">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                            unread
                              ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
                              : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                          )}
                        >
                          {unread ? "Unread" : "Read"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                No leads yet. Submit a test quote.
              </div>
            )
          ) : (
            <div className="px-4 py-6 text-sm text-red-700 dark:text-red-300">
              Couldn’t load recent leads.
              {recent && !recent.ok && recent.message ? (
                <div className="mt-2 whitespace-pre-wrap text-xs opacity-80">{recent.message}</div>
              ) : null}
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Tip: unread rows are lightly highlighted so you can scan faster.
        </p>
      </div>
    </div>
  );
}