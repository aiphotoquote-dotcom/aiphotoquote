"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type MetricsResp =
  | {
      ok: true;
      totals: {
        totalLeads: number;
        unread: number;
        stageNew: number;
        inProgress: number; // read/estimate/quoted bucket
      };
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

function normalizeStage(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  return s;
}

function stageLabel(s: string) {
  const st = normalizeStage(s);
  if (st === "new") return "New";
  if (st === "read") return "Read";
  if (st === "estimate") return "Estimate";
  if (st === "quoted") return "Quoted";
  if (st === "closed") return "Closed";
  return st.charAt(0).toUpperCase() + st.slice(1);
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
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [mRes, rRes] = await Promise.all([
        fetch("/api/admin/dashboard/metrics", { cache: "no-store" }),
        fetch("/api/admin/dashboard/recent?limit=8", { cache: "no-store" }),
      ]);

      const mJson = (await mRes.json()) as MetricsResp;
      const rJson = (await rRes.json()) as RecentResp;

      setMetrics(mJson);
      setRecent(rJson);
    } catch (e: any) {
      setMetrics({ ok: false, error: "FETCH_FAILED", message: e?.message ?? String(e) });
      setRecent({ ok: false, error: "FETCH_FAILED", message: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    if (metrics && "ok" in metrics && metrics.ok) return metrics.totals;
    return { totalLeads: 0, unread: 0, stageNew: 0, inProgress: 0 };
  }, [metrics]);

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
              Admin Dashboard
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              What’s happening today
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Quick snapshot of inbound leads and where they are in your pipeline.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
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

      {/* Metric tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="TOTAL LEADS" value={totals.totalLeads} sub="All-time for active tenant" />
        <StatCard label="UNREAD" value={totals.unread} sub="Needs attention" />
        <StatCard label="NEW" value={totals.stageNew} sub="Stage: New" />
        <StatCard label="IN PROGRESS" value={totals.inProgress} sub="Read / Estimate / Quoted" />
      </div>

      {/* Recent leads */}
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
                        unread
                          ? "bg-blue-50/60 dark:bg-blue-950/25"
                          : "bg-white dark:bg-gray-950"
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