// src/components/admin/quote/RenderProgressBar.tsx
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeInt(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * Option B: deterministic % that maps to real job state (queued vs running),
 * WITHOUT pretending we know per-image completion.
 *
 * - queued-only => ~22%
 * - running (with or without queued) => ~72% (and nudges slightly with load)
 *
 * This removes the “stuck at 92%” feeling by never implying near-complete.
 */
function computePct(q: number, r: number) {
  const total = q + r;
  if (total <= 0) return 0;

  // queued-only feels like early stage
  if (r <= 0 && q > 0) {
    // tiny nudge based on backlog size (bounded)
    return clamp(18 + Math.min(12, q * 2), 18, 30);
  }

  // running means real work is happening; keep it clearly “mid-flight”
  // small nudge based on how many are running vs total (bounded)
  const runningRatio = total > 0 ? r / total : 1;
  const nudge = Math.round(clamp(runningRatio * 10, 0, 10)); // 0..10
  return clamp(70 + nudge, 70, 80);
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

  const q = safeInt(queuedCount);
  const r = safeInt(runningCount);
  const total = q + r;

  const stageLabel = r > 0 ? "Rendering" : q > 0 ? "Queued" : "Working";
  const pct = useMemo(() => computePct(q, r), [q, r]);

  return (
    <div
      ref={ref}
      className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/30"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-extrabold text-blue-900 dark:text-blue-200">{stageLabel}</div>
          <span className="inline-flex items-center rounded-full bg-blue-200/70 px-2 py-0.5 text-[11px] font-extrabold text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">
            {pct}%
          </span>
        </div>

        <div className="text-xs font-semibold text-blue-900/80 dark:text-blue-200/80">
          {r > 0 ? `Running: ${r}` : null}
          {r > 0 && q > 0 ? " · " : null}
          {q > 0 ? `Queued: ${q}` : null}
          {total ? ` · Total: ${total}` : null}
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/40">
        <div
          className="h-2 rounded-full bg-blue-700 dark:bg-blue-200 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
        {/* subtle “activity” sheen without lying about completion */}
        <div className="-mt-2 h-2 w-full animate-pulse bg-white/10 dark:bg-white/5" />
      </div>

      <div className="mt-2 text-xs text-blue-900/80 dark:text-blue-200/80">
        Auto-refreshing while renders are queued/running…
      </div>
    </div>
  );
}