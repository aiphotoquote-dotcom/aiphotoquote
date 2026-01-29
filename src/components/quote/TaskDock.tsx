"use client";

import React from "react";

export function TaskDock({
  title,
  subtitle,
  rightLabel,
  progressPct,
  primaryLabel,
  onPrimary,
  disabled,
}: {
  title: string;
  subtitle: string;
  rightLabel: string;
  progressPct: number;
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-600 dark:text-gray-300">Next</div>
            <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">{subtitle}</div>
          </div>

          <div className="min-w-0 max-w-[45%] text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{rightLabel}</div>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${Math.max(2, Math.min(100, progressPct))}%` }}
          />
        </div>

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={onPrimary}
          disabled={disabled}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}