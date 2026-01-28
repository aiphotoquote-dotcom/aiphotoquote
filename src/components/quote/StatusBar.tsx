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

  // Keep layout stable: do NOT change padding/font-size/rows based on typing.
  // When typing, we “de-emphasize” via opacity + line-clamp instead.
  const deemphasize = !isWorking || isTyping;

  const showRenderingRow = Boolean(showRenderingMini && (isWorking || renderingIsActive));
  const showRenderingMotion = !isWorking && renderingIsActive;

  return (
    <section
      ref={statusRef as any}
      tabIndex={-1}
      aria-label="Progress status"
      className={[
        "rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900",
        "p-4", // ✅ stable
        effectiveSticky ? "sticky top-2 z-20" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Status</div>

          <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
            {workingLabel}
          </div>

          {workingSubtitle ? (
            <div
              className={[
                "mt-1 text-xs text-gray-600 dark:text-gray-300 truncate transition-opacity duration-150",
                deemphasize ? "opacity-60" : "opacity-100",
              ].join(" ")}
            >
              {workingSubtitle}
            </div>
          ) : (
            // ✅ stable vertical rhythm even when subtitle missing
            <div className="mt-1 text-xs opacity-0 select-none">.</div>
          )}
        </div>

        <div
          className={[
            "shrink-0 whitespace-nowrap transition-opacity duration-150",
            deemphasize ? "text-xs font-medium text-gray-600 dark:text-gray-300" : "text-sm font-semibold text-gray-700 dark:text-gray-200",
          ].join(" ")}
        >
          {workingRightLabel}
        </div>
      </div>

      {isWorking ? (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
          <div
            className="h-full rounded-full bg-gray-900/80 dark:bg-gray-100/90 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        // ✅ stable spacer so height doesn’t jump when work starts/stops during keyboard animation
        <div className="mt-3 h-2 w-full opacity-0 select-none" aria-hidden="true" />
      )}

      {showRenderingRow ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{renderingLabel || "Off"}</div>
          </div>

          {showRenderingMotion ? (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
              <div className="h-full w-1/2 rounded-full bg-gray-900/70 dark:bg-gray-100/80 animate-pulse" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}