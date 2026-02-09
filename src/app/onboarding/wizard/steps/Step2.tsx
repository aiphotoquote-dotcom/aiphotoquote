// src/app/onboarding/wizard/steps/Step2.tsx
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/* -------------------- Mode A (server) shapes -------------------- */

type NextQuestion = {
  id: string;
  question: string;
  help?: string | null;
  inputType: "text" | "select";
  options?: string[];
};

type Candidate = { key: string; label: string; score: number; exists?: boolean };

type ProposedIndustry = {
  key: string;
  label: string;
  description?: string | null;
  exists: boolean;
  shouldCreate: boolean;
};

type InterviewAnswer = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

type IndustryInterviewA = {
  mode: "A";
  status: "collecting" | "locked";
  round: number;

  confidenceScore: number;
  fitScore: number;

  proposedIndustry: ProposedIndustry | null;
  candidates: Candidate[];

  nextQuestion: NextQuestion | null;
  answers: InterviewAnswer[];

  meta?: {
    updatedAt?: string;
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string };
  };
};

async function postInterview(payload: any) {
  const res = await fetch("/api/onboarding/industry-interview", {
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
  return j as { ok: true; tenantId: string; industryInterview: IndustryInterviewA };
}

export function Step2(props: {
  tenantId: string | null;

  website: string;
  aiAnalysis: any | null | undefined;

  // legacy props kept for compatibility with wizard
  aiAnalysisStatus?: string | null;
  aiAnalysisError?: string | null;
  onRun: () => Promise<void>;
  onConfirm: (args: { answer: "yes" | "no"; feedback?: string }) => Promise<void>;

  onNext: () => void;
  onBack: () => void;
  onError: (m: string) => void;
}) {
  const tid = safeTrim(props.tenantId);

  const interviewFromProps: IndustryInterviewA | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if (x.mode !== "A") return null;
    return x as IndustryInterviewA;
  }, [props.aiAnalysis]);

  // Keep a local copy so mobile UI updates immediately after POST
  const [interviewState, setInterviewState] = useState<IndustryInterviewA | null>(interviewFromProps);

  useEffect(() => {
    if (!interviewFromProps) return;
    setInterviewState((prev) => {
      const prevRound = Number(prev?.round ?? 0) || 0;
      const nextRound = Number(interviewFromProps.round ?? 0) || 0;
      // Prefer newer or equal state (prevents regress)
      return nextRound >= prevRound ? interviewFromProps : prev;
    });
  }, [interviewFromProps]);

  const status = safeTrim(interviewState?.status) || "collecting";
  const isLocked = status === "locked";

  const nextQ = (interviewState?.nextQuestion ?? null) as NextQuestion | null;

  const proposed = interviewState?.proposedIndustry ?? null;
  const hypothesis = safeTrim(proposed?.label) || "";
  const proposedKey = safeTrim(proposed?.key);

  const conf = clamp01(interviewState?.confidenceScore);
  const fit = clamp01(interviewState?.fitScore);
  const reason = safeTrim(interviewState?.meta?.debug?.reason);

  const candidates: Candidate[] = Array.isArray(interviewState?.candidates)
    ? interviewState!.candidates
        .map((c: any) => ({
          key: safeTrim(c?.key),
          label: safeTrim(c?.label),
          score: clamp01(c?.score),
          exists: Boolean(c?.exists),
        }))
        .filter((c) => c.key && c.label)
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

  // current answer UI state
  const [textAnswer, setTextAnswer] = useState("");
  const [choiceAnswer, setChoiceAnswer] = useState<string>("");
  const lastSubmitRef = useRef<string>("");

  useEffect(() => {
    setErr(null);
    setTextAnswer("");
    setChoiceAnswer("");
    lastSubmitRef.current = "";
  }, [nextQ?.id]);

  async function startIfNeeded() {
    if (!tid) return;

    // ✅ If locked, never “restart” the interview.
    if (isLocked) return;

    // ✅ If we already have a question, do nothing.
    if (nextQ?.id) return;

    setWorking(true);
    setErr(null);

    try {
      const out = await postInterview({ tenantId: tid, action: "start" });
      setInterviewState(out.industryInterview);
      if (debugOn) setLastApi(out);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  // Auto-start when step loads (unless locked)
  useEffect(() => {
    startIfNeeded().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, isLocked]);

  function buildAnswerPayload(): string {
    if (!nextQ) return "";
    if (nextQ.inputType === "select") return safeTrim(choiceAnswer);
    return safeTrim(textAnswer);
  }

  async function submitAnswer() {
    if (!tid) return setErr("Missing tenantId.");
    if (isLocked) return; // no-op
    if (!nextQ?.id) return setErr("No active question yet. Tap ‘Start interview’.");

    const ans = buildAnswerPayload();
    if (!ans) return setErr("Please answer the question to continue.");

    // UI-level anti-double-submit
    const dupeKey = `${tid}:${nextQ.id}:${ans}`;
    if (lastSubmitRef.current === dupeKey) return;
    lastSubmitRef.current = dupeKey;

    setWorking(true);
    setErr(null);

    try {
      const out = await postInterview({
        tenantId: tid,
        action: "answer",

        // ✅ API can accept questionId only (but we send questionText too for safety)
        questionId: nextQ.id,
        questionText: nextQ.question,

        answer: ans,
      });

      if (debugOn) setLastApi(out);

      const returnedNextId = safeTrim(out?.industryInterview?.nextQuestion?.id);
      const currentId = safeTrim(nextQ.id);

      setInterviewState(out.industryInterview);

      // If server returns the *same* question again, surface it loudly.
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

  const showReady = isLocked && Boolean(proposedKey);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industry interview</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll ask a few smart questions to understand what you do — then we’ll build the best-fit industry starter pack.
      </div>

      {debugOn ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          <div className="font-semibold">Debug</div>
          <div className="mt-1">
            tenantId: <span className="font-mono">{tid || "(none)"}</span>
          </div>
          <div className="mt-1">
            status: <span className="font-mono">{status || "(none)"}</span>
          </div>
          <div className="mt-1">
            nextQ.id: <span className="font-mono">{nextQ?.id || "(none)"}</span>
          </div>
          <div className="mt-2 font-mono whitespace-pre-wrap break-words">
            {lastApi ? JSON.stringify(lastApi, null, 2) : "(no API response yet)"}
          </div>
        </div>
      ) : null}

      {/* Live AI card */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Live understanding</div>

            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {hypothesis ? (
                <>
                  <span className="font-semibold">{hypothesis}</span>
                  {proposedKey ? <span className="ml-2 font-mono text-xs opacity-70">({proposedKey})</span> : null}
                </>
              ) : (
                <span className="text-gray-600 dark:text-gray-300">Building context…</span>
              )}
            </div>

            {candidates.length ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Other possible matches</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidates.map((c, i) => (
                    <span
                      key={`${c.key}-${i}`}
                      className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200"
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
            <div>
              Confidence: <span className="font-mono">{pct(conf)}%</span>
            </div>
            <div>
              Fit: <span className="font-mono">{pct(fit)}%</span>
            </div>
          </div>
        </div>

        {reason ? <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">{reason}</div> : null}
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Ready/Locked panel (dominant) */}
      {showReady ? (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="text-base font-semibold">We’re ready.</div>
          <div className="mt-1">
            Suggested industry: <span className="font-semibold">{hypothesis}</span>{" "}
            {proposedKey ? <span className="font-mono text-xs opacity-70">({proposedKey})</span> : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-emerald-200 bg-white py-3 text-sm font-semibold text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100"
              onClick={props.onBack}
              disabled={working}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
              onClick={props.onNext}
            >
              Continue to confirmation →
            </button>
          </div>

          <div className="mt-3 text-xs opacity-80">
            Tip: If this looks wrong, hit Back and re-run the interview (or enable debug with ?debug=1).
          </div>
        </div>
      ) : null}

      {/* Question card (only when collecting) */}
      {!showReady ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Question</div>

            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={() => startIfNeeded().catch(() => null)}
              disabled={working || !tid}
              title="Starts the interview if it hasn’t started yet."
            >
              {nextQ?.id ? "Interview running" : "Start interview"}
            </button>
          </div>

          {!nextQ ? (
            <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">{working ? "Thinking…" : "Thinking…"}</div>
          ) : (
            <div className="mt-3">
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
                  disabled={working || !tid || !nextQ?.id}
                >
                  {working ? "Thinking…" : "Continue →"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}