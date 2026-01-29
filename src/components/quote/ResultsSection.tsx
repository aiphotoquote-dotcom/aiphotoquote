// src/components/quote/ResultsSection.tsx
"use client";

import React from "react";
import { toneBadge } from "./ui";

export function ResultsSection({
  sectionRef,
  headingRef,
  renderPreviewRef,
  hasEstimate,
  result,
  aiRenderingEnabled,
  renderOptIn,
  renderStatus,
  renderImageUrl,
  renderError,
  renderProgressPct,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  renderPreviewRef: React.RefObject<HTMLDivElement | null>;

  hasEstimate: boolean;
  result: any;

  aiRenderingEnabled: boolean;
  renderOptIn: boolean;

  renderStatus: "idle" | "running" | "rendered" | "failed";
  renderImageUrl: string | null;
  renderError: string | null;

  renderProgressPct: number; // 0..100
}) {
  if (!hasEstimate) return null;

  function money(n: any) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  const estLow = money(result?.estimate_low ?? result?.estimateLow);
  const estHigh = money(result?.estimate_high ?? result?.estimateHigh);
  const summary = String(result?.summary ?? "").trim();
  const inspection = Boolean(result?.inspection_required ?? result?.inspectionRequired);
  const confidence = String(result?.confidence ?? "").toLowerCase();

  const scope: string[] = Array.isArray(result?.visible_scope)
    ? result.visible_scope
    : Array.isArray(result?.visibleScope)
      ? result.visibleScope
      : [];

  const assumptions: string[] = Array.isArray(result?.assumptions) ? result.assumptions : [];
  const questions: string[] = Array.isArray(result?.questions) ? result.questions : [];

  const confidenceTone =
    confidence === "high" ? "green" : confidence === "medium" ? "yellow" : confidence === "low" ? "red" : "gray";

  const showRenderBlock = aiRenderingEnabled && renderOptIn;

  const rp = Number.isFinite(renderProgressPct) ? Math.max(0, Math.min(100, renderProgressPct)) : 0;

  const renderTitle =
    renderStatus === "rendered"
      ? "Rendering ready"
      : renderStatus === "failed"
        ? "Rendering failed"
        : renderStatus === "running"
          ? "Rendering…"
          : "Rendering queued";

  const renderRight =
    renderStatus === "rendered" ? "Done" : renderStatus === "failed" ? "Error" : renderStatus === "running" ? "Working" : "Waiting";

  const renderSubtitle =
    renderStatus === "failed"
      ? "We couldn’t generate the preview this time."
      : renderStatus === "rendered"
        ? "Preview generated."
        : "We’re generating a visual preview based on the uploaded photos and notes.";

  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            ref={headingRef as any}
            tabIndex={-1}
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 outline-none"
          >
            Your estimate
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Fast range based on your photos + notes. Final pricing may change after inspection.
          </p>
        </div>
      </div>

      {/* Primary card */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center gap-2">
          {toneBadge(confidence ? `Confidence: ${confidence}` : "Confidence: unknown", confidenceTone as any)}
          {inspection ? toneBadge("Inspection recommended", "yellow") : toneBadge("No inspection required", "green")}
          {showRenderBlock ? toneBadge("Rendering requested", "blue") : null}
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-semibold tracking-wide text-gray-600 dark:text-gray-300">ESTIMATE RANGE</div>
          <div className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-100">
            {estLow && estHigh ? `$${estLow} – $${estHigh}` : "We need a bit more info"}
          </div>

          <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            {summary ? summary : "We’ll follow up if we need any clarifications."}
          </div>
        </div>
      </div>

      {/* Secondary details */}
      {scope.length || assumptions.length || questions.length ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Visible scope</div>
            <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-200">
              {scope.length ? (
                <ul className="list-disc pl-5 space-y-1">
                  {scope.slice(0, 10).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500 dark:text-gray-400 italic">Not enough detail yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assumptions</div>
            <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-200">
              {assumptions.length ? (
                <ul className="list-disc pl-5 space-y-1">
                  {assumptions.slice(0, 10).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500 dark:text-gray-400 italic">None.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Questions</div>
            <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-200">
              {questions.length ? (
                <ul className="list-disc pl-5 space-y-1">
                  {questions.slice(0, 10).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500 dark:text-gray-400 italic">No follow-ups needed.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Rendering status card (StatusBar-style) */}
      {showRenderBlock ? (
        <div ref={renderPreviewRef as any} className="max-w-full overflow-hidden">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-600 dark:text-gray-300">AI rendering preview</div>
                <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">{renderTitle}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">{renderSubtitle}</div>
              </div>

              <div className="min-w-0 max-w-[45%] text-right">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{renderRight}</div>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="h-full bg-emerald-600" style={{ width: `${rp}%` }} />
            </div>

            {renderError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {renderError}
              </div>
            ) : null}

            {renderImageUrl ? (
              <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={renderImageUrl} alt="AI rendering" className="w-full object-cover" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Debug */}
      <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">
          Advanced: raw result (debug)
        </summary>
        <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}