// src/components/quote/StatusBar.tsx
"use client";

import React, { useMemo } from "react";

export type StepperStep = {
  key: string;
  label: string;
  state: "todo" | "active" | "done";
};

export function StatusBar({
  statusRef,
  workingLabel,
  workingSubtitle,
  workingRightLabel,
  showRenderingMini,
  renderingLabel,
  sticky = false,

  // Back-compat props (ignored by the B layout UI)
  workingActiveDetail,
  stepperSteps,
}: {
  statusRef: React.RefObject<HTMLElement | null>;
  workingLabel: string;
  workingSubtitle?: string | null;
  workingRightLabel: string;
  showRenderingMini?: boolean;
  renderingLabel?: string;
  sticky?: boolean;

  // ✅ allow older callers / typings
  workingActiveDetail?: string | null;
  stepperSteps?: StepperStep[];
}) {
  // Heuristic so we don't need a new prop:
  // QuoteForm uses "Step X of Y" only while actively working.
  const isWorking = useMemo(() => /^Step\s+\d+\s+of\s+\d+/.test(workingRightLabel), [workingRightLabel]);

  return (
    <section
      ref={statusRef as any}
      tabIndex={-1}
      aria-label="Progress status"
      className={[
        "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900",
        sticky ? "sticky top-3 z-20" : "",
      ].join(" ")}
    >
      {/* Header row: Status + right label */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Status</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
            {workingLabel}
          </div>
          {workingSubtitle ? (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 truncate">{workingSubtitle}</div>
          ) : null}
        </div>

        <div className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">
          {workingRightLabel}
        </div>
      </div>

      {/* Option B: progress bar only while working */}
      {isWorking ? (
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
          aria-hidden="true"
        >
          <div className="h-full w-2/3 rounded-full bg-black dark:bg-white" />
        </div>
      ) : null}

      {/* Optional: AI Rendering mini row (compact, matches B vibe) */}
      {showRenderingMini ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{renderingLabel || "Off"}</div>
          </div>

          {/* Only show a tiny bar when the rendering is actually active */}
          {String(renderingLabel || "")
            .toLowerCase()
            .includes("render") ? (
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
              aria-hidden="true"
            >
              <div className="h-full w-1/2 rounded-full bg-black dark:bg-white" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}