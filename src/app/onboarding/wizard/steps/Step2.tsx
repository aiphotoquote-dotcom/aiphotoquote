"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  getConfidence,
  getPreviewText,
  needsConfirmation,
  summarizeFetchDebug,
} from "../utils";

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
  const autoRanRef = useRef(false);

  const websiteTrim = String(props.website ?? "").trim();
  const hasWebsite = websiteTrim.length > 0;

  const conf = getConfidence(props.aiAnalysis);
  const mustConfirm = needsConfirmation(props.aiAnalysis);

  const businessGuess = String(props.aiAnalysis?.businessGuess ?? "").trim();
  const questions: string[] = Array.isArray(props.aiAnalysis?.questions) ? props.aiAnalysis.questions : [];

  const preview = getPreviewText(props.aiAnalysis);
  const fetchSummary = summarizeFetchDebug(props.aiAnalysis);

  const serverSaysAnalyzing = String(props.aiAnalysisStatus ?? "").toLowerCase() === "running";
  const showAnalyzing = running || serverSaysAnalyzing;

  // ✅ Only auto-run if a website exists
  useEffect(() => {
    if (autoRanRef.current) return;

    const hasAnalysis = Boolean(props.aiAnalysis);

    autoRanRef.current = true;
    if (!hasWebsite || hasAnalysis) return;

    let alive = true;
    setRunning(true);
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
  }, [props]);

  const canContinueNormally = Boolean(props.aiAnalysis) && !mustConfirm;

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">AI fit check</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll scan your website to understand what you do, then confirm it with you.
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="font-medium text-gray-900 dark:text-gray-100">Website</div>
        <div className="mt-1 break-words text-gray-700 dark:text-gray-300">
          {websiteTrim || "(none provided)"}
        </div>
      </div>

      {/* ✅ No-website path */}
      {!hasWebsite ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">No website — no problem</div>
          <div className="mt-1">
            We’ll skip the website scan and you can select your industry next. We’ll still preload a good starter experience
            from your industry selection.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
              onClick={props.onNext}
            >
              Skip website scan →
            </button>

            <button
              type="button"
              className="rounded-xl border border-amber-300/50 bg-transparent px-4 py-2 text-xs font-semibold text-amber-900 dark:text-amber-100"
              onClick={props.onBack}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {props.aiAnalysisError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {props.aiAnalysisError}
        </div>
      ) : null}

      {/* Website analysis only makes sense if website exists */}
      {hasWebsite ? (
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={showAnalyzing}
            onClick={async () => {
              setRunning(true);
              try {
                await props.onRun();
              } catch (e: any) {
                props.onError(e?.message ?? String(e));
              } finally {
                setRunning(false);
              }
            }}
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
                    If not correct, tell us what you do (boats/cars/etc. + services). We’ll re-evaluate.
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
                    Nice — confidence looks good. You can continue to industry selection.
                  </div>
                )}
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold opacity-90">Debug preview (text sample)</summary>

                {fetchSummary ? (
                  <div className="mt-2 rounded-xl border border-emerald-300/40 bg-white/60 p-3 text-[11px] leading-snug dark:bg-black/20">
                    <div className="font-semibold">Extractor summary</div>
                    <div className="mt-1">
                      Aggregate chars: <span className="font-mono">{fetchSummary.aggregateChars}</span>
                      {" • "}
                      Pages used: <span className="font-mono">{fetchSummary.pagesUsed.length}</span>
                      {" • "}
                      Base attempts: <span className="font-mono">{fetchSummary.attemptedCount}</span>
                    </div>
                    {fetchSummary.pagesUsed.length ? (
                      <div className="mt-1 break-words">
                        Used:
                        <ul className="mt-1 list-disc pl-5">
                          {fetchSummary.pagesUsed.slice(0, 4).map((u, i) => (
                            <li key={i} className="break-all">
                              {u}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {fetchSummary.hint ? <div className="mt-2 italic opacity-90">{fetchSummary.hint}</div> : null}
                  </div>
                ) : null}

                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
                  {preview || "(no preview — extractor did not capture readable text)"}
                </pre>
              </details>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              No analysis yet. Click the button to generate a starter result.
            </div>
          )}
        </div>
      ) : null}

      {/* Bottom nav */}
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
            disabled={hasWebsite ? !canContinueNormally : false}
            onClick={props.onNext}
            title={hasWebsite && mustConfirm ? "Please confirm/correct the website analysis first." : ""}
          >
            Continue
          </button>

          {hasWebsite ? (
            <button
              type="button"
              className="rounded-2xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              disabled={!props.aiAnalysis}
              onClick={props.onNext}
            >
              Continue anyway
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}