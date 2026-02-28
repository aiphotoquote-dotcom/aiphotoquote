// src/components/admin/quote/RenderGallery.tsx
"use client";

import React, { useMemo, useState } from "react";

type RenderRow = {
  id: string;
  imageUrl?: string | null;
  createdAt?: any;
  attempt?: number | null;
  quoteVersionId?: string | null;
  status?: string | null;
  error?: string | null;
  shopNotes?: string | null;
  prompt?: string | null;
};

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function humanWhen(v: any) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

type StatusKey = "all" | "rendered" | "queued" | "running" | "failed" | "other";

function normStatus(s: any): StatusKey {
  const v = safeTrim(s).toLowerCase();
  if (!v) return "other";
  if (v === "rendered" || v === "complete") return "rendered";
  if (v === "queued") return "queued";
  if (v === "running" || v === "processing") return "running";
  if (v === "failed" || v === "error") return "failed";
  return "other";
}

function pill(text: string, tone: "gray" | "good" | "warn" | "bad") {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border whitespace-nowrap";
  const cls =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
        : tone === "bad"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
          : "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";
  return <span className={`${base} ${cls}`}>{text}</span>;
}

function statusTone(s: StatusKey) {
  if (s === "rendered") return "good" as const;
  if (s === "queued" || s === "running") return "warn" as const;
  if (s === "failed") return "bad" as const;
  return "gray" as const;
}

function csv(xs: string[]) {
  return xs.map((x) => encodeURIComponent(x)).join(",");
}

export default function RenderGallery(props: {
  quoteId: string;
  renders: RenderRow[];
  initialFilter?: StatusKey;
  initialSelectedIds?: string[];
}) {
  const { quoteId, renders, initialFilter, initialSelectedIds } = props;

  const [filter, setFilter] = useState<StatusKey>(initialFilter ?? "all");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    Array.isArray(initialSelectedIds) ? initialSelectedIds : []
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      all: renders?.length ?? 0,
      rendered: 0,
      queued: 0,
      running: 0,
      failed: 0,
      other: 0,
    };
    for (const r of renders ?? []) c[normStatus(r?.status)]++;
    return c;
  }, [renders]);

  const filtered = useMemo(() => {
    const list = [...(renders ?? [])];
    // newest first by createdAt
    list.sort((a, b) => {
      const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    if (filter === "all") return list;
    return list.filter((r) => normStatus(r?.status) === filter);
  }, [renders, filter]);

  const active = useMemo(() => {
    if (!activeId) return null;
    return (renders ?? []).find((r) => String(r.id) === String(activeId)) ?? null;
  }, [renders, activeId]);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  const composeHref = useMemo(() => {
    const base = `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose`;
    if (!selectedIds.length) return base;
    return `${base}?renders=${csv(selectedIds)}`;
  }, [quoteId, selectedIds]);

  const hasThumbnails = useMemo(() => {
    return filtered.some((r) => normStatus(r?.status) === "rendered" && safeTrim(r?.imageUrl));
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render gallery</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Click a tile to preview. Use multi-select to include renders in Compose.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pill(`Selected: ${selectedIds.length}`, selectedIds.length ? "good" : "gray")}

          <a
            href={composeHref}
            className={
              "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold border " +
              (selectedIds.length
                ? "bg-black text-white border-black hover:opacity-90 dark:bg-white dark:text-black dark:border-white"
                : "bg-gray-100 text-gray-400 border-gray-200 pointer-events-none dark:bg-gray-900 dark:text-gray-600 dark:border-gray-800")
            }
            title={selectedIds.length ? "Open compose with selected renders" : "Select at least one render to compose"}
          >
            Compose email with selected
          </a>

          {selectedIds.length ? (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={
            "rounded-full px-3 py-1.5 text-xs font-semibold border " +
            (filter === "all"
              ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800 dark:hover:bg-gray-900")
          }
        >
          All ({counts.all})
        </button>

        {(["rendered", "queued", "running", "failed", "other"] as StatusKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold border " +
              (filter === k
                ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800 dark:hover:bg-gray-900")
            }
          >
            {k} ({counts[k]})
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length ? (
        <div className={"grid gap-3 " + (hasThumbnails ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-1 lg:grid-cols-2")}>
          {filtered.map((r) => {
            const id = String(r.id);
            const st = normStatus(r.status);
            const url = safeTrim(r.imageUrl);
            const selected = selectedIds.includes(id);

            const title = `Attempt ${Number(r.attempt ?? 1)} · ${st}`;

            return (
              <div
                key={id}
                className={
                  "rounded-2xl border overflow-hidden bg-white dark:bg-gray-950 " +
                  (selected
                    ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                    : "border-gray-200 dark:border-gray-800")
                }
              >
                <button
                  type="button"
                  onClick={() => setActiveId(id)}
                  className="block w-full text-left"
                  title="Open preview"
                >
                  {st === "rendered" && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={title} className="h-48 w-full object-cover bg-black/5" />
                  ) : (
                    <div className="h-48 w-full flex items-center justify-center bg-gray-50 dark:bg-black">
                      <div className="text-center space-y-2">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{safeTrim(st) || "unknown"}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {r.error ? "Has error" : "No image yet"}
                        </div>
                      </div>
                    </div>
                  )}
                </button>

                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {pill(`Attempt ${Number(r.attempt ?? 1)}`, "gray")}
                      {pill(safeTrim(st) || "unknown", statusTone(st))}
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggle(id)}
                        className="h-4 w-4"
                        aria-label="Select render"
                      />
                      Select
                    </label>
                  </div>

                  <div className="text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
                    <span>{humanWhen(r.createdAt)}</span>
                    {r.quoteVersionId ? (
                      <span className="font-mono">vId:{String(r.quoteVersionId).slice(0, 8)}…</span>
                    ) : null}
                  </div>

                  {r.error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100 line-clamp-3">
                      {String(r.error)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
          No render attempts in this filter.
        </div>
      )}

      {/* Lightbox */}
      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // click outside closes
            if (e.target === e.currentTarget) setActiveId(null);
          }}
        >
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {pill(`Attempt ${Number(active.attempt ?? 1)}`, "gray")}
                  {pill(normStatus(active.status), statusTone(normStatus(active.status)))}
                  {selectedIds.includes(String(active.id)) ? pill("SELECTED", "good") : null}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {humanWhen(active.createdAt)}{" "}
                  {active.quoteVersionId ? (
                    <span className="font-mono">· versionId:{String(active.quoteVersionId)}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(String(active.id))}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-semibold border " +
                    (selectedIds.includes(String(active.id))
                      ? "bg-black text-white border-black hover:opacity-90 dark:bg-white dark:text-black dark:border-white"
                      : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800 dark:hover:bg-gray-900")
                  }
                >
                  {selectedIds.includes(String(active.id)) ? "Selected" : "Select"}
                </button>

                {safeTrim(active.imageUrl) ? (
                  <a
                    href={String(active.imageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    Open original
                  </a>
                ) : null}

                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-0 lg:grid-cols-[1.6fr_1fr]">
              <div className="bg-black/5 dark:bg-black">
                {safeTrim(active.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={String(active.imageUrl)}
                    alt="Render preview"
                    className="w-full max-h-[70vh] object-contain"
                  />
                ) : (
                  <div className="flex h-[50vh] items-center justify-center text-sm text-gray-700 dark:text-gray-200">
                    No image for this attempt.
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3">
                {active.shopNotes ? (
                  <details open>
                    <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
                      Shop notes
                    </summary>
                    <div className="mt-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
                      {String(active.shopNotes)}
                    </div>
                  </details>
                ) : (
                  <div className="text-xs text-gray-600 dark:text-gray-300 italic">No shop notes.</div>
                )}

                {active.error ? (
                  <details open>
                    <summary className="cursor-pointer text-xs font-semibold text-red-700 dark:text-red-200">
                      Error
                    </summary>
                    <div className="mt-2 text-sm text-red-800 dark:text-red-100 whitespace-pre-wrap">
                      {String(active.error)}
                    </div>
                  </details>
                ) : null}

                {active.prompt ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
                      Prompt (debug)
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
{String(active.prompt)}
                    </pre>
                  </details>
                ) : null}

                <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                  <a
                    href={composeHref}
                    className={
                      "inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold " +
                      (selectedIds.length
                        ? "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                        : "bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400 pointer-events-none")
                    }
                  >
                    Go to Compose with selected
                  </a>
                  <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 break-all">
                    {selectedIds.length ? `renders=${selectedIds.join(",")}` : "Select at least one render to compose"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}