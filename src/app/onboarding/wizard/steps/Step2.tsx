"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getConfidence, getPreviewText, needsConfirmation, summarizeFetchDebug } from "../utils";

type PhaseKey =
  | "reachability"
  | "discover"
  | "extract"
  | "classify"
  | "questions"
  | "finalize";

const PHASES: Array<{ key: PhaseKey; title: string; detail: string }> = [
  { key: "reachability", title: "Checking website", detail: "Making sure the site is reachable and public." },
  { key: "discover", title: "Finding service pages", detail: "Looking for your core services and offerings." },
  { key: "extract", title: "Extracting signals", detail: "Pulling key phrases and job types relevant to quoting." },
  { key: "classify", title: "Selecting best-fit template", detail: "Choosing an industry starting point and fit score." },
  { key: "questions", title: "Drafting intake questions", detail: "Generating a few starter questions for customers." },
  { key: "finalize", title: "Finalizing summary", detail: "Packaging the result for you to confirm." },
];

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function phaseToIndex(p: unknown): number | null {
  const s = String(p ?? "").trim();
  const idx = PHASES.findIndex((x) => x.key === s);
  return idx >= 0 ? idx : null;
}

function toIntOrNull(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function Step2(props: {
  website: string;
  aiAnalysis: any | null | undefined;
  aiAnalysisStatus?: string;
  aiAnalysisError?: string | null;
  onRun: () => Promise<void>;
  onConfirm: (args: { answer: "yes" | "no"; feedback?: string }) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  onError: (msg: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const autoRanRef = useRef(false);

  const conf = getConfidence(props.aiAnalysis);
  const mustConfirm = needsConfirmation(props.aiAnalysis);

  const businessGuess = String(props.aiAnalysis?.businessGuess ?? "").trim();
  const questions: string[] = Array.isArray(props.aiAnalysis?.questions) ? props.aiAnalysis.questions : [];

  const preview = getPreviewText(props.aiAnalysis);
  const fetchSummary = summarizeFetchDebug(props.aiAnalysis);

  const serverSaysAnalyzing = String(props.aiAnalysisStatus ?? "").toLowerCase() === "running";
  const showAnalyzing = running || serverSaysAnalyzing;

  const serverPhaseIdx = useMemo(() => {
    const p = props.aiAnalysis?.meta?.phase;
    return phaseToIndex(p);
  }, [props.aiAnalysis]);

  const serverLastAction = useMemo(() => {
    const s = String(props.aiAnalysis?.meta?.lastAction ?? "").trim();
    return s || null;
  }, [props.aiAnalysis]);

  // If server provides phase, lock UI to it
  useEffect(() => {
    if (serverPhaseIdx === null || serverPhaseIdx === undefined) return;
    setPhaseIdx(serverPhaseIdx);
  }, [serverPhaseIdx]);

  const elapsedMs = useMemo(() => {
    if (!startedAt) return 0;
    return Date.now() - startedAt;
  }, [startedAt, running, serverSaysAnalyzing]);

  const takingLong = showAnalyzing && elapsedMs > 15_000;

  const progressPct = useMemo(() => {
    if (props.aiAnalysis && String(props.aiAnalysis?.meta?.status ?? "").toLowerCase() === "complete") return 100;
    const total = PHASES.length;
    return Math.round(((phaseIdx + 1) / total) * 100);
  }, [phaseIdx, props.aiAnalysis]);

  const activePhase = useMemo(() => PHASES[clamp(phaseIdx, 0, PHASES.length - 1)], [phaseIdx]);

  function resetProgress() {
    // if server already told us phase, don’t reset the UI backwards
    const sp = phaseToIndex(props.aiAnalysis?.meta?.phase);
    setPhaseIdx(sp ?? 0);
    setStartedAt(Date.now());
  }

  async function runAnalysis() {
    setRunning(true);
    resetProgress();
    try {
      await props.onRun();
    } catch (e: any) {
      props.onError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  // Auto-run once if website exists and no analysis yet
  useEffect(() => {
    if (autoRanRef.current) return;

    const hasWebsite = String(props.website ?? "").trim().length > 0;
    const hasAnalysis = Boolean(props.aiAnalysis);

    autoRanRef.current = true;
    if (!hasWebsite || hasAnalysis) return;

    let alive = true;
    setRunning(true);
    resetProgress();

    props
      .onRun()
      .catch((e: any) => props.onError(e?.message ?? String(e)))
      .finally(() => {
        if (alive) setRunning(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.website, props.aiAnalysis]);

  // Fallback “optimistic progress” only if server phase is missing
  useEffect(() => {
    if (!showAnalyzing) return;
    if (props.aiAnalysis) return;
    if (serverPhaseIdx !== null && serverPhaseIdx !== undefined) return;

    const interval = window.setInterval(() => {
      setPhaseIdx((idx) => {
        const maxBeforeFinalize = PHASES.length - 2;
        if (idx >= maxBeforeFinalize) return idx;
        return idx + 1;
      });
    }, 1200);

    return () => window.clearInterval(interval);
  }, [showAnalyzing, props.aiAnalysis, serverPhaseIdx]);

  useEffect(() => {
    if (showAnalyzing && !startedAt) setStartedAt(Date.now());
  }, [showAnalyzing, startedAt]);

  const hasWebsite = String(props.website ?? "").trim().length > 0;

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">AI fit check</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll scan your website to understand what you do, then confirm it with you.
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="font-medium text-gray-900 dark:text-gray-100">Website</div>
        <div className="mt-1 break-words text-gray-700 dark:text-gray-300">{props.website || "(none provided)"}</div>
      </div>

      {props.aiAnalysisError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {props.aiAnalysisError}
        </div>
      ) : null}

      {/* Progress / phases */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Website analysis</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Public pages only • No logins • No changes</div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            {props.aiAnalysis?.meta?.status === "complete" ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">Complete</span>
            ) : showAnalyzing ? (
              <span className="font-semibold">Running…</span>
            ) : (
              <span>Idle</span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-2 rounded-full bg-emerald-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            {props.aiAnalysis?.meta?.status === "complete" ? (
              <>Done.</>
            ) : showAnalyzing ? (
              <>
                <span className="font-semibold">
                  {serverLastAction ? "Now:" : `${activePhase.title}:`}
                </span>{" "}
                {serverLastAction ? serverLastAction : activePhase.detail}
              </>
            ) : hasWebsite ? (
              <>Click “Run website analysis” to generate a starter result.</>
            ) : (
              <>Enter a website above to continue.</>
            )}
          </div>

          <div className="mt-4 grid gap-2">
            {PHASES.map((p, i) => {
              const done =
                props.aiAnalysis?.meta?.status === "complete" ? true : showAnalyzing ? i < phaseIdx : false;
              const active =
                props.aiAnalysis?.meta?.status === "complete" ? i === PHASES.length - 1 : showAnalyzing ? i === phaseIdx : false;

              return (
                <div
                  key={p.key}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2 text-sm",
                    "border-gray-200 dark:border-gray-800",
                    active ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-gray-50 dark:bg-black"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                      done
                        ? "border-emerald-300 bg-emerald-600 text-white dark:border-emerald-900/40"
                        : active
                        ? "border-emerald-300 bg-white text-emerald-700 dark:bg-black dark:text-emerald-200"
                        : "border-gray-300 bg-white text-gray-500 dark:border-gray-800 dark:bg-black dark:text-gray-400"
                    )}
                    aria-hidden="true"
                  >
                    {done ? "✓" : i + 1}
                  </div>

                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        done ? "text-emerald-900 dark:text-emerald-100" : active ? "text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"
                      )}
                    >
                      {p.title}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">{p.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {takingLong ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              Still working… some sites take longer (heavy pages, redirects, or bot protection). You can wait, retry, or continue anyway.
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={showAnalyzing || !hasWebsite}
          onClick={runAnalysis}
        >
          {showAnalyzing ? "Analyzing…" : props.aiAnalysis ? "Re-run website analysis" : "Run website analysis"}
        </button>

        {props.aiAnalysis ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">What we think you do</div>
              <div className="text-xs">
                Confidence: <span className="font-mono">{Math.round(conf * 100)}%</span>
              </div>
            </div>

            <div className="mt-2 text-sm">{businessGuess || "Analysis returned no summary."}</div>

            {questions.length ? (
              <div className="mt-3 text-xs opacity-90">
                <div className="font-semibold">Quick check</div>
                <ul className="mt-1 list-disc pl-5">
                  {questions.slice(0, 4).map((q, i) => (
                    <li key={i}>{String(q)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-emerald-300/40 bg-white/60 p-3 dark:bg-black/20">
              <div className="text-xs font-semibold">Does this sound correct?</div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  disabled={confirming}
                  onClick={async () => {
                    setConfirming(true);
                    try {
                      await props.onConfirm({ answer: "yes" });
                      setFeedback("");
                    } catch (e: any) {
                      props.onError(e?.message ?? String(e));
                    } finally {
                      setConfirming(false);
                    }
                  }}
                >
                  {confirming ? "Saving…" : "Yes, that’s right"}
                </button>

                <button
                  type="button"
                  className="rounded-xl border border-emerald-300/50 bg-transparent px-4 py-2 text-xs font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
                  disabled={confirming}
                  onClick={async () => {
                    setConfirming(true);
                    try {
                      await props.onConfirm({ answer: "no", feedback: feedback.trim() || undefined });
                    } catch (e: any) {
                      props.onError(e?.message ?? String(e));
                    } finally {
                      setConfirming(false);
                    }
                  }}
                >
                  {confirming ? "Saving…" : "Not quite"}
                </button>
              </div>

              <div className="mt-2">
                <div className="text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  If not correct, tell us what you do (cars/boats/etc. + services). We’ll re-evaluate.
                </div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  placeholder="Example: We do custom automotive upholstery (seats + door panels), headliners, and marine vinyl repairs. We do not do painting."
                  className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-emerald-900/40 dark:bg-gray-950 dark:text-gray-100"
                />
              </div>

              {mustConfirm ? (
                <div className="mt-2 text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  We’ll ask for confirmation until confidence is high enough to categorize your business automatically.
                </div>
              ) : (
                <div className="mt-2 text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  Nice — confidence looks good. You can continue.
                </div>
              )}
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold opacity-90">Debug preview (text sample)</summary>

              {fetchSummary ? (
                <div className="mt-2 rounded-xl border border-emerald-300/40 bg-white/60 p-3 text-[11px] leading-snug dark:bg-black/20">
                  <div className="font-semibold">Extractor summary</div>
                  <div className="mt-1">
                    Aggregate chars: <span className="font-mono">{fetchSummary.aggregateChars}</span>{" • "}
                    Pages used: <span className="font-mono">{fetchSummary.pagesUsed.length}</span>{" • "}
                    Base attempts: <span className="font-mono">{fetchSummary.attemptedCount}</span>
                  </div>
                </div>
              ) : null}

              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
                {preview || "(no preview — extractor did not capture readable text)"}
              </pre>
            </details>
          </div>
        ) : showAnalyzing ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            Analyzing… we’ll show your result here when it’s ready.
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            No analysis yet. Click the button to generate a starter result.
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={props.onBack}
        >
          Back
        </button>

        <div className="grid gap-2">
          <button
            type="button"
            className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
            disabled={!props.aiAnalysis || mustConfirm}
            onClick={props.onNext}
            title={mustConfirm ? "Please confirm/correct the website analysis first." : ""}
          >
            Continue
          </button>

          <button
            type="button"
            className="rounded-2xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            disabled={!props.aiAnalysis}
            onClick={props.onNext}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}