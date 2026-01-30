// src/app/admin/page.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type MetricsOk = {
  ok: true;
  totalLeads: number;
  unread: number;
  stageNew: number;
  inProgress: number;
  todayNew: number;
  yesterdayNew: number;
  staleUnread: number;
};

type MetricsResp = MetricsOk | { ok: false; error: string; message?: string };

type RecentResp =
  | {
      ok: true;
      leads: Array<{
        id: string;
        submittedAt: string;
        stage: string;
        isRead: boolean;
        customerName: string;
        customerPhone: string | null;
      }>;
    }
  | { ok: false; error: string; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function stageLabel(s: string) {
  const st = String(s || "").toLowerCase();
  if (st === "new") return "new";
  if (st === "read") return "read";
  if (st === "estimate") return "estimate";
  if (st === "quoted") return "quoted";
  return st || "new";
}

function chip(label: string, tone: "gray" | "blue" | "yellow" | "green" | "red" = "gray") {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";

  return <span className={cn(base, cls)}>{label}</span>;
}

function ClickCard({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "block rounded-2xl focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20",
        "transition-transform active:scale-[0.99]",
        className
      )}
    >
      <div className={cn("rounded-2xl", "hover:shadow-md")}>{children}</div>
    </Link>
  );
}

function isFiniteNumber(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function validateMetricsPayload(r: any): MetricsOk | null {
  if (!r || typeof r !== "object") return null;
  if (r.ok !== true) return null;

  const keys = ["totalLeads", "unread", "stageNew", "inProgress", "todayNew", "yesterdayNew", "staleUnread"] as const;
  for (const k of keys) {
    if (!isFiniteNumber(r[k])) return null;
  }

  return r as MetricsOk;
}

function normalizeRecent(r: any): RecentResp {
  if (!r || typeof r !== "object") return { ok: false, error: "BAD_RESPONSE", message: "Recent returned invalid JSON." };
  if (r.ok !== true) return { ok: false, error: r.error || "FETCH_FAILED", message: r.message };
  return { ok: true, leads: Array.isArray(r.leads) ? r.leads : [] };
}

export default function AdminDashboardPage() {
  const pathname = usePathname() || "";

  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [recent, setRecent] = useState<RecentResp | null>(null);
  const [loading, setLoading] = useState(true);

  // last known-good metrics so we never overwrite with junk/empty payloads
  const lastGoodMetricsRef = useRef<MetricsOk | null>(null);

  async function load() {
    setLoading(true);
    try {
      const bust = Date.now().toString(); // cache-bust helps iOS/Safari weirdness
      const [mRes, rRes] = await Promise.all([
        fetch(`/api/admin/dashboard/metrics?bust=${bust}`, { cache: "no-store" }),
        fetch(`/api/admin/dashboard/recent?bust=${bust}`, { cache: "no-store" }),
      ]);

      const mJson = await mRes.json().catch(() => null);
      const rJson = await rRes.json().catch(() => null);

      // ✅ Metrics: only accept payload if it's complete + numeric.
      const valid = validateMetricsPayload(mJson);
      if (valid) {
        lastGoodMetricsRef.current = valid;
        setMetrics(valid);
      } else {
        // If server gave an error, surface it. If it gave incomplete ok:true, keep last good.
        if (mJson && typeof mJson === "object" && mJson.ok === false) {
          setMetrics({ ok: false, error: mJson.error || "FETCH_FAILED", message: mJson.message });
        } else if (lastGoodMetricsRef.current) {
          // keep prior good metrics (do not overwrite with zeros)
          setMetrics(lastGoodMetricsRef.current);
        } else {
          setMetrics({ ok: false, error: "BAD_RESPONSE", message: "Metrics response incomplete." });
        }
      }

      // Recent list can safely default to empty; still keep normal behavior
      const rNorm = normalizeRecent(rJson);
      setRecent(rNorm);
    } catch (e: any) {
      // do not clobber good metrics on transient fetch failure
      if (lastGoodMetricsRef.current) setMetrics(lastGoodMetricsRef.current);
      else setMetrics({ ok: false, error: "FETCH_FAILED", message: e?.message ?? String(e) });

      setRecent({ ok: false, error: "FETCH_FAILED", message: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  // 1) initial mount
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) reload when route becomes active again
  useEffect(() => {
    if (pathname === "/admin") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 3) reload when page is restored from bfcache
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) load();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mOk = Boolean(metrics && "ok" in metrics && (metrics as any).ok);
  const rOk = Boolean(recent && "ok" in recent && (recent as any).ok);

  const todayDelta = useMemo(() => {
    if (!mOk) return { label: "—", tone: "gray" as const };
    const curr = (metrics as any).todayNew ?? 0;
    const prev = (metrics as any).yesterdayNew ?? 0;
    if (prev <= 0) return curr > 0 ? { label: "new", tone: "blue" as const } : { label: "—", tone: "gray" as const };
    const p = Math.round(((curr - prev) / prev) * 100);
    if (p === 0) return { label: "0%", tone: "gray" as const };
    if (p > 0) return { label: `+${p}%`, tone: "green" as const };
    return { label: `${p}%`, tone: "red" as const };
  }, [mOk, metrics]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">What’s happening today</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Quick snapshot of inbound leads and where they are in your pipeline.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/admin/quotes"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            View Quotes
          </Link>

          {mOk ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/quotes?view=unread" className="hover:opacity-90">
                {chip(`Unread: ${(metrics as any).unread}`, (metrics as any).staleUnread > 0 ? "yellow" : "gray")}
              </Link>
              <Link href="/admin/quotes?view=new" className="hover:opacity-90">
                {chip(`New: ${(metrics as any).stageNew}`, "blue")}
              </Link>
              <Link href="/admin/quotes?view=in_progress" className="hover:opacity-90">
                {chip(`In progress: ${(metrics as any).inProgress}`, "green")}
              </Link>

              <span className="ml-1">{chip(`Today: ${(metrics as any).todayNew} (${todayDelta.label})`, todayDelta.tone)}</span>
            </div>
          ) : loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (
            <div className="text-sm text-red-600">{(metrics as any)?.message || "Failed to load metrics."}</div>
          )}

          <button
            type="button"
            onClick={load}
            className="ml-auto rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ClickCard
          href="/admin/quotes"
          ariaLabel="Open all leads"
          className="border border-gray-200 bg-white p-0 shadow-sm dark:border-gray-800 dark:bg-gray-950"
        >
          <div className="p-5">
            <div className="text-xs font-semibold tracking-wide text-gray-500">TOTAL LEADS</div>
            <div className="mt-2 text-4xl font-semibold">{mOk ? (metrics as any).totalLeads : "—"}</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">All-time for active tenant</div>
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Tap to view all</div>
          </div>
        </ClickCard>

        <ClickCard
          href="/admin/quotes?view=unread"
          ariaLabel="Open unread leads"
          className="border border-yellow-200 bg-yellow-50 p-0 shadow-sm dark:border-yellow-900/40 dark:bg-yellow-950/20"
        >
          <div className="p-5">
            <div className="text-xs font-semibold tracking-wide text-yellow-900 dark:text-yellow-200">UNREAD</div>
            <div className="mt-2 text-4xl font-semibold text-yellow-900 dark:text-yellow-100">
              {mOk ? (metrics as any).unread : "—"}
            </div>
            <div className="mt-2 text-sm text-yellow-900/80 dark:text-yellow-200/80">
              Needs attention
              {mOk && (metrics as any).staleUnread > 0 ? ` · ${(metrics as any).staleUnread} stale >24h` : ""}
            </div>
            <div className="mt-3 text-xs text-yellow-900/70 dark:text-yellow-200/70">Tap to filter</div>
          </div>
        </ClickCard>

        <ClickCard
          href="/admin/quotes?view=new"
          ariaLabel="Open new leads"
          className="border border-blue-200 bg-blue-50 p-0 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20"
        >
          <div className="p-5">
            <div className="text-xs font-semibold tracking-wide text-blue-900 dark:text-blue-200">NEW</div>
            <div className="mt-2 text-4xl font-semibold text-blue-900 dark:text-blue-100">
              {mOk ? (metrics as any).stageNew : "—"}
            </div>
            <div className="mt-2 text-sm text-blue-900/80 dark:text-blue-200/80">Stage: New</div>
            <div className="mt-3 text-xs text-blue-900/70 dark:text-blue-200/70">Tap to filter</div>
          </div>
        </ClickCard>

        <ClickCard
          href="/admin/quotes?view=in_progress"
          ariaLabel="Open in-progress leads (read, estimate, quoted)"
          className="border border-green-200 bg-green-50 p-0 shadow-sm dark:border-green-900/40 dark:bg-green-950/20"
        >
          <div className="p-5">
            <div className="text-xs font-semibold tracking-wide text-green-900 dark:text-green-200">IN PROGRESS</div>
            <div className="mt-2 text-4xl font-semibold text-green-900 dark:text-green-100">
              {mOk ? (metrics as any).inProgress : "—"}
            </div>
            <div className="mt-2 text-sm text-green-900/80 dark:text-green-200/80">Read / Estimate / Quoted</div>
            <div className="mt-3 text-xs text-green-900/70 dark:text-green-200/70">Tap to filter</div>
          </div>
        </ClickCard>
      </div>

      {/* Recent leads */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recent leads</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Latest submissions for the active tenant.</p>
          </div>

          <Link
            href="/admin/quotes"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Open full list
          </Link>
        </div>

        {!rOk ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
            {loading ? "Loading…" : (recent as any)?.message || "Couldn’t load recent leads."}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
              <div className="col-span-5">Customer</div>
              <div className="col-span-2">Stage</div>
              <div className="col-span-3">Submitted</div>
              <div className="col-span-2 text-right">Status</div>
            </div>

            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {(recent as any).leads.map((x: any) => (
                <li
                  key={x.id}
                  className={cn(
                    "grid grid-cols-12 items-center px-4 py-3",
                    x.isRead ? "" : "bg-yellow-50/60 dark:bg-yellow-950/10"
                  )}
                >
                  <div className="col-span-5">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{x.customerName}</div>
                    {x.customerPhone ? (
                      <div className="text-xs text-gray-600 dark:text-gray-300">{x.customerPhone}</div>
                    ) : null}
                  </div>

                  <div className="col-span-2">{chip(stageLabel(x.stage), stageLabel(x.stage) === "new" ? "blue" : "gray")}</div>

                  <div className="col-span-3 text-sm text-gray-700 dark:text-gray-200">{fmtDate(x.submittedAt)}</div>

                  <div className="col-span-2 flex justify-end">{x.isRead ? chip("Read", "gray") : chip("Unread", "yellow")}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Tip: unread rows are lightly highlighted so you can scan faster.</div>
      </div>
    </div>
  );
}