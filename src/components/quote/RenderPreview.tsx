// src/components/quote/RenderPreview.tsx
"use client";

import React from "react";
import type { RenderStatus } from "./useQuoteFlow";

export function RenderPreview({
  renderPreviewRef,
  status,
  progressPct,
  imageUrl,
  error,
}: {
  renderPreviewRef: React.RefObject<HTMLDivElement | null>;
  status: RenderStatus;
  progressPct: number;
  imageUrl: string | null;
  error: string | null;
}) {
  const pct = Number.isFinite(progressPct) ? Math.max(0, Math.min(100, progressPct)) : 0;

  const statusLabel =
    status === "running"
      ? "Rendering…"
      : status === "rendered"
        ? "Ready"
        : status === "failed"
          ? "Failed"
          : "Queued";

  return (
    <div
      ref={renderPreviewRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI rendering preview</div>
          <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">Status: {statusLabel}</div>
        </div>

        {/* retry removed */}
        <div className="shrink-0 text-xs font-semibold text-gray-900 dark:text-gray-100">{statusLabel}</div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={["h-full bg-emerald-600 transition-[width] duration-300", status === "running" ? "animate-pulse" : ""].join(" ")}
          style={{ width: status === "rendered" || status === "failed" ? "100%" : `${pct}%` }}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {imageUrl ? (
        <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="AI rendering" className="w-full object-cover" />
        </div>
      ) : (
        <div className="text-sm text-gray-600 dark:text-gray-300 min-h-[2.25rem] flex items-center">
          {status === "running"
            ? "Generating your visual concept now…"
            : status === "failed"
              ? "We couldn’t generate a preview this time."
              : "If enabled, your visual concept will appear here when ready."}
        </div>
      )}
    </div>
  );
}