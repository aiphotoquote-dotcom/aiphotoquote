"use client";

import TopNav from "@/components/TopNav";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RecentQuotesResp =
  | {
      ok: true;
      quotes: Array<{
        id: string;
        createdAt: string;

        // optional fields (endpoint may or may not include)
        estimateLow?: number | null;
        estimateHigh?: number | null;
        inspectionRequired?: boolean | null;

        renderStatus?: string | null; // "not_requested" | "queued" | "running" | "rendered" | "failed"
        renderImageUrl?: string | null;
        renderOptIn?: boolean | null;
      }>;
    }
  | { ok: false; error: any; message?: string };

type TabKey = "new" | "progress" | "booked" | "all";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(label: string, tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray") {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

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
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// TEMP mapping: until we add a real quote workflow status column.
// We map the existing render_status into “New / In Progress / Booked”.
function tabForQuote(q: { renderStatus?: string | null }): TabKey {
  const s = (q.renderStatus || "not_requested").toLowerCase();

  if (s === "queued" || s === "running") return "progress";
  if (s === "rendered") return "booked";
  // failed + not_requested fall back to "new" for now
  return "new";
}

function statusBadge(q: {
  renderStatus?: string | null;
  renderOptIn?: boolean | null;
  renderImageUrl?: string | null;
}) {
  const s = (q.renderStatus || "not_requested").toLowerCase();

  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");

  // not_requested
  if (q.renderOptIn) return pill("Render requested", "yellow");
  return pill("Estimate", "gray");
}

function CountPill({ n }: { n: number }) {
  return (
    <span className="ml-2 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {n}
    </span>
  );
}

export default function AdminQuotesPage() {
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<RecentQuotesResp | null>(null);

  const [tab, setTab] = useState<TabKey>("new");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Reuse the same endpoint the dashboard uses so we don’t add backend logic in C1.
        const res = await fetch("/api/tenant/recent-quotes", { cache: "no-store" });
        const json: RecentQuotesResp = await res.json();
        if (!cancelled) setResp(json);
      } catch (e) {
        if (!cancelled) setResp({ ok: false, error: "FETCH_FAILED", message: String(e) });
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
    const ok = Boolean(resp && "ok" in resp && resp.ok);
    const quotes = ok ? (resp as any).quotes : [];

    // Derive tab buckets from render_status for now.
    const withTab = quotes.map((x: any) => ({
      ...x,
      __tab: tabForQuote(x),
    }));

    const counts = {
      new: withTab.filter((x: any) => x.__tab === "new").length,
      progress: withTab.filter((x: any) => x.__tab === "progress").length,
      booked: withTab.filter((x: any) => x.__tab === "booked").length,
      all: withTab.length,
    };

    let filtered = withTab;
    if (tab !== "all") filtered = filtered.filter((x: any) => x.__tab === tab);

    const needle = q.trim().toLowerCase();
    if (needle) {
      filtered = filtered.filter((x: any) => {
        const id = String(x.id || "").toLowerCase();
        const rs = String(x.renderStatus || "").toLowerCase();
        const est = `${x.estimateLow ?? ""}-${x.estimateHigh ?? ""}`.toLowerCase();
        return id.includes(needle) || rs.includes(needle) || est.includes(needle);
      });
    }

    return { ok, quotes: filtered, counts };
  }, [resp, tab, q]);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Admin · Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Review leads fast. Move them forward.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {loading ? pill("Loading…", "gray") : computed.ok ? pill("Live", "green") : pill("Offline", "red")}
          </div>
        </div>

        {/* Sticky controls */}
        <div className="sticky top-0 z-10 -mx-6 border-b border-gray-200 bg-white/85 px-6 py-4 backdrop-blur dark:border-gray-800 dark:bg-black/70">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Tabs */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTab("new")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold",
                  tab === "new"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                )}
              >
                New <CountPill n={computed.counts.new} />
              </button>

              <button
                type="button"
                onClick={() => setTab("progress")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold",
                  tab === "progress"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                )}
              >
                In Progress <CountPill n={computed.counts.progress} />
              </button>

              <button
                type="button"
                onClick={() => setTab("booked")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold",
                  tab === "booked"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                )}
              >
                Booked <CountPill n={computed.counts.booked} />
              </button>

              <button
                type="button"
                onClick={() => setTab("all")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold",
                  tab === "all"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                )}
              >
                All <CountPill n={computed.counts.all} />
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by quote id / status / estimate…"
                className="w-full sm:w-[360px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Small note so this doesn’t “lie” about booked yet */}
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Note: “New / In Progress / Booked” are temporarily based on render status. Next step is real workflow status.
          </div>
        </div>

        {/* Content */}
        {!loading && resp && "ok" in resp && !resp.ok ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            Couldn’t load quotes.
            <div className="mt-2 text-xs opacity-90">{String((resp as any).message || (resp as any).error || "")}</div>
          </div>
        ) : null}

        <div className="grid gap-4">
          {loading ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              Loading quotes…
            </div>
          ) : computed.quotes.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-950">
              <div className="text-lg font-semibold">Nothing here yet</div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Run a test quote on your public page to see it show up.
              </div>
              <div className="mt-5">
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                >
                  Back to Dashboard
                </Link>
              </div>
            </div>
          ) : (
            computed.quotes.map((x: any) => {
              const est =
                typeof x.estimateLow === "number" || typeof x.estimateHigh === "number"
                  ? `${money(x.estimateLow)}${x.estimateHigh != null ? ` – ${money(x.estimateHigh)}` : ""}`
                  : "";

              return (
                <div
                  key={x.id}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {statusBadge(x)}
                        <span className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(x.createdAt)}</span>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <div className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                          {x.id}
                        </div>
                      </div>

                      {est ? (
                        <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                          Est: <span className="font-semibold">{est}</span>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                          Estimate: <span className="font-semibold">—</span>
                        </div>
                      )}

                      {x.inspectionRequired ? (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          Inspection required
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/admin/quotes/${x.id}`}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Review
                      </Link>

                      {x.renderImageUrl ? (
                        <a
                          href={x.renderImageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                        >
                          View render
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
