// src/components/quote/StatusBar.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

export type StepperStep = {
  key: string;
  label: string;
  state: "todo" | "active" | "done";
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseStepLabel(s: string) {
  // expects: "Step X of Y"
  const m = String(s || "").match(/Step\s+(\d+)\s+of\s+(\d+)/i);
  if (!m) return null;
  const step = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(step) || !Number.isFinite(total) || total <= 0) return null;
  return { step, total };
}

function isTypingElement(el: Element | null) {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName?.toLowerCase?.() || "";
  if (tag === "input" || tag === "textarea" || tag === "select") return true;

  const he = el as HTMLElement;
  if (typeof he.isContentEditable === "boolean" && he.isContentEditable) return true;

  return false;
}

export function StatusBar({
  statusRef,
  workingLabel,
  workingSubtitle,
  workingRightLabel,
  showRenderingMini,
  renderingLabel,
  sticky = false,

  // Back-compat props (ignored by this UI)
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

  workingActiveDetail?: string | null;
  stepperSteps?: StepperStep[];
}) {
  const stepInfo = useMemo(() => parseStepLabel(workingRightLabel), [workingRightLabel]);
  const isWorking = Boolean(stepInfo);

  const pct = useMemo(() => {
    if (!stepInfo) return 0;
    const raw = (stepInfo.step / stepInfo.total) * 100;
    return clamp(Math.round(raw), 8, 100);
  }, [stepInfo]);

  const renderingIsActive = useMemo(() => {
    const t = String(renderingLabel || "").toLowerCase();
    return t.includes("queued") || t.includes("running") || t.includes("rendering");
  }, [renderingLabel]);

  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const onFocusLike = () => {
      const active = document.activeElement;
      const statusEl = statusRef?.current;

      if (statusEl && active instanceof Element && statusEl.contains(active)) {
        setIsTyping(false);
        return;
      }

      setIsTyping(active instanceof Element ? isTypingElement(active) : false);
    };

    document.addEventListener("focusin", onFocusLike);
    document.addEventListener("focusout", onFocusLike);
    onFocusLike();

    return () => {
      document.removeEventListener("focusin", onFocusLike);
      document.removeEventListener("focusout", onFocusLike);
    };
  }, [statusRef]);

  const effectiveSticky = sticky && isWorking && !isTyping;
  const collapsed = !isWorking || isTyping;

  const showRenderingRow = Boolean(showRenderingMini && (isWorking || renderingIsActive));
  const showRenderingMotion = !isWorking && renderingIsActive;

  return (
    <section
      ref={statusRef as any}
      tabIndex={-1}
      aria-label="Progress status"
      className={[
        // ✅ key: prevent ANY child from widening the page
        "w-full max-w-full overflow-hidden",
        "rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900",
        collapsed ? "p-3" : "p-4",
        effectiveSticky ? "sticky top-2 z-20" : "",
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Status</div>

          <div
            className={[
              "mt-0.5 font-semibold text-gray-900 dark:text-gray-100 truncate",
              collapsed ? "text-base" : "text-lg",
            ].join(" ")}
          >
            {workingLabel}
          </div>

          {workingSubtitle && !collapsed ? (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 truncate">{workingSubtitle}</div>
          ) : null}
        </div>

        {/* ✅ allow shrink + truncate so "Step 3 of 3" never causes horizontal overflow */}
        <div
          className={[
            "min-w-0 max-w-[44%] text-right",
            "overflow-hidden text-ellipsis whitespace-nowrap",
            collapsed
              ? "text-xs font-medium text-gray-600 dark:text-gray-300"
              : "text-sm font-semibold text-gray-700 dark:text-gray-200",
          ].join(" ")}
        >
          {workingRightLabel}
        </div>
      </div>

      {/* Progress bar only while working */}
      {isWorking ? (
        <div className="mt-3 h-2 w-full max-w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
          <div
            // ✅ green that pops
            className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {showRenderingRow ? (
        <div
          className={[
            "rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950",
            isWorking ? "mt-4 p-4" : "mt-3 px-3 py-2",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">AI Rendering</div>
            <div className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">{renderingLabel || "Off"}</div>
          </div>

          {showRenderingMotion ? (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
              <div className="h-full w-1/2 rounded-full bg-emerald-600/80 animate-pulse" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}