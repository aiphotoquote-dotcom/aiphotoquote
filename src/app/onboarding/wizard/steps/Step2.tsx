// src/app/onboarding/wizard/steps/Step2.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getConfidence, getPreviewText, needsConfirmation, summarizeFetchDebug } from "../utils";

type IndustryInference = {
  mode: "interview";
  status: "collecting" | "suggested";
  round: number;
  confidenceScore: number;
  suggestedIndustryKey: string | null;
  needsConfirmation: boolean;
  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;
  answers: Array<{ qid: string; question: string; answer: string; createdAt: string }>;
  candidates: Array<{ key: string; label: string; score: number }>;
  meta: { updatedAt: string };
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function safeText(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

/**
 * Product-aware “why we ask” lines.
 * Keeps it conversational and ties directly to AIPhotoQuote configuration.
 */
function whyForQid(qid: string) {
  switch (qid) {
    case "services":
      return "This picks your starter quote template + default services.";
    case "materials_objects":
      return "This loads the right photo checklist (what we ask customers to upload).";
    case "job_type":
      return "This tunes how we scope estimates (repair vs replacement vs install).";
    case "who_for":
      return "This tailors intake wording + common job mix.";
    case "top_jobs":
      return "This helps us name your common jobs and default customer questions.";
    case "materials":
      return "This improves terminology and photo-requests (materials drive what we need to see).";
    case "specialty":
      return "This catches niche signals (e.g., collision vs detailing vs restoration).";
    case "location":
      return "Optional—helps your service-area phrasing.";
    case "freeform":
      return "Fastest way to lock the right experience in one shot.";
    case "disambiguate":
      return "This resolves the last remaining ambiguity so we can stop early.";
    default:
      return "This helps us tailor your setup.";
  }
}

/**
 * UI-only “match strength” metric derived from candidate dominance.
 * This is NOT the backend confidenceScore — it’s a UX progress signal.
 */
function matchStrengthFromCandidates(cands: Array<{ score: number }>) {
  const top = Number(cands?.[0]?.score ?? 0);
  const second = Number(cands?.[1]?.score ?? 0);

  if (!Number.isFinite(top) || top <= 0) return 0;

  // Dominance grows as top pulls away from second and as top increases.
  // Smooth curve, capped.
  const sep = Math.max(0, top - second);
  const mag = Math.min(1, top / 10);
  const dom = Math.min(1, sep / 6);

  const v = 0.55 * mag + 0.45 * dom;
  return Math.max(0, Math.min(1, v));
}

export function Step2(props: {
  tenantId: string | null;
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

  // Interview state
  const [ivLoading, setIvLoading] = useState(false);
  const [ivErr, setIvErr] = useState<string | null>(null);

  // For free-text (optional detail)
  const [ivDetail, setIvDetail] = useState("");

  // For option-based answers that require a tap (we’ll submit immediately)
  const [inf, setInf] = useState<IndustryInference | null>(null);

  const tenantId = safeText(props.tenantId);
  const websiteTrim = safeText(props.website);
  const hasWebsite = websiteTrim.length > 0;

  // Website analysis meta
  const conf = getConfidence(props.aiAnalysis);
  const mustConfirm = needsConfirmation(props.aiAnalysis);
  const businessGuess = safeText(props.aiAnalysis?.businessGuess);
  const questions: string[] = Array.isArray(props.aiAnalysis?.questions) ? props.aiAnalysis.questions : [];
  const preview = getPreviewText(props.aiAnalysis);
  const fetchSummary = summarizeFetchDebug(props.aiAnalysis);

  const serverSaysAnalyzing = String(props.aiAnalysisStatus ?? "").toLowerCase() === "running";
  const showAnalyzing = running || serverSaysAnalyzing;

  const canContinueWebsite = Boolean(props.aiAnalysis) && !mustConfirm;

  // Interview derived values
  const ivConfidenceBackend = useMemo(() => {
    const v = Number(inf?.confidenceScore ?? 0);
    return Number.isFinite(v) ? v : 0;
  }, [inf?.confidenceScore]);

  const ivSuggested = safeText(inf?.suggestedIndustryKey);
  const ivStatus = safeText(inf?.status);
  const ivAnsweredCount = inf?.answers?.length ?? 0;
  const ivRound = Number(inf?.round ?? 1) || 1;

  const top = inf?.candidates?.[0] ?? null;
  const second = inf?.candidates?.[1] ?? null;

  const matchStrength = useMemo(() => matchStrengthFromCandidates(inf?.candidates ?? []), [inf?.candidates]);

  // Soft progress bar (feels real even if backend confidence is conservative)
  const IV_SOFT_MAX = 7;
  const ivProgressPct = Math.max(
    10,
    Math.min(
      100,
      Math.round(
        ((Math.min(ivAnsweredCount, IV_SOFT_MAX) +
          (ivStatus === "suggested" ? 1 : 0) +
          Math.min(1, matchStrength)) /
          (IV_SOFT_MAX + 2)) *
          100
      )
    )
  );

  const showInterview = !hasWebsite;
  const canContinueInterview = ivStatus === "suggested" && Boolean(ivSuggested);

  const lastAnswer = inf?.answers?.length ? inf.answers[inf.answers.length - 1] : null;

  function topMatchLine() {
    if (!top) return "Tell us a bit about your business and we’ll pick the best-fit setup.";
    if (canContinueInterview) return `Locked in: ${top.label}. Next you’ll confirm it.`;
    if (second && top.score === second.score) return `We’re split between ${top.label} and ${second.label}. One more question will decide.`;
    return `Leaning toward ${top.label}. One or two more answers should lock it in.`;
  }

  function nextQuestionIntro() {
    if (!inf?.nextQuestion?.qid) return "";
    if (!top) return "Quick check:";
    // Make it feel like it’s learning: “Based on X, next we ask Y”
    return `Based on "${top.label}", next:`;
  }

  async function ivPost(payload: any) {
    setIvErr(null);
    setIvLoading(true);
    try {
      if (!tenantId) throw new Error("NO_TENANT: missing tenantId for interview.");

      const res = await fetch("/api/onboarding/industry-interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId, ...payload }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      const next = (j?.industryInference ?? null) as IndustryInference | null;
      setInf(next);

      // reset the optional detail box each turn (keeps it feeling fresh)
      setIvDetail("");
      return next;
    } catch (e: any) {
      setIvErr(e?.message ?? String(e));
      throw e;
    } finally {
      setIvLoading(false);
    }
  }

  async function submitAnswer(answer: string) {
    const qid = inf?.nextQuestion?.qid;
    if (!qid) return;

    await ivPost({
      action: "answer",
      qid,
      answer,
    });
  }

  // ✅ Only auto-run website scan if a website exists; otherwise start interview
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;

    const hasAnalysis = Boolean(props.aiAnalysis);

    if (hasWebsite) {
      if (hasAnalysis) return;

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
    }

    // no website -> start interview
    ivPost({ action: "start" }).catch((e: any) => props.onError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  // Hydrate interview state from aiAnalysis (server-sourced)
  useEffect(() => {
    if (hasWebsite) return;
    const fromAi = props.aiAnalysis?.industryInference ?? null;
    if (fromAi && typeof fromAi === "object" && fromAi.mode === "interview") {
      setInf(fromAi as IndustryInference);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWebsite, props.aiAnalysis]);

  const qid = inf?.nextQuestion?.qid ?? "";
  const hasOptions = Boolean(inf?.nextQuestion?.options?.length);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        {hasWebsite ? "AI fit check" : "Quick setup interview"}
      </div>

      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        {hasWebsite
          ? "We’ll scan your website to understand what you do, then confirm it with you."
          : "No website needed — we’ll ask a few smart questions to load the right templates, photos, and defaults."}
      </div>

      {/* ✅ Website card only when a website exists */}
      {hasWebsite ? (
        <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="font-medium text-gray-900 dark:text-gray-100">Website</div>
          <div className="mt-1 break-words text-gray-700 dark:text-gray-300">{websiteTrim}</div>
        </div>
      ) : null}

      {/* ---------------- INTERVIEW MODE (NO WEBSITE) ---------------- */}
      {showInterview ? (
        <div className="mt-4 space-y-4">
          {/* Summary */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">We’re setting up your AIPhotoQuote experience</div>
                <div className="mt-1 text-xs opacity-90">
                  We’ll stop early once the top match is clear. You’ll confirm the final industry on the next step.
                </div>

                <div className="mt-2 text-xs font-semibold opacity-95">{topMatchLine()}</div>

                {lastAnswer ? (
                  <div className="mt-2 text-xs opacity-90">
                    Last answer: <span className="font-semibold">{lastAnswer.answer}</span>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs">
                  Match strength: <span className="font-mono">{pct(matchStrength)}%</span>
                </div>
                <div className="text-[11px] opacity-90">Round {ivRound}</div>

                {/* Keep backend confidence visible but deemphasized */}
                <div className="mt-1 text-[11px] opacity-80">
                  backend: <span className="font-mono">{pct(ivConfidenceBackend)}%</span>
                </div>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/60 dark:bg-black/20">
              <div className="h-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${ivProgressPct}%` }} />
            </div>

            {ivErr ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {ivErr}
              </div>
            ) : null}
          </div>

          {/* Next question */}
          <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-500 dark:text-gray-400">{nextQuestionIntro() || "Next"}</div>
                <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                  {inf?.nextQuestion?.question ?? (ivLoading ? "Loading…" : "We have enough information.")}
                </div>

                {qid ? (
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{whyForQid(qid)}</div>
                ) : null}

                {inf?.nextQuestion?.help ? (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{inf.nextQuestion.help}</div>
                ) : null}
              </div>

              <button
                type="button"
                className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
                disabled={ivLoading}
                onClick={() => ivPost({ action: "reset" }).catch(() => null)}
                title="Start interview over"
              >
                Reset
              </button>
            </div>

            {/* Options = tap to answer (no redundant textarea) */}
            {hasOptions ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {inf!.nextQuestion!.options!.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100",
                      "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
                    )}
                    disabled={ivLoading}
                    onClick={() => submitAnswer(opt).catch((e: any) => props.onError(e?.message ?? String(e)))}
                    title="Tap to answer"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              // No options -> single primary input
              <div className="mt-4">
                <textarea
                  value={ivDetail}
                  onChange={(e) => setIvDetail(e.target.value)}
                  rows={3}
                  placeholder="Type your answer…"
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  disabled={ivLoading || !inf?.nextQuestion}
                />

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-2xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                    disabled={ivLoading || !inf?.nextQuestion || ivDetail.trim().length < 1}
                    onClick={() => submitAnswer(ivDetail.trim()).catch((e: any) => props.onError(e?.message ?? String(e)))}
                  >
                    {ivLoading ? "Saving…" : "Submit"}
                  </button>

                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Tip: short answers are fine — we’re looking for high-signal keywords.
                  </div>
                </div>
              </div>
            )}

            {/* Optional detail input even when options exist */}
            {hasOptions ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
                  Add a quick detail (optional)
                </summary>
                <div className="mt-2">
                  <textarea
                    value={ivDetail}
                    onChange={(e) => setIvDetail(e.target.value)}
                    rows={3}
                    placeholder='Example: "Ceramic coating + paint correction + interior detail"'
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                    disabled={ivLoading || !inf?.nextQuestion}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-2xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                      disabled={ivLoading || !inf?.nextQuestion || ivDetail.trim().length < 1}
                      onClick={() => submitAnswer(ivDetail.trim()).catch((e: any) => props.onError(e?.message ?? String(e)))}
                    >
                      {ivLoading ? "Saving…" : "Submit detail"}
                    </button>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Only needed if “Other” or mixed services.</div>
                  </div>
                </div>
              </details>
            ) : null}
          </div>

          {/* Candidate preview */}
          {inf?.candidates?.length ? (
            <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Best matches so far</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">live ranking</div>
              </div>

              <div className="mt-3 grid gap-2">
                {inf.candidates.slice(0, 4).map((c) => (
                  <div
                    key={c.key}
                    className={cn(
                      "rounded-2xl border p-3",
                      c.key === ivSuggested
                        ? "border-indigo-200 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/30"
                        : "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{c.label}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-300 truncate">{c.key}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">score {c.score}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {canContinueInterview ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                  <div className="font-semibold">Ready</div>
                  <div className="mt-1">
                    We’ll preload the <span className="font-semibold">{top?.label ?? ivSuggested}</span> starter pack.
                    Next you’ll confirm the industry.
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  We’ll stop once the top match is clearly ahead (usually 3–4 answers).
                </div>
              )}
            </div>
          ) : null}

          {/* Answer history */}
          {inf?.answers?.length ? (
            <details className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
                Review your answers ({inf.answers.length})
              </summary>
              <div className="mt-3 grid gap-2">
                {inf.answers
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((a, idx) => (
                    <div
                      key={`${a.qid}:${idx}`}
                      className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-black"
                    >
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{a.question}</div>
                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">{a.answer}</div>
                    </div>
                  ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- WEBSITE MODE (HAS WEBSITE) ---------------- */}
      {props.aiAnalysisError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {props.aiAnalysisError}
        </div>
      ) : null}

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
          disabled={ivLoading || running || confirming}
        >
          Back
        </button>

        <div className="grid gap-2">
          <button
            type="button"
            className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
            disabled={hasWebsite ? !canContinueWebsite : !canContinueInterview}
            onClick={props.onNext}
            title={
              hasWebsite
                ? mustConfirm
                  ? "Please confirm/correct the website analysis first."
                  : ""
                : !canContinueInterview
                  ? "Answer a couple more questions to reach a confident match."
                  : ""
            }
          >
            Continue
          </button>

          {/* Escape hatch for support/testing */}
          <button
            type="button"
            className="rounded-2xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            onClick={props.onNext}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}