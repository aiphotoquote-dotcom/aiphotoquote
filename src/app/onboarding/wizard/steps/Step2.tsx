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

type NextQuestion = {
  id: string;
  question: string;
  help?: string | null;
  inputType: "text" | "yes_no" | "single_choice" | "multi_choice";
  options?: string[];
};

type Candidate = { label: string; score: number };

type IndustryInterviewA = {
  mode: "A";
  status: "collecting" | "ready";
  round: number;

  hypothesisLabel: string | null;
  proposedIndustry: { key: string; label: string } | null;

  confidenceScore: number;
  fitScore: number;
  fitReason: string | null;

  candidates: Candidate[];
  nextQuestion: NextQuestion | null;

  turns: Array<{
    id: string;
    question: string;
    inputType: string;
    options?: string[];
    answer?: string | null;
    createdAt: string;
  }>;

  meta?: any;
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function Step2(props: {
  tenantId: string | null;

  website: string;
  aiAnalysis: any | null | undefined;

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

  const [interviewState, setInterviewState] = useState<IndustryInterviewA | null>(interviewFromProps);

  useEffect(() => {
    if (!interviewFromProps) return;
    setInterviewState((prev) => {
      const prevRound = Number(prev?.round ?? 0) || 0;
      const nextRound = Number(interviewFromProps.round ?? 0) || 0;
      return nextRound >= prevRound ? interviewFromProps : prev;
    });
  }, [interviewFromProps]);

  const status = safeTrim(interviewState?.status) || "collecting";
  const nextQ = (interviewState?.nextQuestion ?? null) as NextQuestion | null;

  const hypothesis =
    safeTrim(interviewState?.hypothesisLabel) || safeTrim(interviewState?.proposedIndustry?.label) || "";
  const proposedKey = safeTrim(interviewState?.proposedIndustry?.key);
  const conf = clamp01(interviewState?.confidenceScore);
  const fit = clamp01(interviewState?.fitScore);
  const fitReason = safeTrim(interviewState?.fitReason);

  const candidates: Candidate[] = Array.isArray(interviewState?.candidates)
    ? interviewState!.candidates
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

  const [textAnswer, setTextAnswer] = useState("");
  const [choiceAnswer, setChoiceAnswer] = useState<string>("");
  const [multiAnswer, setMultiAnswer] = useState<Record<string, boolean>>({});

  const lastSubmitRef = useRef<string>("");

  useEffect(() => {
    setErr(null);
    setTextAnswer("");
    setChoiceAnswer("");
    setMultiAnswer({});
    lastSubmitRef.current = "";
  }, [nextQ?.id]);

  async function startIfNeeded() {
    if (!tid) return;
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

  useEffect(() => {
    startIfNeeded().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  function buildAnswerPayload(): string {
    if (!nextQ) return "";

    if (nextQ.inputType === "yes_no") {
      const v = safeTrim(choiceAnswer);
      if (!v) return "";
      return v;
    }

    if (nextQ.inputType === "single_choice") return safeTrim(choiceAnswer);

    if (nextQ.inputType === "multi_choice") {
      const picked = Object.entries(multiAnswer)
        .filter(([, on]) => on)
        .map(([k]) => k);
      return picked.length ? picked.join(", ") : "";
    }

    return safeTrim(textAnswer);
  }

  async function submitAnswer() {
    if (!tid) return setErr("Missing tenantId.");
    if (!nextQ?.id) return setErr("No active question yet. Tap ‘Start interview’.");

    const ans = buildAnswerPayload();
    if (!ans) return setErr("Please answer the question to continue.");

    const dupeKey = `${tid}:${nextQ.id}:${ans}`;
    if (lastSubmitRef.current === dupeKey) return;
    lastSubmitRef.current = dupeKey;

    setWorking(true);
    setErr(null);

    try {
      const out = await postInterview({
        tenantId: tid,
        action: "answer",

        // 🔒 “belt + suspenders” payload for whatever your API expects:
        turnId: nextQ.id,
        questionId: nextQ.id,
        questionText: nextQ.question,

        answer: ans,
        answerText: ans,
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

  const showReady = status === "ready" && Boolean(proposedKey);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industry interview</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll ask a few smart questions to understand what you do — then we’ll build the best-fit industry starter pack.
      </div>

      {debugOn ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          <div className="font-semibold">Debug</div>
          <div className="mt-1">tenantId: <span className="font-mono">{tid || "(none)"}</span></div>
          <div className="mt-1">nextQ.id: <span className="font-mono">{nextQ?.id || "(none)"}</span></div>
          <div className="mt-2 font-mono whitespace-pre-wrap break-words">
            {lastApi ? JSON.stringify(lastApi, null, 2) : "(no API response yet)"}
          </div>
        </div>
      ) : null}

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
                      key={i}
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

        {fitReason ? <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">{fitReason}</div> : null}
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Question</div>

          <button
            type="button"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            onClick={() => startIfNeeded().catch(() => null)}
            disabled={working || !tid}
          >
            {nextQ?.id ? "Interview running" : "Start interview"}
          </button>
        </div>

        {!nextQ ? (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            {working ? "Thinking…" : "Waiting for the first question…"}
          </div>
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

              {nextQ.inputType === "yes_no" || nextQ.inputType === "single_choice" ? (
                <div className="grid gap-2">
                  {(nextQ.inputType === "yes_no"
                    ? ["Yes", "No"]
                    : Array.isArray(nextQ.options) && nextQ.options.length
                      ? nextQ.options
                      : []
                  ).map((opt) => (
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

              {nextQ.inputType === "multi_choice" ? (
                <div className="grid gap-2">
                  {(nextQ.options ?? []).map((opt) => {
                    const on = Boolean(multiAnswer[opt]);
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold",
                          on
                            ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                        )}
                        onClick={() => setMultiAnswer((p) => ({ ...p, [opt]: !p[opt] }))}
                        disabled={working}
                      >
                        {opt}
                      </button>
                    );
                  })}
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

            {showReady ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                <div className="font-semibold">We’re ready.</div>
                <div className="mt-1">
                  Next step will let you confirm: <span className="font-semibold">{hypothesis || proposedKey}</span>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
                    onClick={props.onNext}
                  >
                    Continue to industry confirmation →
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}