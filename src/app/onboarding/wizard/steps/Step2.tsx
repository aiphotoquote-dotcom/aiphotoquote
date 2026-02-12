// src/app/onboarding/wizard/steps/Step2.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function clamp01Nullable(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.max(0, Math.min(100, Math.round(n * 100)))}%`;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/* -------------------- Interview (server) shapes -------------------- */

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
  let j: any = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    j = null;
  }

  if (!res.ok || !j?.ok) {
    throw new Error(j?.message || j?.error || (txt ? txt : `HTTP ${res.status}`));
  }
  return j as { ok: true; tenantId: string; industryInterview: IndustryInterviewA };
}

/* -------------------- Helpers for AI analysis -------------------- */

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) {
        ok = false;
        break;
      }
      cur = cur[k];
    }
    if (ok) return cur;
  }
  return null;
}

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function hasMeaningfulAnalysis(aiAnalysis: any): boolean {
  if (!aiAnalysis || typeof aiAnalysis !== "object") return false;

  const proposedKey = safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.key"]));
  const proposedLabel = safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.label"]));

  const suggestedKey =
    safeTrim(pick(aiAnalysis, ["suggestedIndustryKey", "suggested_industry_key"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustry.key"]));

  const suggestedLabel =
    safeTrim(pick(aiAnalysis, ["suggestedIndustryLabel"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustry.label"])) ||
    "";

  const conf =
    pick(aiAnalysis, ["confidenceScore", "confidence_score"]) ??
    pick(aiAnalysis, ["industryInterview.confidenceScore"]) ??
    null;

  const confNum = Number(conf);
  const hasConf = Number.isFinite(confNum) && confNum > 0;

  return Boolean(proposedKey || proposedLabel || suggestedKey || suggestedLabel || hasConf);
}

export function Step2(props: {
  tenantId: string | null;

  website: string;
  aiAnalysis: any | null | undefined;

  // wizard-provided
  aiAnalysisStatus?: string | null;
  aiAnalysisError?: string | null;
  onRun: () => Promise<void>;
  onConfirm: (args: { answer: "yes" | "no"; feedback?: string }) => Promise<void>;

  onNext: () => void;
  onBack: () => void;
  onError: (m: string) => void;
}) {
  const tid = safeTrim(props.tenantId);
  const website = safeTrim(props.website);
  const hasWebsite = Boolean(website);

  const aiStatusRaw = safeTrim(props.aiAnalysisStatus);
  const aiStatus = aiStatusRaw.toLowerCase();
  const aiErr = safeTrim(props.aiAnalysisError);

  const isRunning = aiStatus === "running";

  const hasAnalysis = useMemo(() => hasMeaningfulAnalysis(props.aiAnalysis), [props.aiAnalysis]);

  // ✅ Key: always pull a REAL industry key if available
  const suggestedKey =
    safeTrim(pick(props.aiAnalysis, ["industryInterview.proposedIndustry.key"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustryKey", "suggested_industry_key"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustry.key"])) ||
    "";

  // ✅ Label: DO NOT fall back to businessGuess (that’s the long paragraph)
  const suggestedLabel =
    safeTrim(pick(props.aiAnalysis, ["industryInterview.proposedIndustry.label"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustryLabel", "suggestedIndustry.label"])) ||
    (suggestedKey ? titleFromKey(suggestedKey) : "") ||
    "";

  // Optional “why” / summary (this is where the long paragraph belongs)
  const suggestedWhy =
    safeTrim(pick(props.aiAnalysis, ["businessGuess", "business_guess"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustryReason", "suggestedIndustry.reason"])) ||
    safeTrim(pick(props.aiAnalysis, ["industryInterview.meta.debug.reason"])) ||
    "";

  const confidenceScore =
    pick(props.aiAnalysis, ["confidenceScore", "confidence_score"]) ??
    pick(props.aiAnalysis, ["industryInterview.confidenceScore"]) ??
    null;

  const fitScore =
    pick(props.aiAnalysis, ["fitScore", "fit_score"]) ??
    pick(props.aiAnalysis, ["fit"]) ??
    pick(props.aiAnalysis, ["industryInterview.fitScore"]) ??
    null;

  const conf = clamp01Nullable(confidenceScore);
  const fit = clamp01Nullable(fitScore);

  const [working, setWorking] = useState(false);

  // Controls whether we’re showing the interview UI.
  const [showInterview, setShowInterview] = useState<boolean>(() => !hasWebsite);

  // Auto-run analysis ONCE per (tenantId + website) when website exists and we don't have meaningful analysis yet.
  const didAutoRunRef = useRef(false);
  const autoRunKeyRef = useRef<string>("");

  // Progress UI for "analysis running"
  const runStartRef = useRef<number | null>(null);
  const [runTick, setRunTick] = useState(0);

  useEffect(() => {
    if (isRunning && !runStartRef.current) runStartRef.current = Date.now();
    if (!isRunning) runStartRef.current = null;
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const t = window.setInterval(() => setRunTick((x) => x + 1), 300);
    return () => window.clearInterval(t);
  }, [isRunning]);

  const runProgress = useMemo(() => {
    if (!isRunning) return 0;
    const start = runStartRef.current ?? Date.now();
    const elapsed = Date.now() - start;

    // "Feels" like progress; caps at 95% until we flip to ready.
    const maxMs = 45_000;
    const p = Math.min(0.95, Math.max(0.06, elapsed / maxMs));
    return p;
  }, [isRunning, runTick]);

  const runMessage = useMemo(() => {
    if (!isRunning) return "";
    const msgs = [
      "Fetching website content…",
      "Extracting signals (services, locations, keywords)…",
      "Comparing against known industry patterns…",
      "Building your suggested setup…",
      "Finalizing…",
    ];
    const idx = Math.min(msgs.length - 1, Math.floor(runProgress * msgs.length));
    return msgs[idx] ?? "Analyzing…";
  }, [isRunning, runProgress]);

  // Debug support on mobile: add ?debug=1
  const debugOn = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("debug") === "1";
    } catch {
      return false;
    }
  }, []);

  // ✅ Reset auto-run guard whenever tenantId or website changes
  useEffect(() => {
    const k = `${tid || "(no-tenant)"}|${website || "(no-website)"}`;
    if (autoRunKeyRef.current !== k) {
      autoRunKeyRef.current = k;
      didAutoRunRef.current = false;
    }
  }, [tid, website]);

  async function runAnalysisSafely() {
    if (!tid) {
      props.onError("NO_TENANT: missing tenantId for analysis.");
      return;
    }
    if (working) return;

    setWorking(true);
    try {
      await props.onRun();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!hasWebsite) {
      setShowInterview(true);
      return;
    }

    setShowInterview(false);

    if (hasAnalysis) return;
    if (isRunning) return;

    if (!didAutoRunRef.current && tid) {
      didAutoRunRef.current = true;
      runAnalysisSafely().catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWebsite, hasAnalysis, isRunning, tid]);

  /* -------------------- Interview state (unchanged, but gated) -------------------- */

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
  const isLocked = status === "locked";
  const nextQ = (interviewState?.nextQuestion ?? null) as NextQuestion | null;

  const proposed = interviewState?.proposedIndustry ?? null;
  const hypothesis = safeTrim(proposed?.label) || "";
  const proposedKey = safeTrim(proposed?.key);

  const intConf = clamp01Nullable(interviewState?.confidenceScore);
  const intFit = clamp01Nullable(interviewState?.fitScore);
  const reason = safeTrim(interviewState?.meta?.debug?.reason);

  const candidates: Candidate[] = Array.isArray(interviewState?.candidates)
    ? interviewState!.candidates
        .map((c: any) => ({
          key: safeTrim(c?.key),
          label: safeTrim(c?.label),
          score: Number.isFinite(Number(c?.score)) ? Math.max(0, Math.min(1, Number(c?.score))) : 0,
          exists: Boolean(c?.exists),
        }))
        .filter((c) => c.key && c.label)
        .slice(0, 5)
    : [];

  const [lastApi, setLastApi] = useState<any>(null);

  const [textAnswer, setTextAnswer] = useState("");
  const [choiceAnswer, setChoiceAnswer] = useState<string>("");
  const lastSubmitRef = useRef<string>("");

  useEffect(() => {
    setTextAnswer("");
    setChoiceAnswer("");
    lastSubmitRef.current = "";
  }, [nextQ?.id]);

  async function startIfNeeded() {
    if (!tid) return;
    if (isLocked) return;
    if (nextQ?.id) return;

    setWorking(true);
    try {
      const out = await postInterview({ tenantId: tid, action: "start" });
      setInterviewState(out.industryInterview);
      if (debugOn) setLastApi(out);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!showInterview) return;
    startIfNeeded().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInterview, tid, isLocked]);

  function buildAnswerPayload(): string {
    if (!nextQ) return "";
    if (nextQ.inputType === "select") return safeTrim(choiceAnswer);
    return safeTrim(textAnswer);
  }

  async function submitAnswer() {
    if (!tid) return props.onError("Missing tenantId.");
    if (isLocked) return;
    if (!nextQ?.id) return props.onError("No active question yet. Tap ‘Start interview’.");

    const ans = buildAnswerPayload();
    if (!ans) return props.onError("Please answer the question to continue.");

    const dupeKey = `${tid}:${nextQ.id}:${ans}`;
    if (lastSubmitRef.current === dupeKey) return;
    lastSubmitRef.current = dupeKey;

    setWorking(true);

    try {
      const out = await postInterview({
        tenantId: tid,
        action: "answer",
        questionId: nextQ.id,
        questionText: nextQ.question,
        answer: ans,
      });

      if (debugOn) setLastApi(out);

      const returnedNextId = safeTrim(out?.industryInterview?.nextQuestion?.id);
      const currentId = safeTrim(nextQ.id);

      setInterviewState(out.industryInterview);

      if (returnedNextId && returnedNextId === currentId) {
        props.onError("Server returned the same question again (no progression). Check debug output (?debug=1).");
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
      lastSubmitRef.current = "";
    } finally {
      setWorking(false);
    }
  }

  const showReady = showInterview && isLocked && Boolean(proposedKey);

  /* -------------------- Analysis UI actions -------------------- */

  async function handleConfirmYes() {
    setWorking(true);
    try {
      // NOTE: Step2 is the confirmation moment.
      // We should later make Step3 auto-skip if the industry was already confirmed.
      await props.onConfirm({ answer: "yes" });
      props.onNext();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  async function handleConfirmNo() {
    setWorking(true);
    try {
      await props.onConfirm({ answer: "no" });
      setShowInterview(true);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  const heroLabel = safeTrim(suggestedLabel) || "your industry";
  const heroKey = safeTrim(suggestedKey);

  return (
    <div>
      {/* If we have a website and we're not interviewing, this is the Website Analysis step */}
      {hasWebsite && !showInterview ? (
        <>
          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Website analysis</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            We’ll analyze your website to predict your industry — then you can confirm or correct it.
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Website</div>
            <div className="mt-1 break-all font-mono text-xs text-gray-800 dark:text-gray-200">{website}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-1 font-semibold",
                  isRunning
                    ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-black dark:text-slate-200"
                    : hasAnalysis
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                )}
              >
                {isRunning ? "Analysis running" : hasAnalysis ? "Analysis ready" : "Not analyzed yet"}
              </span>

              {aiErr ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  {aiErr}
                </span>
              ) : null}
            </div>

            {/* Running details: progress + explanation */}
            {isRunning ? (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full bg-emerald-600 transition-[width] duration-300"
                    style={{ width: `${Math.round(runProgress * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{runMessage}</div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              {!hasAnalysis ? (
                <button
                  type="button"
                  className="w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => runAnalysisSafely().catch(() => null)}
                  disabled={working || isRunning || !tid}
                >
                  {isRunning ? "Analyzing…" : "Run analysis now"}
                </button>
              ) : (
                <>
                  {/* ✅ Proud moment card */}
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/25">
                    <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">We think you are in</div>
                    <div className="mt-2 text-2xl font-extrabold leading-tight text-emerald-950 dark:text-emerald-100">
                      {heroLabel}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-emerald-900/80 dark:text-emerald-100/80">
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2 py-1 font-semibold dark:border-emerald-900/40 dark:bg-black">
                        Confidence: <span className="ml-1 font-mono">{pct(conf)}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2 py-1 font-semibold dark:border-emerald-900/40 dark:bg-black">
                        Fit: <span className="ml-1 font-mono">{pct(fit)}</span>
                      </span>

                      {/* Hide the technical key unless debug is on */}
                      {debugOn && heroKey ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2 py-1 font-semibold dark:border-emerald-900/40 dark:bg-black">
                          key: <span className="ml-1 font-mono">{heroKey}</span>
                        </span>
                      ) : null}
                    </div>

                    {/* Optional why */}
                    {safeTrim(suggestedWhy) ? (
                      <details className="mt-4">
                        <summary className="cursor-pointer select-none text-xs font-semibold text-emerald-900 dark:text-emerald-100">
                          Why we think this
                        </summary>
                        <div className="mt-2 rounded-2xl border border-emerald-200 bg-white p-3 text-xs text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
                          {suggestedWhy}
                        </div>
                      </details>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
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
                      onClick={() => handleConfirmYes().catch(() => null)}
                      disabled={working || !tid}
                    >
                      Yes, that’s right →
                    </button>
                  </div>

                  <button
                    type="button"
                    className="mt-3 w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                    onClick={() => handleConfirmNo().catch(() => null)}
                    disabled={working || !tid}
                  >
                    Not quite — improve match
                  </button>

                  <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    If you disagree, we’ll ask a few quick questions to lock the correct industry.
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        /* -------------------- Interview UI -------------------- */
        <>
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
                status: <span className="font-mono">{safeTrim(interviewState?.status) || "(none)"}</span>
              </div>
              <div className="mt-1">
                nextQ.id: <span className="font-mono">{nextQ?.id || "(none)"}</span>
              </div>
              <div className="mt-2 whitespace-pre-wrap break-words font-mono">
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
                      {debugOn && proposedKey ? <span className="ml-2 font-mono text-xs opacity-70">({proposedKey})</span> : null}
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
                          <span className="ml-2 font-mono opacity-70">{Math.round(c.score * 100)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                <div>
                  Confidence: <span className="font-mono">{pct(intConf)}</span>
                </div>
                <div>
                  Fit: <span className="font-mono">{pct(intFit)}</span>
                </div>
              </div>
            </div>

            {reason ? <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">{reason}</div> : null}
          </div>

          {/* Ready/Locked panel (dominant) */}
          {showReady ? (
            <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="text-base font-semibold">We’re ready.</div>
              <div className="mt-1">
                Suggested industry: <span className="font-semibold">{hypothesis}</span>{" "}
                {debugOn && proposedKey ? <span className="font-mono text-xs opacity-70">({proposedKey})</span> : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="rounded-2xl border border-emerald-200 bg-white py-3 text-sm font-semibold text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100"
                  onClick={() => {
                    if (hasWebsite) setShowInterview(false);
                    else props.onBack();
                  }}
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

              <div className="mt-3 text-xs opacity-80">Tip: enable debug with ?debug=1 if you get stuck.</div>
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
                      onClick={() => {
                        if (hasWebsite) setShowInterview(false);
                        else props.onBack();
                      }}
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
        </>
      )}
    </div>
  );
}