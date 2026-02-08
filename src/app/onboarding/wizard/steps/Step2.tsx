"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getConfidence, getPreviewText, needsConfirmation, summarizeFetchDebug } from "../utils";

type Candidate = { key: string; label: string; score: number };

type Conflict =
  | { type: "close_call"; between: [string, string]; scores: [number, number]; reason: string }
  | { type: "top_flipped"; from: string; to: string; reason: string }
  | { type: "confidence_plateau"; prev: number; next: number; reason: string };

type IndustryInference = {
  mode: "interview";
  status: "collecting" | "suggested";
  round: number;
  confidenceScore: number;
  suggestedIndustryKey: string | null;
  needsConfirmation: boolean;
  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;
  answers: Array<{ qid: string; question: string; answer: string; createdAt: string }>;
  candidates: Candidate[];
  conflicts?: Conflict[];
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
      return "This tailors your intake language + typical job mix.";
    case "top_jobs":
      return "This helps us name your common jobs and question prompts.";
    case "materials":
      return "This improves fit accuracy and helps us choose the right terminology.";
    case "specialty":
      return "This catches niche signals (e.g., collision vs detailing vs restoration).";
    case "location":
      return "This is optional—helps with your service area phrasing.";
    case "clarify_detail_vs_repair":
    case "clarify_detail_vs_cleaning":
    case "clarify_repair_vs_collision":
    case "clarify_top_two":
    case "clarify_freeform":
      return "We saw conflicting signals — this quick clarifier prevents the wrong starter pack.";
    case "freeform":
      return "This is the fastest way to confirm the right experience.";
    default:
      return "This helps us tailor your setup.";
  }
}

function conflictHeadline(conflicts: Conflict[]) {
  if (!conflicts?.length) return "";
  // prioritize strongest perceived “intelligence”
  const topFlipped = conflicts.find((c) => c.type === "top_flipped");
  if (topFlipped) return "Conflicting signals detected";
  const close = conflicts.find((c) => c.type === "close_call");
  if (close) return "We’re down to two close matches";
  const plateau = conflicts.find((c) => c.type === "confidence_plateau");
  if (plateau) return "We need one clarifying answer";
  return "We need one clarifying answer";
}

function conflictBody(conflicts: Conflict[], candidates: Candidate[]) {
  if (!conflicts?.length) return "";

  const parts: string[] = [];

  for (const c of conflicts) {
    if (c.type === "top_flipped") {
      const from = candidates.find((x) => x.key === c.from)?.label ?? c.from;
      const to = candidates.find((x) => x.key === c.to)?.label ?? c.to;
      parts.push(`Your last answer shifted the best match from “${from}” to “${to}”.`);
      continue;
    }
    if (c.type === "close_call") {
      const a = candidates.find((x) => x.key === c.between[0])?.label ?? c.between[0];
      const b = candidates.find((x) => x.key === c.between[1])?.label ?? c.between[1];
      parts.push(`We’re very close between “${a}” and “${b}”.`);
      continue;
    }
    if (c.type === "confidence_plateau") {
      parts.push("Confidence stopped improving — we’ll ask one targeted question to break the tie.");
      continue;
    }
  }

  return parts.filter(Boolean).join(" ");
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
  const [ivAnswer, setIvAnswer] = useState("");
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
  const ivConfidence = useMemo(() => {
    const v = Number(inf?.confidenceScore ?? 0);
    return Number.isFinite(v) ? v : 0;
  }, [inf?.confidenceScore]);

  const ivSuggested = safeText(inf?.suggestedIndustryKey);
  const ivStatus = safeText(inf?.status);
  const ivAnsweredCount = inf?.answers?.length ?? 0;
  const ivRound = Number(inf?.round ?? 1) || 1;

  const ivConflicts: Conflict[] = Array.isArray(inf?.conflicts) ? (inf?.conflicts as any) : [];

  // ✅ Locked state: ONLY when backend truly says “suggested”
  const isLocked = ivStatus === "suggested" && Boolean(ivSuggested);

  // Copy thresholds (UI-only)
  const isLow = ivConfidence < 0.55;
  const isMedium = ivConfidence >= 0.55 && ivConfidence < 0.82;

  // Soft progress cap to feel real
  const IV_SOFT_MAX = 8;
  const ivProgressPct = Math.max(
    8,
    Math.min(
      100,
      Math.round(((Math.min(ivAnsweredCount, IV_SOFT_MAX) + (isLocked ? 1 : 0)) / (IV_SOFT_MAX + 1)) * 100)
    )
  );

  const showInterview = !hasWebsite;
  const canContinueInterview = isLocked;

  function topMatchLine() {
    const top = inf?.candidates?.[0];
    const second = inf?.candidates?.[1];

    if (!top) return "Tell us a bit about your business and we’ll pick the best-fit setup.";

    if (isLocked) return `Locked in: ${top.label}. Next you’ll confirm it.`;

    if (ivConflicts.length) {
      const h = conflictHeadline(ivConflicts);
      return h || "We need one clarifying answer.";
    }

    if (second && top.score === second.score) {
      return `We’re torn between ${top.label} and ${second.label}. One more question.`;
    }

    if (isLow) return `Still learning — a couple more answers will make this much smarter.`;
    if (isMedium) return `Leaning toward ${top.label}. One or two more answers should lock it in.`;

    return `Leaning toward ${top.label}. A couple more answers will lock it in.`;
  }

  function lastAnswerLine() {
    const last = inf?.answers?.[inf.answers.length - 1];
    if (!last?.answer) return "";
    return `Last answer: ${String(last.answer)}`;
  }

  function summaryTitle() {
    if (isLocked) return "Your setup is ready";
    if (ivConflicts.length) return "We’re actively resolving a mismatch";
    return "We’re setting up your AIPhotoQuote experience";
  }

  function summarySubtext() {
    if (isLocked) {
      return "We’ve confidently picked the best-fit starter pack. You’ll confirm the final industry on the next step.";
    }
    if (ivConflicts.length) {
      return "Your answers include conflicting signals. We’ll ask one targeted question to make sure we don’t preload the wrong templates.";
    }
    if (isLow) {
      return "We’re building signal. Short, specific answers help a lot (services + what you work on + common jobs).";
    }
    return "We’ll stop early once the top match is clear. You’ll confirm the final industry on the next step.";
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
      setIvAnswer("");
      return next;
    } catch (e: any) {
      setIvErr(e?.message ?? String(e));
      throw e;
    } finally {
      setIvLoading(false);
    }
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
      {!hasWebsite ? (
        <div className="mt-4 space-y-4">
          {/* Top summary row */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{summaryTitle()}</div>
                <div className="mt-1 text-xs opacity-90">{summarySubtext()}</div>

                <div className="mt-2 text-xs font-semibold opacity-95">{topMatchLine()}</div>

                {ivConflicts.length ? (
                  <div className="mt-2 rounded-xl border border-indigo-200/60 bg-white/60 p-3 text-xs text-indigo-950 dark:border-indigo-900/40 dark:bg-black/20 dark:text-indigo-100">
                    <div className="font-semibold">{conflictHeadline(ivConflicts) || "Mismatch detected"}</div>
                    <div className="mt-1 opacity-90">{conflictBody(ivConflicts, inf?.candidates ?? [])}</div>
                  </div>
                ) : null}

                {lastAnswerLine() ? <div className="mt-2 text-xs opacity-90">{lastAnswerLine()}</div> : null}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs">
                  Match strength: <span className="font-mono">{pct(ivConfidence)}%</span>
                </div>
                <div className="text-[11px] opacity-90">Round {ivRound}</div>
                <div className="text-[11px] opacity-80">backend: {pct(ivConfidence)}%</div>
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

          {/* ✅ Question card */}
          {!isLocked ? (
            <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Next</div>
                  <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                    {inf?.nextQuestion?.question ?? (ivLoading ? "Loading…" : "We have enough information.")}
                  </div>

                  {inf?.nextQuestion?.qid ? (
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {whyForQid(inf.nextQuestion.qid)}
                    </div>
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

              {/* Options chips (if provided) */}
              {inf?.nextQuestion?.options?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {inf.nextQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold",
                        "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100",
                        "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900",
                        ivAnswer === opt && "border-indigo-300 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/30"
                      )}
                      onClick={() => setIvAnswer(opt)}
                      disabled={ivLoading}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Free text input */}
              <div className="mt-4">
                <textarea
                  value={ivAnswer}
                  onChange={(e) => setIvAnswer(e.target.value)}
                  rows={3}
                  placeholder="Type your answer…"
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  disabled={ivLoading || !inf?.nextQuestion}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-2xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  disabled={ivLoading || !inf?.nextQuestion || ivAnswer.trim().length < 1}
                  onClick={() =>
                    ivPost({
                      action: "answer",
                      qid: inf?.nextQuestion?.qid,
                      answer: ivAnswer.trim(),
                    }).catch((e: any) => props.onError(e?.message ?? String(e)))
                  }
                >
                  {ivLoading ? "Saving…" : "Submit"}
                </button>

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Tip: short answers are fine — we’re looking for high-signal keywords.
                </div>
              </div>
            </div>
          ) : null}

          {/* ✅ Best matches list */}
          {!isLocked && inf?.candidates?.length ? (
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

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                We’ll stop once the top match is clear — or ask a clarifier if answers conflict.
              </div>
            </div>
          ) : null}

          {/* ✅ Ready panel */}
          {isLocked ? (
            <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                <div className="font-semibold">Ready</div>
                <div className="mt-1">
                  We’ll preload the{" "}
                  <span className="font-semibold">{inf?.candidates?.[0]?.label ?? ivSuggested}</span> starter pack.
                  Next you’ll confirm the industry.
                </div>
              </div>
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