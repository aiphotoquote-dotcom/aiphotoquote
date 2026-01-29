// src/components/quote/StatusBar.tsx
"use client";

import React from "react";

export function StatusBar({
  statusRef,
  workingLabel,
  workingSubtitle,
  workingRightLabel,
  sticky,
  showRenderingMini,
  renderingLabel,
  progressPct,
}: {
  statusRef: React.RefObject<HTMLDivElement | null>;
  workingLabel: string;
  workingSubtitle: string;
  workingRightLabel: string;
  sticky: boolean;
  showRenderingMini: boolean;
  renderingLabel: string;
  progressPct: number; // 0..100
}) {
  const pct = Number.isFinite(progressPct) ? Math.max(0, Math.min(100, progressPct)) : 0;

  return (
    <div
      ref={statusRef as any}
      className={["max-w-full overflow-hidden", sticky ? "sticky top-0 z-20" : ""].join(" ")}
    >
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          {/* LEFT */}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-600 dark:text-gray-300">Status</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate">{workingLabel}</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">{workingSubtitle}</div>

            {showRenderingMini ? (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                Rendering: <span className="font-semibold">{renderingLabel}</span>
              </div>
            ) : null}
          </div>

          {/* RIGHT */}
          <div className="min-w-0 max-w-[45%] text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{workingRightLabel}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
          <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}