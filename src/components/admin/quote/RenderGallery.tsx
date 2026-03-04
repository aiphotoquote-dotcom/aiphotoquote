// src/components/admin/quote/RenderGallery.tsx
"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

// ✅ Import the server action directly (do NOT pass as prop)
import { deleteRenderAction } from "@/app/admin/quotes/[id]/actions";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isHttpUrl(u: string) {
  const s = safeTrim(u);
  if (!s) return false;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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

type BaseKind = "none" | "customer_photo" | "render";

type BaseSelection =
  | { kind: "none"; key: ""; url: ""; renderId: "" }
  | { kind: "customer_photo"; key: string; url: string; renderId: "" }
  | { kind: "render"; key: string; url: string; renderId: string };

function setBaseHiddenInputs(args: { kind: BaseKind; url: string; renderId: string }) {
  try {
    const hidKind = document.getElementById("apq-base-kind") as HTMLInputElement | null;
    const hidId = document.getElementById("apq-base-render-id") as HTMLInputElement | null;
    const hidUrl = document.getElementById("apq-base-image-url") as HTMLInputElement | null;

    if (hidKind) hidKind.value = args.kind || "none";
    if (hidId) hidId.value = args.renderId || "";
    if (hidUrl) hidUrl.value = args.url || "";
  } catch {
    // ignore
  }
}

function setBaseDisplay(html: string) {
  try {
    const display = document.getElementById("apq-render-base-display");
    if (display) display.innerHTML = html;

    const form = document.getElementById("apq-new-render-form");
    form?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  } catch {
    // ignore
  }
}

function clearBaseSelectionDom() {
  setBaseHiddenInputs({ kind: "none", url: "", renderId: "" });
  setBaseDisplay(
    `Base image: <span class="font-mono">default customer photo</span> <span class="text-gray-500">(pick a customer photo below, or click “Use as base” on a render)</span>`
  );
}

function renderBaseButtonClass(isSelected: boolean) {
  // ✅ obvious “selected” state
  return (
    "inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition " +
    (isSelected
      ? "bg-blue-700 text-white border-blue-700 hover:opacity-90 dark:bg-blue-400 dark:text-black dark:border-blue-400"
      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800 dark:hover:bg-gray-900")
  );
}

export default function RenderGallery(props: {
  quoteId: string;
  renderRows: RenderRow[];
  customerPhotos?: any[];
}) {
  const { quoteId, renderRows, customerPhotos } = props;

  const rows = useMemo(() => (Array.isArray(renderRows) ? renderRows : []), [renderRows]);
  const photos = useMemo(() => (Array.isArray(customerPhotos) ? customerPhotos : []), [customerPhotos]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: rows.length, rendered: 0, queued: 0, running: 0, failed: 0, other: 0 };
    for (const r of rows) c[normStatus(r.status)]++;
    return c;
  }, [rows]);

  const [filter, setFilter] = useState<FilterKey>("rendered");
  const [selected, setSelected] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ✅ single base selection (render OR customer photo)
  const [base, setBase] = useState<BaseSelection>({ kind: "none", key: "", url: "", renderId: "" });

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => normStatus(r.status) === filter);
  }, [rows, filter]);

  const renderedOnly = useMemo(
    () => rows.filter((r) => normStatus(r.status) === "rendered" && safeTrim(r.imageUrl)),
    [rows]
  );

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function clearSelected() {
    setSelected([]);
  }

  function clearBase() {
    setBase({ kind: "none", key: "", url: "", renderId: "" });
    clearBaseSelectionDom();
  }

  function toggleBase(next: BaseSelection) {
    // clicking the SAME base again deselects
    if (base.key && next.key === base.key) {
      clearBase();
      return;
    }

    setBase(next);

    setBaseHiddenInputs({
      kind: next.kind,
      url: next.url || "",
      renderId: next.kind === "render" ? next.renderId : "",
    });

    if (next.kind === "customer_photo") {
      setBaseDisplay(
        `Base image: <span class="font-mono">customer photo</span> <span class="text-gray-500">(anchoring the next render to a customer photo)</span>`
      );
    } else if (next.kind === "render") {
      setBaseDisplay(
        `Base image: <span class="font-mono">render ${safeTrim(next.renderId).slice(0, 6)}</span> <span class="text-gray-500">(evolving from a prior attempt)</span>`
      );
    }
  }

  const composeHref = useMemo(() => {
    const ids = selected.filter(Boolean);
    const qp = ids.length ? `?renders=${encodeURIComponent(ids.join(","))}` : "";
    return `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose${qp}`;
  }, [quoteId, selected]);

  const selectedRenderedCount = useMemo(() => {
    const set = new Set(selected);
    return renderedOnly.filter((r) => set.has(String(r.id))).length;
  }, [selected, renderedOnly]);

  // ---- customer photos helpers ----
  function photoUrl(p: any) {
    const u = safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
    return isHttpUrl(u) ? u : "";
  }

  const photoTiles = useMemo(() => {
    return photos
      .map((p) => {
        const url = photoUrl(p);
        return url ? { url } : null;
      })
      .filter(Boolean) as Array<{ url: string }>;
  }, [photos]);

  return (
    <section
      id="renders"
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Render gallery</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Pick a base image (customer photo or prior render), preview results, and multi-select renders for email.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearBase}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            title="Clear base image selection for new renders"
          >
            Clear base
          </button>

          <div className="text-xs text-gray-600 dark:text-gray-300">
            Selected: <span className="font-semibold">{selected.length}</span>
          </div>

          <button
            type="button"
            onClick={clearSelected}
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

      {/* Customer photos (base selection) */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Customer photos</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Click “Use as base” to anchor the next render.</div>
        </div>

        <div className="mt-3">
          {photoTiles.length ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {photoTiles.map((p, idx) => {
                const key = `customer_photo:${p.url}`;
                const isSelected = base.key === key;

                return (
                  <div
                    key={key}
                    className={
                      "rounded-2xl border overflow-hidden bg-white dark:bg-gray-950 transition " +
                      (isSelected
                        ? "border-blue-600 ring-2 ring-blue-600 dark:border-blue-400 dark:ring-blue-400"
                        : "border-gray-200 dark:border-gray-800")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(p.url)}
                      className="block w-full text-left"
                      title="Click to preview"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="Customer photo" className="h-40 w-full object-cover bg-black/5" />
                    </button>

                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Photo #{idx + 1}</div>
                        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">customer</span>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            toggleBase({
                              kind: "customer_photo",
                              key,
                              url: p.url,
                              renderId: "",
                            })
                          }
                          className={renderBaseButtonClass(isSelected)}
                          title={isSelected ? "Deselect base" : "Use this customer photo as the base input"}
                        >
                          {isSelected ? "Base selected" : "Use as base"}
                        </button>

                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-gray-600 hover:underline dark:text-gray-300"
                        >
                          Open
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              No customer photos on this quote.
            </div>
          )}
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

              const attemptLabel = r.attempt != null ? `#${Number(r.attempt)}` : "";
              const baseKey = `render:${id}`;
              const baseSelected = base.key === baseKey;

              return (
                <div
                  key={id}
                  className={
                    "rounded-2xl border overflow-hidden bg-white dark:bg-gray-950 transition " +
                    (active
                      ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                      : baseSelected
                        ? "border-blue-600 ring-2 ring-blue-600 dark:border-blue-400 dark:ring-blue-400"
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
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Attempt {attemptLabel}</div>
                      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                        {safeTrim(r.status) || "unknown"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
                        disabled={!isRendered}
                      >
                        {active ? "Selected" : "Select"}
                      </button>

                      <div className="flex items-center gap-2">
                        {isRendered ? (
                          <button
                            type="button"
                            onClick={() =>
                              toggleBase({
                                kind: "render",
                                key: baseKey,
                                url,
                                renderId: id,
                              })
                            }
                            className={renderBaseButtonClass(baseSelected)}
                            title={baseSelected ? "Deselect base" : "Use this rendered image as the base input"}
                          >
                            {baseSelected ? "Base selected" : "Use as base"}
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}

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

                        {/* ✅ Delete render attempt */}
                        <form
                          action={deleteRenderAction}
                          onSubmit={(e) => {
                            if (!window.confirm("Delete this render attempt? This cannot be undone.")) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="quote_id" value={quoteId} />
                          <input type="hidden" name="render_id" value={id} />
                          <button
                            type="submit"
                            className="text-[11px] font-semibold text-red-700 hover:underline dark:text-red-300"
                            title="Delete this render attempt"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
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
            <img src={lightboxUrl} alt="Preview" className="max-h-[80vh] w-auto object-contain bg-black/5" />
          </div>
        </div>
      ) : null}
    </section>
  );
}