// src/app/onboarding/wizard/steps/Step3b.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function clamp01(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function pct(n: number) {
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

type NextQuestion = {
  id: string;
  question: string;
  help?: string | null;
  inputType: "text" | "select";
  options?: string[];
};

type Candidate = { label: string; score: number };

type SubInterview = {
  mode: "SUB";
  status: "collecting" | "locked";
  round: number;

  industryKey: string;
  confidenceScore: number;

  proposedSubIndustryLabel: string | null;
  candidates: Candidate[];

  nextQuestion: NextQuestion | null;

  answers: Array<{
    id: string;
    question: string;
    answer: string;
    createdAt: string;
  }>;

  meta?: any;
};

async function postSubInterview(payload: any) {
  const res = await fetch("/api/onboarding/sub-industry-interview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const txt = await res.text().catch(() => "");
  const j = txt ? JSON.parse(txt) : null;

  if (!res.ok || !j?.ok) {
    throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
  }
  return j as { ok: true; tenantId: string; subIndustryInterview: SubInterview };
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/**
 * Step3 can set sessionStorage "apq_onboarding_sub_intent":
 *  - "refine"  -> auto select Yes and auto-start interview
 *  - "skip"    -> immediately persist null (no sub-industry) and continue
 *  - "unknown" -> do nothing
 */
function readAndClearSubIntent(): "refine" | "skip" | "unknown" {
  try {
    const v = String(window.sessionStorage.getItem("apq_onboarding_sub_intent") ?? "").trim();
    window.sessionStorage.removeItem("apq_onboarding_sub_intent");
    if (v === "refine" || v === "skip") return v;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function Step3b(props: {
  tenantId: string | null;
  industryKey: string; // confirmed industry from Step3 selection
  aiAnalysis: any | null | undefined;

  onBack: () => void;

  // If they say “No, keep it broad”
  onSkip: () => void;

  // Save + continue (label may be null if they skip)
  onSubmit: (args: { subIndustryLabel: string | null }) => Promise<void>;

  onError: (m: string) => void;
}) {
  const tid = safeTrim(props.tenantId);
  const industryKey = safeTrim(props.industryKey);

  const existingFromAi: SubInterview | null = useMemo(() => {
    const x = props.aiAnalysis?.subIndustryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "SUB") return null;
    return x as SubInterview;
  }, [props.aiAnalysis]);

  const [state, setState] = useState<SubInterview | null>(existingFromAi);

  useEffect(() => {
    if (!existingFromAi) return;
    setState((prev) => {
      const prevRound = Number(prev?.round ?? 0) || 0;
      const nextRound = Number(existingFromAi.round ?? 0) || 0;
      return nextRound >= prevRound ? existingFromAi : prev;
    });
  }, [existingFromAi]);

  const status = safeTrim(state?.status) || "collecting";
  const nextQ = (state?.nextQuestion ?? null) as NextQuestion | null;

  const conf = clamp01(state?.confidenceScore);
  const proposed = safeTrim(state?.proposedSubIndustryLabel) || "";
  const candidates: Candidate[] = Array.isArray(state?.candidates)
    ? state!.candidates
        .map((c: any) => ({ label: safeTrim(c?.label), score: clamp01(c?.score) }))
        .filter((c) => c.label)
        .slice(0, 5)
    : [];

  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Debug support on mobile: add ?debug=1
  const debugOn = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("debug") === "1";
    } catch {
      return false;
    }
  }, []);
  const [lastApi, setLastApi] = useState<any>(null);

  const [wantsSub, setWantsSub] = useState<"yes" | "no" | "">("");
  const [textAnswer, setTextAnswer] = useState("");
  const [choiceAnswer, setChoiceAnswer] = useState<string>("");

  const lastSubmitRef = useRef<string>("");
  const didHydrateIntentRef = useRef(false);

  // ✅ locked is locked even if proposedSubIndustryLabel is missing/null
  const isLocked = status === "locked";

  // Reset answer box when question changes
  useEffect(() => {
    setErr(null);
    setTextAnswer("");
    setChoiceAnswer("");
    lastSubmitRef.current = "";
  }, [nextQ?.id]);

  async function saveAndContinue(label: string | null) {
    setWorking(true);
    setErr(null);
    try {
      await props.onSubmit({ subIndustryLabel: label });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  async function start() {
    if (!tid) return;
    if (!industryKey) return setErr("Missing industryKey.");
    if (nextQ?.id || isLocked) return;

    setWorking(true);
    setErr(null);
    try {
      const out = await postSubInterview({ tenantId: tid, industryKey, action: "start" });
      setState(out.subIndustryInterview);
      if (debugOn) setLastApi(out);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  /**
   * ✅ CLEAN HANDOFF FROM STEP3
   * - If Step3 said "skip", we immediately persist null and continue (no sub prompt shown).
   * - If Step3 said "refine", we auto-select Yes and auto-start.
   */
  useEffect(() => {
    if (didHydrateIntentRef.current) return;
    didHydrateIntentRef.current = true;

    const intent = readAndClearSubIntent();

    // We may mount before tenantId/industryKey are present; handle that in a follow-up effect.
    if (intent === "refine") {
      setWantsSub("yes");
      return;
    }

    if (intent === "skip") {
      // If we have what we need right now, persist and continue.
      if (tid && industryKey) {
        saveAndContinue(null).catch(() => null);
      } else {
        // Defer until tid/industryKey arrive.
        setWantsSub("no");
      }
    }
    // unknown => leave wantsSub empty (show prompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we deferred "skip" because tid/industryKey weren't ready, finish it once ready.
  useEffect(() => {
    if (!didHydrateIntentRef.current) return;
    // Only apply if user hasn't made an explicit choice AND we're in the "no" state from deferred skip.
    if (wantsSub !== "no") return;
    if (!tid || !industryKey) return;

    // If Step3b is already in-progress or locked, don't auto-skip.
    if (nextQ?.id || isLocked) return;

    // Auto-continue only if this "no" was set by intent hydration (best-effort).
    // We can safely proceed if there is no existing interview state and no question.
    if (!state) {
      saveAndContinue(null).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, industryKey]);

  // ✅ auto-start when they choose yes (including from Step3 refine intent)
  useEffect(() => {
    if (wantsSub !== "yes") return;
    if (!tid || !industryKey) return;
    if (isLocked) return;
    if (nextQ?.id) return;
    start().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsSub, tid, industryKey, isLocked, nextQ?.id]);

  function buildAnswerPayload(): string {
    if (!nextQ) return "";
    if (nextQ.inputType === "select") return safeTrim(choiceAnswer);
    return safeTrim(textAnswer);
  }

  async function submitAnswer() {
    if (!tid) return setErr("Missing tenantId.");
    if (!industryKey) return setErr("Missing industryKey.");
    if (!nextQ?.id) return setErr("No active question yet.");

    const ans = buildAnswerPayload();
    if (!ans) return setErr("Please answer the question to continue.");

    const dupeKey = `${tid}:${nextQ.id}:${ans}`;
    if (lastSubmitRef.current === dupeKey) return;
    lastSubmitRef.current = dupeKey;

    setWorking(true);
    setErr(null);

    try {
      const out = await postSubInterview({
        tenantId: tid,
        industryKey,
        action: "answer",
        questionId: nextQ.id,
        questionText: nextQ.question,
        answer: ans,
      });

      if (debugOn) setLastApi(out);

      setState(out.subIndustryInterview);

      const returnedNextId = safeTrim(out?.subIndustryInterview?.nextQuestion?.id);
      const currentId = safeTrim(nextQ.id);
      if (returnedNextId && returnedNextId === currentId) {
        setErr("Server returned the same question again (no progression). Check debug output (?debug=1).");
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
      lastSubmitRef.current = "";
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">One more thing (optional)</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        If you want, we can narrow your setup with a sub-industry — so the default services, photo requests, and questions feel
        more “you” from day one.
      </div>

      {debugOn ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          <div className="font-semibold">Debug</div>
          <div className="mt-1">
            tenantId: <span className="font-mono">{tid || "(none)"}</span>
          </div>
          <div className="mt-1">
            industryKey: <span className="font-mono">{industryKey || "(none)"}</span>
          </div>
          <div className="mt-1">
            nextQ.id: <span className="font-mono">{nextQ?.id || "(none)"}</span>
          </div>
          <div className="mt-2 font-mono whitespace-pre-wrap break-words">{lastApi ? JSON.stringify(lastApi, null, 2) : "(no API response yet)"}</div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Ask if they want a sub-industry (ONLY if no auto-intent forced us into yes/no) */}
      {wantsSub === "" ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Would a sub-industry be useful?</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Example: “Exterior-only”, “Cabinet refinishing”, “Commercial interiors”, “New construction”, etc.
          </div>

          <div className="mt-3 grid gap-2">
            {(["yes", "no"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold",
                  wantsSub === v
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                )}
                onClick={() => setWantsSub(v)}
                disabled={working}
              >
                {v === "yes" ? "Yes — let’s narrow it down" : "No — keep it broad for now"}
              </button>
            ))}
          </div>

          {wantsSub === "no" ? (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                onClick={props.onBack}
                disabled={working}
              >
                Back
              </button>
              <button
                type="button"
                className="w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                onClick={() => saveAndContinue(null)}
                disabled={working}
              >
                Continue →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Sub-industry interview */}
      {wantsSub === "yes" ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sub-industry interview</div>

            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={() => start().catch(() => null)}
              disabled={working || !tid || !industryKey || Boolean(nextQ?.id) || isLocked}
            >
              {isLocked ? "Locked" : nextQ?.id ? "Running" : "Start"}
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Live understanding</div>
                <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {proposed ? <span className="font-semibold">{proposed}</span> : <span className="opacity-80">Building context…</span>}
                </div>

                {candidates.length ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Close matches</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {candidates.map((c, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                        >
                          {c.label}
                          <span className="ml-2 font-mono opacity-70">{pct(c.score)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                Confidence: <span className="font-mono">{pct(conf)}%</span>
              </div>
            </div>
          </div>

          {!nextQ && !isLocked ? (
            <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">{working ? "Thinking…" : "Tap Start to begin…"}</div>
          ) : null}

          {isLocked ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="font-semibold">Nice — this helps.</div>
              <div className="mt-1">
                Suggested sub-industry: <span className="font-semibold">{proposed || "(none yet)"}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  onClick={props.onBack}
                  disabled={working}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => saveAndContinue(proposed)}
                  disabled={working || !proposed}
                >
                  Use this & continue →
                </button>
              </div>
            </div>
          ) : nextQ ? (
            <div className="mt-4">
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{nextQ.question}</div>
              {nextQ.help ? <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{nextQ.help}</div> : null}

              <div className="mt-4">
                {nextQ.inputType === "text" ? (
                  <textarea
                    value={textAnswer}
                    onChange={(e) => setTextAnswer(e.target.value)}
                    rows={3}
                    placeholder="Type your answer…"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  />
                ) : null}

                {nextQ.inputType === "select" ? (
                  <div className="grid gap-2">
                    {(nextQ.options ?? []).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold",
                          choiceAnswer === opt
                            ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                        )}
                        onClick={() => setChoiceAnswer(opt)}
                        disabled={working}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  onClick={props.onBack}
                  disabled={working}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => submitAnswer().catch(() => null)}
                  disabled={working || !tid || !industryKey || !nextQ?.id}
                >
                  {working ? "Thinking…" : "Continue →"}
                </button>
              </div>

              <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                If you’d rather skip this, you can go back and choose “keep it broad”.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}