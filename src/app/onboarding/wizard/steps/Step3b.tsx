// src/app/onboarding/wizard/steps/Step3b.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(raw: any) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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

type Candidate = { key?: string; label: string; score: number };

type SubInterview = {
  mode: "SUB";
  status: "collecting" | "locked";
  round: number;

  industryKey: string;
  confidenceScore: number;

  // ✅ server may include key now (optional for back-compat)
  proposedSubIndustryKey?: string | null;
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
  let j: any = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    j = null;
  }

  if (!res.ok || !j?.ok) {
    throw new Error(j?.message || j?.error || (txt ? txt : `HTTP ${res.status}`));
  }
  return j as { ok: true; tenantId: string; subIndustryInterview: SubInterview };
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/**
 * Step3 can set sessionStorage "apq_onboarding_sub_intent":
 *  - "refine"  -> auto select Yes and auto-start interview
 *  - "skip"    -> auto select No and auto-continue
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

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-200",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function Step3b(props: {
  tenantId: string | null;
  industryKey: string;
  aiAnalysis: any | null | undefined;

  onBack: () => void; // back to Step3 (industry confirm)
  onSkip: () => void; // legacy prop (not used here, kept for compatibility)

  onSubmit: (args: { subIndustryLabel: string | null }) => Promise<void>;
  onError: (m: string) => void;
}) {
  const tid = safeTrim(props.tenantId);

  /**
   * ✅ CRITICAL:
   * If the wizard ever hands us an empty/placeholder industryKey (or a stale "service"),
   * fall back to AI-proposed keys so we never start/submit against the wrong industry.
   */
  const resolvedIndustryKey = useMemo(() => {
    const fromProps = normalizeKey(props.industryKey);
    const fromAiInterview = normalizeKey(props.aiAnalysis?.industryInterview?.proposedIndustry?.key);
    const fromAiSuggested = normalizeKey(props.aiAnalysis?.suggestedIndustryKey);
    const pick = fromProps && fromProps !== "service" ? fromProps : fromAiInterview || fromAiSuggested || fromProps;
    return pick;
  }, [props.industryKey, props.aiAnalysis]);

  const existingFromAi: SubInterview | null = useMemo(() => {
    const x = props.aiAnalysis?.subIndustryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "SUB") return null;

    // Only accept if it matches our resolved industry (prevents cross-industry bleed)
    const ik = normalizeKey((x as any).industryKey);
    if (ik && resolvedIndustryKey && ik !== normalizeKey(resolvedIndustryKey)) return null;

    return x as SubInterview;
  }, [props.aiAnalysis, resolvedIndustryKey]);

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
  const isLocked = status === "locked";
  const nextQ = (state?.nextQuestion ?? null) as NextQuestion | null;

  const conf = clamp01(state?.confidenceScore);
  const proposed = safeTrim(state?.proposedSubIndustryLabel) || "";

  const candidates: Candidate[] = Array.isArray(state?.candidates)
    ? state!.candidates
        .map((c: any) => ({
          key: safeTrim(c?.key) || undefined,
          label: safeTrim(c?.label),
          score: clamp01(c?.score),
        }))
        .filter((c) => c.label)
        .slice(0, 5)
    : [];

  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const debugOn = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("debug") === "1";
    } catch {
      return false;
    }
  }, []);

  const [lastApi, setLastApi] = useState<any>(null);

  // null => haven't answered prompt yet
  const [wantsSub, setWantsSub] = useState<"yes" | "no" | null>(null);

  // ✅ "Skipping…" UX while we auto-continue after a "No"
  const [skipInFlight, setSkipInFlight] = useState(false);

  const [textAnswer, setTextAnswer] = useState("");
  const [choiceAnswer, setChoiceAnswer] = useState<string>("");

  const lastSubmitRef = useRef<string>("");
  const didHydrateIntentRef = useRef(false);
  const intentRef = useRef<"refine" | "skip" | "unknown">("unknown");
  const didAutoSkipRef = useRef(false);

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
    if (!resolvedIndustryKey) {
      const msg = "Missing industryKey. Go back and re-confirm your industry.";
      setErr(msg);
      props.onError(msg);
      return;
    }
    if (nextQ?.id || isLocked) return;

    setWorking(true);
    setErr(null);
    try {
      // ✅ Server decides:
      // - if defaults exist => returns select question
      // - else => opens LLM interview
      const out = await postSubInterview({ mode: "SUB", tenantId: tid, industryKey: resolvedIndustryKey, action: "start" });
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

  // Hydrate intent from Step3 exactly once
  useEffect(() => {
    if (didHydrateIntentRef.current) return;
    didHydrateIntentRef.current = true;

    const intent = readAndClearSubIntent();
    intentRef.current = intent;

    if (intent === "refine") setWantsSub("yes");
    if (intent === "skip") setWantsSub("no");
  }, []);

  // ✅ Auto-skip when intent === skip and wantsSub is "no"
  useEffect(() => {
    if (intentRef.current !== "skip") return;
    if (wantsSub !== "no") return;
    if (!tid || !resolvedIndustryKey) return;
    if (nextQ?.id || isLocked) return;
    if (didAutoSkipRef.current) return;

    didAutoSkipRef.current = true;
    setSkipInFlight(true);
    saveAndContinue(null)
      .catch(() => null)
      .finally(() => setSkipInFlight(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, resolvedIndustryKey, wantsSub, nextQ?.id, isLocked]);

  // Auto-start when wantsSub yes
  useEffect(() => {
    if (wantsSub !== "yes") return;
    if (!tid || !resolvedIndustryKey) return;
    if (isLocked) return;
    if (nextQ?.id) return;
    start().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsSub, tid, resolvedIndustryKey, isLocked, nextQ?.id]);

  function buildAnswerPayload(): string {
    if (!nextQ) return "";
    if (nextQ.inputType === "select") return safeTrim(choiceAnswer);
    return safeTrim(textAnswer);
  }

  async function submitAnswer() {
    if (!tid) return setErr("Missing tenantId.");
    if (!resolvedIndustryKey) return setErr("Missing industryKey.");
    if (!nextQ?.id) return setErr("No active question yet.");
    if (isLocked) return;

    const ans = buildAnswerPayload();
    if (!ans) return setErr("Please answer the question to continue.");

    const dupeKey = `${tid}:${nextQ.id}:${ans}`;
    if (lastSubmitRef.current === dupeKey) return;
    lastSubmitRef.current = dupeKey;

    setWorking(true);
    setErr(null);

    try {
      const out = await postSubInterview({
        mode: "SUB",
        tenantId: tid,
        industryKey: resolvedIndustryKey,
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

  const showPrompt = wantsSub === null;

  // ✅ If user manually chooses "no", behave like skip:
  // show a quick "Skipping…" state and auto-continue.
  async function chooseNoAndSkip() {
    if (working || skipInFlight) return;

    setWantsSub("no");
    intentRef.current = "skip";
    didAutoSkipRef.current = true; // prevent duplicate autoskip effect

    setSkipInFlight(true);
    try {
      await saveAndContinue(null);
    } finally {
      setSkipInFlight(false);
    }
  }

  const showSkippingCard = wantsSub === "no" && (skipInFlight || working);

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
            industryKey (props): <span className="font-mono">{normalizeKey(props.industryKey) || "(none)"}</span>
          </div>
          <div className="mt-1">
            industryKey (resolved): <span className="font-mono">{resolvedIndustryKey || "(none)"}</span>
          </div>
          <div className="mt-1">
            intent: <span className="font-mono">{intentRef.current}</span>
          </div>
          <div className="mt-1">
            wantsSub: <span className="font-mono">{wantsSub ?? "(null)"}</span>
          </div>
          <div className="mt-1">
            status: <span className="font-mono">{status}</span>
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

      {/* ✅ Skipping state (prevents "blank screen" during auto-continue) */}
      {showSkippingCard ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center gap-3">
            <Spinner />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Skipping sub-industry refinement…</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Taking you to the next step.</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Prompt */}
      {showPrompt ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Would a sub-industry be useful?</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Example: “Exterior-only”, “Cabinet refinishing”, “Commercial interiors”, “New construction”, etc.
          </div>

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              className={cn(
                "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold",
                "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
              )}
              onClick={() => setWantsSub("yes")}
              // ✅ Disable both choice buttons while submitting
              disabled={working || skipInFlight || !tid || !resolvedIndustryKey}
            >
              Yes — let’s narrow it down
            </button>

            <button
              type="button"
              className={cn(
                "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold",
                "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
              )}
              onClick={() => chooseNoAndSkip().catch(() => null)}
              // ✅ Disable both choice buttons while submitting
              disabled={working || skipInFlight || !tid || !resolvedIndustryKey}
            >
              {skipInFlight ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-4 w-4" />
                  Skipping…
                </span>
              ) : (
                "No — keep it broad for now"
              )}
            </button>
          </div>

          {/* ✅ Only navigation here. Back ALWAYS calls onBack. */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              onClick={props.onBack}
              disabled={working || skipInFlight}
            >
              Back
            </button>

            {/* Optional affordance: if they didn’t choose, treat as "No" and skip */}
            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={() => chooseNoAndSkip().catch(() => null)}
              disabled={working || skipInFlight || !tid || !resolvedIndustryKey}
              title="Skip sub-industry refinement"
            >
              {skipInFlight ? "Skipping…" : "Continue →"}
            </button>
          </div>
        </div>
      ) : null}

      {/* YES path */}
      {wantsSub === "yes" ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sub-industry interview</div>

            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={() => start().catch(() => null)}
              disabled={working || !tid || !resolvedIndustryKey || Boolean(nextQ?.id) || isLocked}
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
                          key={`${c.key || c.label}:${i}`}
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
                  className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
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
          ) : null}

          {!isLocked && nextQ ? (
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
                    disabled={working}
                  />
                ) : null}

                {nextQ.inputType === "select" ? (
                  <div className="grid gap-2">
                    {(nextQ.options ?? []).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold disabled:opacity-50",
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
                  className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  onClick={props.onBack}
                  disabled={working}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  onClick={() => submitAnswer().catch(() => null)}
                  disabled={working || !tid || !resolvedIndustryKey || !nextQ?.id}
                >
                  {working ? "Thinking…" : "Continue →"}
                </button>
              </div>

              <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                If you’d rather skip this, hit Back and choose “keep it broad”.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}