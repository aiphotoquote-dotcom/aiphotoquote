// src/components/admin/quote/LifecyclePanel.tsx
import React from "react";

import QuoteNotesComposer from "@/components/admin/QuoteNotesComposer";
import RenderGallery from "@/components/admin/quote/RenderGallery";
import { chip } from "@/components/admin/quote/ui";
import { extractEstimate, pickAiAssessmentFromAny } from "@/lib/admin/quotes/normalize";
import { formatUSD, humanWhen, safeTrim, tryJson } from "@/lib/admin/quotes/utils";

import type { QuoteNoteRow, QuoteRenderRow, QuoteVersionRow } from "@/lib/admin/quotes/getLifecycle";

function miniKeyValue(label: string, value: any) {
  return (
    <div className="text-xs text-gray-700 dark:text-gray-300">
      <span className="font-semibold text-gray-900 dark:text-gray-100">{label}:</span>{" "}
      <span className="font-mono">{safeTrim(value) || "—"}</span>
    </div>
  );
}

function clamp(s: string, max = 180) {
  const t = safeTrim(s);
  if (!t) return "";
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function noteActor(n: QuoteNoteRow) {
  const anyN: any = n as any;
  return safeTrim(anyN.actor) || safeTrim(anyN.createdBy) || safeTrim(anyN.created_by) || "";
}

export default function LifecyclePanel(props: {
  quoteId: string;
  versionRows: QuoteVersionRow[];
  noteRows: QuoteNoteRow[];
  renderRows: QuoteRenderRow[];
  lifecycleReadError: string | null;

  activeVersion: number | null;

  createNewVersionAction: any;
  restoreVersionAction: any;
  requestRenderAction: any;
}) {
  const {
    quoteId,
    versionRows,
    noteRows,
    renderRows,
    lifecycleReadError,
    activeVersion,
    createNewVersionAction,
    restoreVersionAction,
    requestRenderAction,
  } = props;

  const versionsCount = versionRows?.length ?? 0;
  const notesCount = noteRows?.length ?? 0;
  const rendersCount = renderRows?.length ?? 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Quote lifecycle</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Versions (frozen outputs), internal notes, and render attempts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {chip(`${versionsCount} version${versionsCount === 1 ? "" : "s"}`, versionsCount ? "blue" : "gray")}
          {chip(`${notesCount} note${notesCount === 1 ? "" : "s"}`, "gray")}
          {chip(`${rendersCount} render${rendersCount === 1 ? "" : "s"}`, "gray")}
        </div>
      </div>

      {/* Create version (collapsible so it doesn't dominate) */}
      <details className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
        <summary className="cursor-pointer select-none">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Create a new version</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Freeze a new output in <span className="font-mono">quote_versions</span> (optional note can link to it).
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 sm:mt-0">
              Quote: <span className="font-mono">{quoteId}</span>
            </div>
          </div>
        </summary>

        <form action={createNewVersionAction} className="mt-4 grid gap-3">
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Engine */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Engine</div>
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" name="engine" value="deterministic_pricing_only" defaultChecked className="mt-0.5" />
                  <span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Deterministic pricing only</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400">
                      No OpenAI call. Recomputes pricing + freezes output as a new version.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2">
                  <input type="radio" name="engine" value="full_ai_reassessment" className="mt-0.5" />
                  <span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Full AI reassessment</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400">
                      Runs OpenAI assessment + deterministic pricing, then freezes a new version.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Mode + reason */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI mode snapshot</div>
              <select
                name="ai_mode"
                defaultValue="assessment_only"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                <option value="assessment_only">assessment_only</option>
                <option value="range">range</option>
                <option value="fixed">fixed</option>
              </select>

              <div className="mt-4 text-xs font-semibold text-gray-700 dark:text-gray-300">Reason (optional)</div>
              <input
                name="reason"
                placeholder="e.g. customer clarified scope, new photos, reprice..."
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
          </div>

          {/* Optional note */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Optional note (linked to new version)</div>
            <textarea
              name="note_body"
              rows={4}
              placeholder="Add anything the shop learned (materials, measurements, replace foam vs reuse, stitching pattern, etc.)."
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Create version
            </button>

            <div className="text-xs text-gray-600 dark:text-gray-300">
              Tip: deterministic for “pricing refresh”, full AI when scope changed.
            </div>
          </div>
        </form>
      </details>

      {lifecycleReadError ? (
        <div className="mt-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="font-semibold">Lifecycle tables not available yet</div>
          <div className="mt-1 font-mono text-xs break-words">{lifecycleReadError}</div>
        </div>
      ) : null}

      {/* STACKED SECTIONS */}
      <div className="mt-6 space-y-4">
        {/* Versions */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Versions</div>
            {versionsCount ? chip("History", "blue") : chip("Empty", "gray")}
          </div>

          <div className="mt-3 space-y-3">
            {versionsCount ? (
              versionRows.slice(0, 30).map((v) => {
                const out = tryJson(v.output) ?? v.output;
                const assessment = pickAiAssessmentFromAny(out);
                const est = extractEstimate(out);

                const conf = safeTrim(assessment?.confidence ?? "");
                const summ = safeTrim(assessment?.summary ?? "");
                const policyMode = safeTrim(v.aiMode) || null;

                const isActive = activeVersion != null && Number(v.version) === activeVersion;

                const estText =
                  est.low != null && est.high != null
                    ? `${formatUSD(est.low)} – ${formatUSD(est.high)}`
                    : est.low != null
                      ? formatUSD(est.low)
                      : est.high != null
                        ? formatUSD(est.high)
                        : "—";

                return (
                  <div
                    key={v.id}
                    className={
                      "rounded-2xl border bg-white p-4 dark:bg-gray-950 " +
                      (isActive
                        ? "border-green-300 ring-1 ring-green-200 dark:border-green-900/60 dark:ring-green-900/30"
                        : "border-gray-200 dark:border-gray-800")
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {chip(`v${Number(v.version ?? 0)}`, "blue")}
                        {isActive ? chip("ACTIVE", "green") : null}
                        {policyMode ? chip(`mode: ${policyMode}`, "gray") : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(v.createdAt)}</div>

                        {!isActive ? (
                          <form action={restoreVersionAction}>
                            <input type="hidden" name="version_id" value={v.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                              title="Restore this version as the active output"
                            >
                              Restore
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1">
                      {miniKeyValue("Estimate", estText)}
                      {miniKeyValue("Confidence", conf || "—")}
                    </div>

                    {summ ? (
                      <div className="mt-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {clamp(summ, 220)}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 italic">No summary on this version.</div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-gray-600 dark:text-gray-300">Actions</div>
                      <form action={requestRenderAction} className="flex items-center gap-2">
                        <input type="hidden" name="version_number" value={String(Number(v.version ?? 0))} />
                        <button
                          type="submit"
                          className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                          title="Queue a render attempt for this version"
                        >
                          Request render
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                No versions yet. Create v1 first so renders can attach to a version.
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Internal notes</div>
            {notesCount ? chip("Log", "gray") : chip("Empty", "gray")}
          </div>

          <div className="mt-3">
            <QuoteNotesComposer quoteLogId={quoteId} />
          </div>

          <div className="mt-4 space-y-3">
            {notesCount ? (
              noteRows.slice(0, 100).map((n) => {
                const actor = noteActor(n);
                return (
                  <div key={n.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {actor ? chip(String(actor), "gray") : chip("tenant", "gray")}
                        {n.quoteVersionId ? chip("linked", "blue") : chip("general", "gray")}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(n.createdAt)}</div>
                    </div>

                    <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                      {safeTrim(n.body) || <span className="italic text-gray-500">Empty note.</span>}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                No notes yet.
              </div>
            )}
          </div>
        </div>

        {/* Renders */}
        <RenderGallery quoteId={quoteId} renderRows={renderRows as any} />
      </div>
    </section>
  );
}