// src/app/onboarding/wizard/steps/Step2.tsx

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildIndustriesUrl } from "../utils";

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

/* -------------------- Helpers -------------------- */

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
    safeTrim(pick(aiAnalysis, ["businessGuess"])) ||
    safeTrim(pick(aiAnalysis, ["business_guess"]));

  const conf =
    pick(aiAnalysis, ["confidenceScore", "confidence_score"]) ??
    pick(aiAnalysis, ["industryInterview.confidenceScore"]) ??
    null;

  const confNum = Number(conf);
  const hasConf = Number.isFinite(confNum) && confNum > 0;

  return Boolean(proposedKey || proposedLabel || suggestedKey || suggestedLabel || hasConf);
}

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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

  /**
   * ✅ NEW (optional):
   * When the user confirms the suggested industry (website analysis OR interview),
   * the wizard can persist the industry and advance to the next step (Step 4).
   */
  onAcceptSuggestedIndustry?: (industryKey: string) => Promise<void>;

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

  // Debug support on mobile: add ?debug=1
  const debugOn = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("debug") === "1";
    } catch {
      return false;
    }
  }, []);

  // suggested key (canonical-ish)
  const suggestedKey =
    safeTrim(pick(props.aiAnalysis, ["industryInterview.proposedIndustry.key"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustryKey", "suggested_industry_key"])) ||
    "";

  const suggestedKeyNorm = useMemo(() => normalizeKey(suggestedKey), [suggestedKey]);

  // raw long summary often lives here (we keep it in details only)
  const rawSummary =
    safeTrim(pick(props.aiAnalysis, ["industryInterview.meta.debug.reason"])) ||
    safeTrim(pick(props.aiAnalysis, ["industryInterview.proposedIndustry.description"])) ||
    safeTrim(pick(props.aiAnalysis, ["industryInterview.proposedIndustry.label"])) ||
    safeTrim(pick(props.aiAnalysis, ["suggestedIndustryLabel", "suggestedIndustry.label"])) ||
    safeTrim(pick(props.aiAnalysis, ["businessGuess"])) ||
    safeTrim(pick(props.aiAnalysis, ["business_guess"])) ||
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

  // Auto-run analysis ONCE per (tenantId + website)
  const didAutoRunRef = useRef(false);
  const autoRunKeyRef = useRef<string>("");

  // show a "starting" state immediately when autorun triggers
  const [autoStarting, setAutoStarting] = useState(false);

  // Progress UI for running/starting
  const runStartRef = useRef<number | null>(null);
  const [runTick, setRunTick] = useState(0);

  // Industry label lookup so we can show “Roofing Contracting” instead of the key
  const [industryLabelMap, setIndustryLabelMap] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!tid) return;
    let alive = true;

    fetch(buildIndustriesUrl(tid), { method: "GET", cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (!alive) return;
        if (!j?.ok || !Array.isArray(j?.industries)) return;

        const m: Record<string, string> = {};
        for (const it of j.industries) {
          const k = normalizeKey(safeTrim(it?.key));
          const label = safeTrim(it?.label);
          if (k && label) m[k] = label;
        }
        setIndustryLabelMap(m);
      })
      .catch(() => null);

    return () => {
      alive = false;
    };
  }, [tid]);

  const canonicalIndustryLabel = useMemo(() => {
    if (!suggestedKeyNorm) return "";
    return industryLabelMap[suggestedKeyNorm] || "";
  }, [industryLabelMap, suggestedKeyNorm]);

  // What we show as the proud moment “industry”
  const displayIndustryName = useMemo(() => {
    if (canonicalIndustryLabel) return canonicalIndustryLabel;

    // fallback: if AI returned something short like "Roofing Contracting" use it
    const s = safeTrim(rawSummary);
    if (s && s.length <= 42) return s;

    // last resort: prettify key
    if (suggestedKeyNorm) return suggestedKeyNorm.replace(/_/g, " ");
    return "your industry";
  }, [canonicalIndustryLabel, rawSummary, suggestedKeyNorm]);

  const reasoningLine = useMemo(() => {
    if (!hasWebsite) return "";
    if (conf !== null && conf >= 0.85) return "High confidence based on services and keywords found on your site.";
    if (conf !== null && conf >= 0.6) return "Based on your website content, services, and keywords.";
    return "We matched your website content against known industry patterns.";
  }, [hasWebsite, conf]);

  // ✅ Set/clear start time so progress doesn't jitter during autoStarting
  useEffect(() => {
    const busy = isRunning || autoStarting;
    if (busy && !runStartRef.current) runStartRef.current = Date.now();
    if (!busy) runStartRef.current = null;
  }, [isRunning, autoStarting]);

  useEffect(() => {
    if (!(isRunning || autoStarting)) return;
    const t = window.setInterval(() => setRunTick((x) => x + 1), 300);
    return () => window.clearInterval(t);
  }, [isRunning, autoStarting]);

  const runProgress = useMemo(() => {
    const start = runStartRef.current ?? Date.now();
    const elapsed = Date.now() - start;

    // "Feels" like progress; caps at 95% until we flip to ready.
    const maxMs = 45_000;
    return Math.min(0.95, Math.max(0.06, elapsed / maxMs));
  }, [runTick]);

  const runMessage = useMemo(() => {
    const msgs = [
      "Opening your website…",
      "Reading services & keywords…",
      "Comparing signals to industry patterns…",
      "Choosing best-fit industry…",
      "Finalizing recommendation…",
    ];
    const idx = Math.min(msgs.length - 1, Math.floor(runProgress * msgs.length));
    return msgs[idx] ?? "Analyzing…";
  }, [runProgress]);

  // Reset auto-run guard when tenantId or website changes
  useEffect(() => {
    const k = `${tid || "(no-tenant)"}|${website || "(no-website)"}`;
    if (autoRunKeyRef.current !== k) {
      autoRunKeyRef.current = k;
      didAutoRunRef.current = false;
      setAutoStarting(false);
      setDetailsOpen(false);
    }
  }, [tid, website]);

  async function runAnalysisSafely(origin: "auto" | "manual") {
    if (!tid) {
      props.onError("NO_TENANT: missing tenantId for analysis.");
      return;
    }
    if (working) return;

    if (origin === "auto") setAutoStarting(true);

    setWorking(true);
    try {
      await props.onRun();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
      setAutoStarting(false);
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
      runAnalysisSafely("auto").catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWebsite, hasAnalysis, isRunning, tid]);

  /* -------------------- Interview mode (unchanged, kept as-is) -------------------- */

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
  const proposedKeyRaw = safeTrim(proposed?.key);
  const proposedKeyNorm = useMemo(() => normalizeKey(proposedKeyRaw), [proposedKeyRaw]);

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

  const showReady = showInterview && isLocked && Boolean(proposedKeyNorm);

  /* -------------------- Confirm handlers (key fix) -------------------- */

  async function acceptIndustryAndAdvance(industryKeyNorm: string) {
    const k = safeTrim(industryKeyNorm);
    if (!k) throw new Error("Missing industry recommendation. Please run the interview again.");

    if (props.onAcceptSuggestedIndustry) {
      await props.onAcceptSuggestedIndustry(k);
      // Wizard may already navigate; keep onNext as harmless fallback.
      return;
    }

    // Fallback (old behavior): just proceed
    props.onNext();
  }

  async function handleConfirmYes() {
    setWorking(true);
    try {
      await props.onConfirm({ answer: "yes" });

      // ✅ If we have a suggested key, persist+advance through the wizard hook.
      if (suggestedKeyNorm) {
        await acceptIndustryAndAdvance(suggestedKeyNorm);
      } else {
        // If no key present, still move forward.
        props.onNext();
      }
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

  async function handleInterviewAccept() {
    setWorking(true);
    try {
      // ✅ For the no-website path, accept the interview's proposed key.
      await acceptIndustryAndAdvance(proposedKeyNorm);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      props.onError(msg);
    } finally {
      setWorking(false);
    }
  }

  const showBusy = (isRunning || autoStarting) && !hasAnalysis;

  return (
    <div>
      {/* Website analysis */}
      {hasWebsite && !showInterview ? (
        <>
          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Website analysis</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            We’ll analyze your website to recommend the best-fit industry — then you can confirm or correct it.
          </div>

          <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">WEBSITE</div>
                <div className="mt-1 truncate text-sm font-mono text-gray-800 dark:text-gray-200">
                  {website.replace(/^https?:\/\//, "")}
                </div>
              </div>

              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold",
                  showBusy
                    ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-black dark:text-slate-200"
                    : hasAnalysis
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                )}
              >
                {showBusy ? "Analyzing…" : hasAnalysis ? "Analysis ready" : "Not analyzed yet"}
              </span>
            </div>

            {aiErr ? (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {aiErr}
              </div>
            ) : null}

            {/* Busy state */}
            {showBusy ? (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full bg-emerald-600 transition-[width] duration-300"
                    style={{ width: `${Math.round(runProgress * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{runMessage}</div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  You don’t need to press anything — we’ll advance when it’s ready.
                </div>
              </div>
            ) : null}

            {/* Not analyzed yet */}
            {!hasAnalysis && !showBusy ? (
              <div className="mt-4">
                <button
                  type="button"
                  className="w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => runAnalysisSafely("manual").catch(() => null)}
                  disabled={working || isRunning || !tid}
                >
                  Run analysis
                </button>

                <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">What we look for</div>
                  <ul className="mt-2 grid gap-2 text-sm">
                    <li className="flex gap-2">
                      <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] font-bold dark:border-gray-800 dark:bg-gray-950">
                        1
                      </span>
                      <span>
                        <span className="font-semibold">Services & keywords</span> — what you sell and how you describe it.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] font-bold dark:border-gray-800 dark:bg-gray-950">
                        2
                      </span>
                      <span>
                        <span className="font-semibold">Industry signals</span> — patterns that match your business type.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] font-bold dark:border-gray-800 dark:bg-gray-950">
                        3
                      </span>
                      <span>
                        <span className="font-semibold">A recommended setup</span> — so your defaults feel right from day one.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            ) : null}

            {/* Analysis ready */}
            {hasAnalysis && !showBusy ? (
              <div className="mt-4">
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                  <div className="text-[11px] font-semibold tracking-wide opacity-80">RECOMMENDED INDUSTRY</div>

                  <div className="mt-2 text-2xl font-extrabold leading-tight">{displayIndustryName}</div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold dark:border-emerald-900/40 dark:bg-black">
                      Confidence: <span className="ml-2 font-mono">{pct(conf)}</span>
                    </span>
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold dark:border-emerald-900/40 dark:bg-black">
                      Fit: <span className="ml-2 font-mono">{pct(fit)}</span>
                    </span>
                  </div>

                  <div className="mt-3 text-sm opacity-90">{reasoningLine}</div>

                  <button
                    type="button"
                    className="mt-4 inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-50 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100 dark:hover:bg-emerald-950/20"
                    onClick={() => setDetailsOpen((v) => !v)}
                  >
                    {detailsOpen ? "Hide details" : "Show details"}
                  </button>

                  {detailsOpen ? (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
                      <div className="text-xs font-semibold opacity-80">Why we think this</div>

                      <div className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-950/90 dark:text-emerald-100/90">
                        {rawSummary ? rawSummary : "No additional details were provided by the analyzer."}
                      </div>

                      {debugOn && suggestedKeyNorm ? (
                        <div className="mt-3 text-[11px] opacity-70">
                          Internal key: <span className="font-mono">{suggestedKeyNorm}</span>
                        </div>
                      ) : null}
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
              </div>
            ) : null}
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
                status: <span className="font-mono">{safeTrim(status) || "(none)"}</span>
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
                      {proposedKeyRaw ? <span className="ml-2 font-mono text-xs opacity-70">({proposedKeyRaw})</span> : null}
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
                {proposedKeyRaw ? <span className="font-mono text-xs opacity-70">({proposedKeyRaw})</span> : null}
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
                  className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => handleInterviewAccept().catch(() => null)}
                  disabled={working || !tid || !proposedKeyNorm}
                >
                  Use this & continue →
                </button>
              </div>

              <div className="mt-3 text-xs opacity-80">Tip: enable debug with ?debug=1 if you get stuck.</div>
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