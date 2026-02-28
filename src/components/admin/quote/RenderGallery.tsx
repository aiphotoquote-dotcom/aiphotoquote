// src/components/admin/quote/RenderGallery.tsx
"use client";

import React, { useMemo, useState } from "react";

import { chip, renderStatusTone } from "@/components/admin/quote/ui";
import { humanWhen, safeTrim } from "@/lib/admin/quotes/utils";

import type { QuoteRenderRow, QuoteVersionRow } from "@/lib/admin/quotes/getLifecycle";

type Props = {
  quoteId: string;
  renderRows: QuoteRenderRow[];
  versionRows: QuoteVersionRow[];
  activeVersion: number | null;
};

function asNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sortRendersDesc(rows: QuoteRenderRow[]) {
  return [...(rows ?? [])].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
    return tb - ta;
  });
}

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

export default function RenderGallery(props: Props) {
  const { quoteId, renderRows, versionRows, activeVersion } = props;

  const renders = useMemo(() => sortRendersDesc(renderRows ?? []), [renderRows]);

  const versionOptions = useMemo(() => {
    // Map versionId -> versionNumber for labeling
    const map = new Map<string, number>();
    for (const v of versionRows ?? []) {
      if (v?.id) map.set(String(v.id), Number(v.version ?? 0));
    }
    return map;
  }, [versionRows]);

  const versionIdsInRenders = useMemo(() => {
    const ids = renders
      .map((r) => safeTrim((r as any)?.quoteVersionId))
      .filter(Boolean) as string[];
    return uniq(ids);
  }, [renders]);

  const defaultSelectedId = renders[0]?.id ? String(renders[0].id) : "";
  const [selectedId, setSelectedId] = useState<string>(defaultSelectedId);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [versionFilter, setVersionFilter] = useState<string>(
    activeVersion != null
      ? // try to preselect the active version if we can find matching versionId
        (versionIdsInRenders.find((vid) => versionOptions.get(vid) === activeVersion) ?? "all")
      : "all"
  );

  const filtered = useMemo(() => {
    return renders.filter((r) => {
      const statusOk = statusFilter === "all" ? true : String(r.status ?? "") === statusFilter;
      const vid = safeTrim((r as any)?.quoteVersionId);
      const versionOk = versionFilter === "all" ? true : vid === versionFilter;
      return statusOk && versionOk;
    });
  }, [renders, statusFilter, versionFilter]);

  const selected = useMemo(() => {
    const hit = filtered.find((r) => String(r.id) === selectedId);
    if (hit) return hit;
    const anyHit = renders.find((r) => String(r.id) === selectedId);
    return anyHit ?? filtered[0] ?? renders[0] ?? null;
  }, [filtered, renders, selectedId]);

  const statuses = useMemo(() => {
    const xs = uniq(renders.map((r) => String(r.status ?? "")).filter(Boolean));
    // keep common ones first if present
    const order = ["queued", "running", "rendered", "failed"];
    xs.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return xs;
  }, [renders]);

  function versionLabelFromRender(r: QuoteRenderRow) {
    const vid = safeTrim((r as any)?.quoteVersionId);
    if (!vid) return "—";
    const vnum = versionOptions.get(vid);
    if (typeof vnum === "number" && Number.isFinite(vnum)) return `v${vnum}`;
    return "version";
  }

  const selectedVersionLabel = selected ? versionLabelFromRender(selected) : "—";

  const selectedAttempt = selected ? Number((selected as any).attempt ?? 1) : 0;
  const selectedStatus = selected ? String((selected as any).status ?? "") : "";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-3">
        {/* Header + filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render gallery</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Pick a render visually. (Next: select one to include in a combined quote email.)
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Version filter */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Version</div>
              <select
                value={versionFilter}
                onChange={(e) => setVersionFilter(e.target.value)}
                className="mt-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-800 dark:bg-black"
              >
                <option value="all">All</option>
                {versionIdsInRenders.map((vid) => {
                  const vnum = versionOptions.get(vid);
                  const label = vnum ? `v${vnum}` : "version";
                  const isActive = activeVersion != null && vnum === activeVersion;
                  return (
                    <option key={vid} value={vid}>
                      {label} {isActive ? "(active)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Status filter */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Status</div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-800 dark:bg-black"
              >
                <option value="all">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Main split: preview + thumbnails */}
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Preview */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-black">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {selected ? chip(selectedVersionLabel, "blue") : chip("—", "gray")}
                  {selected ? chip(`Attempt ${selectedAttempt}`, "gray") : null}
                  {selected ? chip(selectedStatus || "unknown", renderStatusTone(selectedStatus)) : null}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {selected?.createdAt ? humanWhen(selected.createdAt) : ""}
                </div>
              </div>

              {selected?.imageUrl ? (
                <a href={String(selected.imageUrl)} target="_blank" rel="noreferrer" className="mt-3 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={String(selected.imageUrl)}
                    alt="Selected render"
                    className="w-full rounded-2xl border border-gray-200 bg-white object-contain dark:border-gray-800"
                  />
                  <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Open original</div>
                </a>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  {selected ? "No image yet for this attempt." : "No renders yet."}
                </div>
              )}

              {selected?.error ? (
                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {String(selected.error)}
                </div>
              ) : null}

              {/* Future hook: email composer */}
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Next step (coming)</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Selected render id:{" "}
                  <span className="font-mono break-all">{selected?.id ? String(selected.id) : "—"}</span>
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  We’ll use this + the active version output to send a “combined quote email”.
                </div>
                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  quoteId=<span className="font-mono">{quoteId}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Thumbnails */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Thumbnails ({filtered.length})
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-gray-600 hover:underline dark:text-gray-300"
                onClick={() => {
                  const first = filtered[0]?.id ? String(filtered[0].id) : "";
                  if (first) setSelectedId(first);
                }}
              >
                Jump to newest
              </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              {filtered.length ? (
                filtered.slice(0, 60).map((r) => {
                  const id = String(r.id);
                  const isSelected = selected?.id ? String(selected.id) === id : id === selectedId;
                  const img = safeTrim((r as any)?.imageUrl);
                  const status = String((r as any)?.status ?? "");
                  const vlabel = versionLabelFromRender(r);

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={
                        "group rounded-xl border p-1 text-left transition " +
                        (isSelected
                          ? "border-green-300 ring-2 ring-green-200 dark:border-green-900/60 dark:ring-green-900/30"
                          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                      }
                      title={`Select ${vlabel} • ${status}`}
                    >
                      <div className="flex items-center justify-between gap-1 px-1">
                        <div className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{vlabel}</div>
                        <div className="text-[10px]">{chip(status || "unknown", renderStatusTone(status))}</div>
                      </div>

                      <div className="mt-1 aspect-square overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-900">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="Render thumb" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
                            no image
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="col-span-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  No renders match these filters.
                </div>
              )}
            </div>

            {filtered.length > 60 ? (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                Showing newest 60 for speed. (We can add paging later.)
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}