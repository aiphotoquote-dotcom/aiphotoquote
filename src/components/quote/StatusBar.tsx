// src/components/quote/StatusBar.tsx
"use client";

import React from "react";

export function StatusBar({
  statusRef,
  title,
  subtitle,
  rightLabel,
  sticky,
  progressPct,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  statusRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  subtitle: string;
  rightLabel: string;
  sticky: boolean;
  progressPct: number; // 0-100
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(progressPct) ? progressPct : 0));

  /**
   * IMPORTANT:
   * When sticky, this region must NOT intercept clicks outside its visual area.
   * Some layouts/stacking contexts can cause the sticky wrapper to behave like an invisible overlay.
   *
   * Fix:
   * - wrapper: pointer-events-none (so it cannot block clicks underneath)
   * - inner card: pointer-events-auto (so the bar + button still works)
   */
  const wrapperClass = [
    "w-full max-w-full",
    sticky ? "sticky top-0 z-30 pointer-events-none" : "",
  ].join(" ");

  return (
    <div ref={statusRef as any} className={wrapperClass}>
      <div className="pointer-events-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          {/* LEFT */}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-600 dark:text-gray-300">Status</div>

            {/* Title should NOT truncate */}
            <div className="mt-1 break-words text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </div>

            {/* Subtitle should NOT truncate */}
            <div className="mt-1 break-words text-sm text-gray-600 dark:text-gray-300">
              {subtitle}
            </div>
          </div>

          {/* RIGHT */}
          <div className="shrink-0 text-right">
            <div className="whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-gray-100">
              {rightLabel}
            </div>
          </div>
        </div>

        {/* Optional primary action (kept simple, below content) */}
        {primaryLabel && onPrimary ? (
          <button
            type="button"
            className="mt-3 w-full rounded-xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
            onClick={onPrimary}
            disabled={Boolean(primaryDisabled)}
          >
            {primaryLabel}
          </button>
        ) : null}

        {/* Progress bar (ALWAYS visible) */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div className="h-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
