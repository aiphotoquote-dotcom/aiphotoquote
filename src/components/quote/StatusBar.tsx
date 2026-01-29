// src/components/quote/StatusBar.tsx
"use client";

import React from "react";

export function StatusBar({
  statusRef,
  title,
  subtitle,
  rightLabel,
  progressPct,
  sticky,
  showRenderingMini,
  renderingLabel,
  doneLabel,
  doneDisabled,
  onDone,
}: {
  statusRef: React.RefObject<HTMLDivElement | null>;

  title: string;
  subtitle: string;
  rightLabel: string;
  progressPct: number;

  sticky: boolean;

  showRenderingMini: boolean;
  renderingLabel: string;

  doneLabel: string;
  doneDisabled: boolean;
  onDone: () => void;
}) {
  const pct = Number.isFinite(progressPct) ? Math.max(0, Math.min(100, progressPct)) : 0;

  return (
    <div ref={statusRef as any} className={sticky ? "sticky top-0 z-20" : ""}>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-600 dark:text-gray-300">Status</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">{subtitle}</div>

            {showRenderingMini ? (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                Rendering: <span className="font-semibold">{renderingLabel}</span>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 text-right flex flex-col items-end gap-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rightLabel}</div>
            <button
              type="button"
              className="rounded-xl bg-black text-white px-4 py-2 text-xs font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={onDone}
              disabled={doneDisabled}
            >
              {doneLabel}
            </button>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div className="h-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}