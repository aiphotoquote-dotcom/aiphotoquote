// src/components/quote/StatusBar.tsx
"use client";

import React from "react";
import { cn } from "./ui";

export type StepState = "todo" | "active" | "done";

export type StepperStep = {
  key: string;
  label: string;
  state: StepState;
};

export function StatusBar({
  statusRef,
  workingLabel,
  workingSubtitle,
  workingRightLabel,
  workingActiveDetail,
  stepperSteps,
  sticky = true,
  showRenderingMini = false,
  renderingLabel,
}: {
  statusRef: React.RefObject<HTMLElement | null>;
  workingLabel: string;
  workingSubtitle: string;
  workingRightLabel: string;
  workingActiveDetail?: string | null;
  stepperSteps: StepperStep[];
  sticky?: boolean;
  showRenderingMini?: boolean;
  renderingLabel?: string | null;
}) {
  return (
    <section
      ref={statusRef as any}
      tabIndex={-1}
      aria-label="Progress status"
      className={cn(
        "rounded-2xl border border-gray-200 bg-white p-5 outline-none focus:ring-2 focus:ring-black/20 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-white/20",
        sticky
          ? "sticky top-2 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-gray-900/80"
          : ""
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Status</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{workingLabel}</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{workingSubtitle}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{workingRightLabel}</div>

          {showRenderingMini ? (
            <div className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              Rendering: {renderingLabel || "Waiting"}
            </div>
          ) : null}
        </div>
      </div>

      {/* HORIZONTAL stepper (scrolls on small screens) */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="flex items-center gap-3">
            {stepperSteps.map((step, idx) => {
              const isDone = step.state === "done";
              const isActive = step.state === "active";

              const dotCls = isDone
                ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                : isActive
                  ? "bg-white text-black border-black dark:bg-black dark:text-white dark:border-white"
                  : "bg-gray-100 text-gray-400 border-gray-300 dark:bg-gray-900 dark:text-gray-500 dark:border-gray-800";

              return (
                <React.Fragment key={step.key}>
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        dotCls
                      )}
                      aria-label={`${step.label}: ${
                        step.state === "done" ? "done" : step.state === "active" ? "in progress" : "pending"
                      }`}
                    >
                      {isDone ? "✓" : idx + 1}
                    </div>

                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-sm font-semibold",
                          step.state === "todo"
                            ? "text-gray-400 dark:text-gray-500"
                            : "text-gray-900 dark:text-gray-100"
                        )}
                      >
                        {step.label}
                      </div>

                      {isActive ? (
                        <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                          {workingActiveDetail || "In progress…"}
                        </div>
                      ) : isDone ? (
                        <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">Completed</div>
                      ) : (
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Pending</div>
                      )}
                    </div>
                  </div>

                  {idx !== stepperSteps.length - 1 ? (
                    <div
                      className={cn(
                        "mx-1 h-px flex-1",
                        isDone ? "bg-gray-900 dark:bg-gray-100" : "bg-gray-200 dark:bg-gray-800"
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}