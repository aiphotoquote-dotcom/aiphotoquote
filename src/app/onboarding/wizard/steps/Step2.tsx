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

/**
 * IMPORTANT:
 * - For display, we only want a *label* (e.g. "Roofing Contracting").
 * - Avoid pulling giant narrative fields like businessGuess.
 */
function getIndustryLabelForDisplay(aiAnalysis: any): string {
  return (
    safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.label"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustryLabel"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustry.label"])) ||
    ""
  );
}

function getIndustryKeyForDisplay(aiAnalysis: any): string {
  return (
    safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.key"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustryKey", "suggested_industry_key"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustry.key"])) ||
    ""
  );
}

function hasMeaningfulAnalysis(aiAnalysis: any): boolean {
  if (!aiAnalysis || typeof aiAnalysis !== "object") return false;

  const proposedKey = safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.key"]));
  const proposedLabel = safeTrim(pick(aiAnalysis, ["industryInterview.proposedIndustry.label"]));

  const suggestedKey =
    safeTrim(pick(aiAnalysis, ["suggestedIndustryKey", "suggested_industry_key"])) ||
    safeTrim(pick(aiAnalysis, ["suggestedIndustry.key"]));

  const suggestedLabel =
    safeTrim(pick(aiAnalysis, ["suggestedIndustryLabel"])) || safeTrim(pick(aiAnalysis, ["suggestedIndustry.label"]));

  const conf =
    pick(aiAnalysis, ["confidenceScore", "confidence_score"]) ??
    pick(aiAnalysis, ["industryInterview.confidenceScore"]) ??
    null;

  const confNum = Number(conf);
  const hasConf = Number.isFinite(confNum) && confNum > 0;

  return Boolean(proposedKey || proposedLabel || suggestedKey || suggestedLabel || hasConf);
}

/* -------------------- Component -------------------- */

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

  // local “starting analysis…” so the UI doesn’t flash “Run analysis now”
  const [localStarting, setLocalStarting] = useState(false);

  // Only “ready” if it’s meaningful AND there’s no parse/error flag.
  const hasAnalysis = useMemo(() => {
    if (aiErr) return false;
    return hasMeaningfulAnalysis(props.aiAnalysis);
  }, [props.aiAnalysis, aiErr]);

  const suggestedLabel = useMemo(() => getIndustryLabelForDisplay(props.aiAnalysis), [props.aiAnalysis]);
  const suggestedKey = useMemo(() => getIndustryKeyForDisplay(props.aiAnalysis), [props.aiAnalysis]);

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

  // “Details” toggle (hide keys + long stuff by default)
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // clear “starting” once server reports running, or we become ready, or we error
    if (localStarting && (isRunning || hasAnalysis || Boolean(aiErr))) {
      setLocalStarting(false);
    }
  }, [localStarting, isRunning, hasAnalysis, aiErr]);

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
    if (!isRunning && !localStarting) return 0;
    const start = runStartRef.current ?? Date.now();
    const elapsed = Date.now() - start;

    // “Feels like progress”; cap at 95% until completion
    const maxMs = 45_000;
    const p = Math.min(0.95, Math.max(0.08, elapsed / maxMs));
    return p;
  }, [isRunning, localStarting, runTick]);

  const runMessage = useMemo(() => {
    if (!isRunning && !localStarting) return "";
    const msgs = [
      "Starting analysis…",
      "Fetching website content…",
      "Extracting services & keywords…",
      "Matching against industry patterns…",
      "Generating your recommended setup…",
      "Finalizing…",
    ];
    const idx = Math.min(msgs.length - 1, Math.floor(runProgress * msgs.length));
    return msgs[idx] ?? "Analyzing…";
  }, [isRunning, localStarting, runProgress]);

  // Reset auto-run guard whenever tenantId or website changes
  useEffect(() => {
    const k = `${tid || "(no-tenant)"}|${website || "(no-website)"}`;
    if (autoRunKeyRef.current !== k) {
      autoRunKeyRef.current = k;
      didAutoRunRef.current = false;
      setShowDetails(false);
    }
  }, [tid, website]);

  async function runAnalysisSafely() {
    if (!tid) {
      props.onError("NO_TENANT: missing tenantId for analysis.");
      return;
    }
    if (working || isRunning) return;

    setWorking(true);
    setLocalStarting(true);

    try {
      await props.onRun();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
      setLocalStarting(false);
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

    // If analysis exists or is currently running/starting, do nothing.
    if (hasAnalysis) return;
    if (isRunning) return;
    if (localStarting) return;

    // Auto-run once per tenant+website (only if we have tenantId).
    if (!didAutoRunRef.current && tid) {
      didAutoRunRef.current = true;
      runAnalysisSafely().catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWebsite, hasAnalysis, isRunning, tid, localStarting]);

  /* -------------------- Interview state -------------------- */

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

  const showProgress = Boolean(hasWebsite && !showInterview && (isRunning || localStarting) && !hasAnalysis);

  return (
    <div>
      {/* Website Analysis */}
      {hasWebsite && !showInterview ? (
        <>
          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Website analysis</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            We’ll analyze your website and recommend the best-fit industry setup — then you can confirm or correct it.
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
            {/* header strip */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-gray-900">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">WEBSITE</div>
                <div className="mt-1 truncate font-mono text-xs text-gray-800 dark:text-gray-200">{website}</div>
              </div>

              <span
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold",
                  aiErr
                    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
                    : showProgress
                    ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-black dark:text-slate-200"
                    : hasAnalysis
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                )}
              >
                {aiErr ? safeTrim(aiErr) || "Analysis error" : showProgress ? "Analyzing" : hasAnalysis ? "Ready" : "Waiting"}
              </span>
            </div>

            {/* progress */}
            {showProgress ? (
              <div className="px-4 py-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div className="h-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${Math.round(runProgress * 100)}%` }} />
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{runMessage}</div>

                <div className="mt-4 grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">What we’re looking for</div>
                  <div className="grid gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <div>• Services & keywords</div>
                    <div>• Industry signals & patterns</div>
                    <div>• A recommended setup for your prompts & defaults</div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* error state */}
            {aiErr ? (
              <div className="px-4 pb-4">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  We couldn’t reliably convert the website result into structured data.
                  <div className="mt-2 text-xs opacity-80">You can retry, or switch to a quick interview to lock the right industry.</div>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    className="w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                    onClick={() => runAnalysisSafely().catch(() => null)}
                    disabled={working || isRunning || !tid}
                  >
                    Retry analysis
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                    onClick={() => setShowInterview(true)}
                    disabled={working}
                  >
                    Use quick questions instead
                  </button>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-gray-600 underline underline-offset-4 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                    onClick={() => setShowDetails((v) => !v)}
                  >
                    {showDetails ? "Hide details" : "Show details"}
                  </button>

                  {showDetails ? (
                    <pre className="mt-2 max-h-56 overflow-auto rounded-2xl border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                      {JSON.stringify(props.aiAnalysis, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ready state */}
            {!aiErr && hasAnalysis ? (
              <div className="px-4 py-5">
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                  <div className="text-[11px] font-semibold tracking-wide opacity-80">RECOMMENDED INDUSTRY</div>

                  <div className="mt-2 text-3xl font-extrabold leading-tight">
                    {suggestedLabel ? suggestedLabel : "Industry suggestion ready"}
                  </div>

                  <div className="mt-2 text-sm opacity-90">Based on your website content, services, and keywords.</div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
                      Confidence: {pct(conf)}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
                      Fit: {pct(fit)}
                    </span>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className="text-xs font-semibold underline underline-offset-4 opacity-80 hover:opacity-100"
                      onClick={() => setShowDetails((v) => !v)}
                    >
                      {showDetails ? "Hide details" : "Show details"}
                    </button>

                    {showDetails ? (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-3 text-xs text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
                        {suggestedKey ? (
                          <div>
                            Internal key: <span className="font-mono opacity-80">{suggestedKey}</span>
                          </div>
                        ) : null}
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-emerald-50 p-3 text-[11px] text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100">
                          {JSON.stringify(props.aiAnalysis, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
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
                    onClick={() => handleConfirmYes().catch(() => null)}
                    disabled={working || !tid}
                  >
                    Yes, lock it in →
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
              </div>
            ) : null}

            {/* initial idle state (no analysis, no error, not running/starting) */}
            {!aiErr && !hasAnalysis && !showProgress ? (
              <div className="px-4 py-5">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">We’ll start automatically</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    If this doesn’t begin in a few seconds, you can manually kick it off.
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className="w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                      onClick={() => runAnalysisSafely().catch(() => null)}
                      disabled={working || isRunning || !tid}
                    >
                      Start analysis
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-start">
                  <button
                    type="button"
                    className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                    onClick={props.onBack}
                    disabled={working}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        /* -------------------- Interview UI (unchanged) -------------------- */
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
            </div>
          ) : null}

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