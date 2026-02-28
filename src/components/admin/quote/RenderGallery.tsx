// src/components/admin/quote/RenderGallery.tsx
"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type RenderRow = {
  id: string;
  status?: string | null;
  imageUrl?: string | null;
  createdAt?: any;
  attempt?: number | null;
  quoteVersionId?: string | null;
};

type FilterKey = "all" | "rendered" | "queued" | "running" | "failed" | "other";

function normStatus(s: any): FilterKey {
  const v = safeTrim(s).toLowerCase();
  if (v === "rendered") return "rendered";
  if (v === "queued") return "queued";
  if (v === "running") return "running";
  if (v === "failed") return "failed";
  if (!v) return "other";
  return (["all", "rendered", "queued", "running", "failed"].includes(v) ? (v as any) : "other") as FilterKey;
}

function pill(active: boolean) {
  return (
    "rounded-full px-3 py-1 text-xs font-semibold border transition " +
    (active
      ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800 dark:hover:bg-gray-900")
  );
}

export default function RenderGallery(props: { quoteId: string; renderRows: RenderRow[] }) {
  const { quoteId, renderRows } = props;

  const rows = useMemo(() => (Array.isArray(renderRows) ? renderRows : []), [renderRows]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: rows.length, rendered: 0, queued: 0, running: 0, failed: 0, other: 0 };
    for (const r of rows) c[normStatus(r.status)]++;
    return c;
  }, [rows]);

  const [filter, setFilter] = useState<FilterKey>("rendered");
  const [selected, setSelected] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => normStatus(r.status) === filter);
  }, [rows, filter]);

  const renderedOnly = useMemo(() => rows.filter((r) => normStatus(r.status) === "rendered" && safeTrim(r.imageUrl)), [rows]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function clear() {
    setSelected([]);
  }

  const composeHref = useMemo(() => {
    const ids = selected.filter(Boolean);
    const qp = ids.length ? `?renders=${encodeURIComponent(ids.join(","))}` : "";
    return `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose${qp}`;
  }, [quoteId, selected]);

  // If user is filtering to non-rendered statuses, selection still works, but compose is meant for rendered images.
  const selectedRenderedCount = useMemo(() => {
    const set = new Set(selected);
    return renderedOnly.filter((r) => set.has(String(r.id))).length;
  }, [selected, renderedOnly]);

  return (
    <section id="renders" className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Render gallery</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Click to preview. Shift-select isn’t needed — just click tiles to multi-select.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Selected: <span className="font-semibold">{selected.length}</span>
          </div>
          <button
            type="button"
            onClick={clear}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            disabled={!selected.length}
            title="Clear selection"
          >
            Clear
          </button>
          <Link
            href={composeHref}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-semibold " +
              (selectedRenderedCount > 0
                ? "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                : "bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400 pointer-events-none")
            }
            title={selectedRenderedCount > 0 ? "Compose email with selected renders" : "Select at least 1 rendered image"}
          >
            Compose email
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setFilter("all")} className={pill(filter === "all")}>
          All ({counts.all})
        </button>
        <button type="button" onClick={() => setFilter("rendered")} className={pill(filter === "rendered")}>
          Rendered ({counts.rendered})
        </button>
        <button type="button" onClick={() => setFilter("queued")} className={pill(filter === "queued")}>
          Queued ({counts.queued})
        </button>
        <button type="button" onClick={() => setFilter("running")} className={pill(filter === "running")}>
          Running ({counts.running})
        </button>
        <button type="button" onClick={() => setFilter("failed")} className={pill(filter === "failed")}>
          Failed ({counts.failed})
        </button>
        <button type="button" onClick={() => setFilter("other")} className={pill(filter === "other")}>
          Other ({counts.other})
        </button>
      </div>

      {/* Gallery */}
      <div className="mt-5">
        {filtered.length ? (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {filtered.map((r) => {
              const id = String(r.id);
              const url = safeTrim(r.imageUrl);
              const isRendered = normStatus(r.status) === "rendered" && !!url;
              const active = selected.includes(id);

              return (
                <div
                  key={id}
                  className={
                    "rounded-2xl border overflow-hidden bg-white dark:bg-gray-950 transition " +
                    (active
                      ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                      : "border-gray-200 dark:border-gray-800")
                  }
                >
                  <button
                    type="button"
                    onClick={() => (isRendered ? setLightboxUrl(url) : null)}
                    className="block w-full text-left"
                    title={isRendered ? "Click to preview" : "No image for this attempt"}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="Render" className="h-40 w-full object-cover bg-black/5" />
                    ) : (
                      <div className="h-40 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
                        No image
                      </div>
                    )}
                  </button>

                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                        Attempt {r.attempt != null ? `#${Number(r.attempt)}` : ""}
                      </div>
                      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                        {safeTrim(r.status) || "unknown"}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        className={
                          "rounded-lg px-2.5 py-1 text-[11px] font-semibold border " +
                          (active
                            ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800 dark:hover:bg-gray-900")
                        }
                        title="Toggle selection"
                        disabled={!isRendered} // keep compose clean: only rendered images selectable
                      >
                        {active ? "Selected" : "Select"}
                      </button>

                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-gray-600 hover:underline dark:text-gray-300"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            Nothing to show for this filter.
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="max-h-[90vh] max-w-[95vw] overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Preview</div>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxUrl} alt="Render preview" className="max-h-[80vh] w-auto object-contain bg-black/5" />
          </div>
        </div>
      ) : null}
    </section>
  );
}