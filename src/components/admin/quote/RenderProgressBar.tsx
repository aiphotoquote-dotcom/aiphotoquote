// src/components/admin/quote/RenderProgressBar.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function RenderProgressBar(props: {
  active: boolean;
  queuedCount: number;
  runningCount: number;
  refreshMs?: number;

  /**
   * If true, when the bar becomes active it scrolls into view to "take focus".
   * Default: true
   */
  autoFocus?: boolean;
}) {
  const { active, queuedCount, runningCount, refreshMs = 2500, autoFocus = true } = props;
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);

  // Auto-refresh while active so the UI updates as renders complete
  useEffect(() => {
    if (!active) return;
    const ms = clamp(Number(refreshMs) || 2500, 1200, 10000);
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, refreshMs, router]);

  // Auto-focus / scroll into view when active flips on
  useEffect(() => {
    if (!active) return;
    if (!autoFocus) return;

    // defer until after paint
    const t = setTimeout(() => {
      try {
        ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore
      }
    }, 50);

    return () => clearTimeout(t);
  }, [active, autoFocus]);

  if (!active) return null;

  const q = Number(queuedCount) || 0;
  const r = Number(runningCount) || 0;
  const total = q + r;

  return (
    <div
      ref={ref}
      className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/30"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">Rendering in progress</div>
        <div className="text-xs font-semibold text-blue-900/80 dark:text-blue-200/80">
          {r > 0 ? `Running: ${r}` : null}
          {r > 0 && q > 0 ? " · " : null}
          {q > 0 ? `Queued: ${q}` : null}
          {total ? ` · Total: ${total}` : null}
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/40">
        <div className="h-2 w-2/3 rounded-full bg-blue-700 dark:bg-blue-200 animate-pulse" />
      </div>

      <div className="mt-2 text-xs text-blue-900/80 dark:text-blue-200/80">
        Auto-refreshing while renders are queued/running…
      </div>
    </div>
  );
}