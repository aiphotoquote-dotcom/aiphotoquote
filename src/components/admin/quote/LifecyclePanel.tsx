// src/components/admin/quote/LifecyclePanel.tsx
import React from "react";

import QuoteNotesComposer from "@/components/admin/QuoteNotesComposer";
import { chip, renderStatusTone } from "@/components/admin/quote/ui";
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

export default function LifecyclePanel(props: {
  quoteId: string;
  versionRows: QuoteVersionRow[];
  noteRows: QuoteNoteRow[];
  renderRows: QuoteRenderRow[];
  lifecycleReadError: string | null;

  activeVersion: number | null;

  createNewVersionAction: any;
  restoreVersionAction: any;
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
  } = props;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Quote lifecycle</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Versions, internal notes, and render attempts.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {versionRows.length
            ? chip(`${versionRows.length} version${versionRows.length === 1 ? "" : "s"}`, "blue")
            : chip("No versions yet", "gray")}
          {noteRows.length ? chip(`${noteRows.length} note${noteRows.length === 1 ? "" : "s"}`, "gray") : null}
          {renderRows.length ? chip(`${renderRows.length} render${renderRows.length === 1 ? "" : "s"}`, "gray") : null}
        </div>
      </div>

      {/* Create version */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-200">
            Create new version
          </summary>

          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Choose engine + mode. Optional notes are stored in quote_notes and linked to the new version.
          </div>

          <form action={createNewVersionAction} className="mt-4 grid gap-3">
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Engine</div>
                <div className="mt-2 space-y-2 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="engine"
                      value="deterministic_pricing_only"
                      defaultChecked
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-semibold">Deterministic pricing only</span>
                      <span className="block text-xs text-gray-600 dark:text-gray-400">
                        Runs deterministic pricing engine and freezes a new version (no OpenAI call).
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2">
                    <input type="radio" name="engine" value="full_ai_reassessment" className="mt-0.5" />
                    <span>
                      <span className="font-semibold">Full AI reassessment</span>
                      <span className="block text-xs text-gray-600 dark:text-gray-400">
                        Runs OpenAI assessment + deterministic pricing, then freezes a new version.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI mode</div>
                <select
                  name="ai_mode"
                  defaultValue="assessment_only"
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                >
                  <option value="assessment_only">assessment_only</option>
                  <option value="range">range</option>
                  <option value="fixed">fixed</option>
                </select>

                <div className="mt-3 text-xs font-semibold text-gray-700 dark:text-gray-300">Reason (optional)</div>
                <input
                  name="reason"
                  placeholder="e.g. customer clarified scope, new photos, reprice..."
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                New notes for this version (optional)
              </div>
              <textarea
                name="note_body"
                rows={4}
                placeholder="Add anything the shop learned. This will be saved to quote_notes linked to the new version."
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Create version
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-300">
                Creates quote_versions row (+ quote_notes if provided).
              </span>
            </div>
          </form>
        </details>
      </div>

      {lifecycleReadError ? (
        <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="font-semibold">Lifecycle tables not available yet</div>
          <div className="mt-1 font-mono text-xs break-words">{lifecycleReadError}</div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {/* Versions */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Versions</div>
            {versionRows.length ? chip("History", "blue") : chip("Empty", "gray")}
          </div>

          <div className="mt-3 space-y-3">
            {versionRows.length ? (
              versionRows.slice(0, 30).map((v) => {
                const out = tryJson(v.output) ?? v.output;
                const est = extractEstimate(out);
                const conf = safeTrim(pickAiAssessmentFromAny(out)?.confidence ?? "");
                const summ = safeTrim(pickAiAssessmentFromAny(out)?.summary ?? "");
                const policyMode = safeTrim(v.aiMode) || null;

                const isActive = activeVersion != null && Number(v.version) === activeVersion;

                const estText =
                  est.low != null && est.high != null
                    ? `${formatUSD(est.low)} – ${formatUSD(est.high)}`
                    : est.low != null
                      ? formatUSD(est.low)
                      : est.high != null
                        ? formatUSD(est.high)
                        : null;

                return (
                  <div
                    key={v.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {chip(`v${Number(v.version ?? 0)}`, "blue")}
                        {isActive ? chip("ACTIVE", "green") : null}
                        {policyMode ? chip(`mode: ${policyMode}`, "gray") : null}
                        {safeTrim(v.source) ? chip(String(v.source), "gray") : null}
                        {safeTrim(v.createdBy) ? chip(String(v.createdBy), "gray") : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(v.createdAt)}</div>

                        {!isActive ? (
                          <form action={restoreVersionAction}>
                            <input type="hidden" name="version_id" value={v.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                            >
                              Restore
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>

                    {v.reason ? (
                      <div className="mt-2 text-xs text-gray-700 dark:text-gray-200">
                        <span className="font-semibold">Reason:</span> {String(v.reason)}
                      </div>
                    ) : null}

                    <div className="mt-2 space-y-1">
                      {estText ? miniKeyValue("Estimate", estText) : miniKeyValue("Estimate", "—")}
                      {conf ? miniKeyValue("Confidence", conf) : null}
                    </div>

                    {summ ? (
                      <div className="mt-2 text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {summ}
                      </div>
                    ) : null}

                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Raw version output (debug)
                      </summary>
                      <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
{JSON.stringify(out ?? {}, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300 italic">
                No versions yet. Once you seed v1 from the initial quote, you’ll see it here.
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Internal notes</div>
            {noteRows.length ? chip("Log", "gray") : chip("Empty", "gray")}
          </div>

          <div className="mt-3">
            <QuoteNotesComposer quoteLogId={quoteId} />
          </div>

          <div className="mt-3 space-y-3">
            {noteRows.length ? (
              noteRows.slice(0, 100).map((n) => (
                <div
                  key={n.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {safeTrim((n as any).createdBy) ? chip(String((n as any).createdBy), "gray") : chip("tenant", "gray")}
                      {n.quoteVersionId ? chip("linked to version", "blue") : chip("general", "gray")}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(n.createdAt)}</div>
                  </div>
                  <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {safeTrim(n.body) || <span className="italic text-gray-500">Empty note.</span>}
                  </div>
                  {n.quoteVersionId ? (
                    <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300 font-mono break-all">
                      versionId: {n.quoteVersionId}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300 italic">No notes yet.</div>
            )}
          </div>
        </div>

        {/* Renders */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Render attempts</div>
            {renderRows.length ? chip("History", "gray") : chip("Empty", "gray")}
          </div>

          <div className="mt-3 space-y-3">
            {renderRows.length ? (
              renderRows.slice(0, 60).map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {chip(`Attempt ${Number(r.attempt ?? 1)}`, "gray")}
                      {chip(String(r.status ?? "unknown"), renderStatusTone(String(r.status ?? "")))}
                      {r.quoteVersionId ? chip("from version", "blue") : null}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(r.createdAt)}</div>
                  </div>

                  {r.imageUrl ? (
                    <a href={r.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.imageUrl}
                        alt="Render attempt"
                        className="w-full rounded-xl border border-gray-200 bg-white object-contain dark:border-gray-800"
                      />
                      <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        Click to open original
                      </div>
                    </a>
                  ) : (
                    <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 italic">
                      No image_url for this attempt.
                    </div>
                  )}

                  {r.error ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                      {r.error}
                    </div>
                  ) : null}

                  {r.shopNotes ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Shop notes
                      </summary>
                      <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {String(r.shopNotes)}
                      </div>
                    </details>
                  ) : null}

                  {r.prompt ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Render prompt (debug)
                      </summary>
                      <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
{String(r.prompt)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300 italic">No render attempts yet.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}