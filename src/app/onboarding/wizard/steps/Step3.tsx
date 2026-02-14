// src/app/onboarding/wizard/steps/Step3.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { IndustriesResponse, IndustryItem } from "../types";
import { buildIndustriesUrl } from "../utils";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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

function clamp01Nullable(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.max(0, Math.min(100, Math.round(n * 100)))}%`;
}

type ModeA_Interview = {
  mode: "A";
  status: "collecting" | "locked";
  round: number;
  confidenceScore: number;
  fitScore: number;
  proposedIndustry: { key: string; label: string } | null;
  candidates: Array<{ key: string; label: string; score: number; exists?: boolean }>;
  answers?: Array<{ id: string; question: string; answer: string; createdAt: string }>;
  meta?: any;
};

/**
 * Step3 -> Step3b intent (no server coupling).
 * Step3b reads and clears this.
 */
function setSubIntent(v: "refine" | "skip" | "unknown") {
  try {
    window.sessionStorage.setItem("apq_onboarding_sub_intent", v);
  } catch {
    // ignore
  }
}

function mapFitToScore(fit: string): number | null {
  const f = safeTrim(fit).toLowerCase();
  if (!f) return null;
  if (f === "good") return 0.85;
  if (f === "maybe") return 0.6;
  if (f === "poor") return 0.35;
  return null;
}

export function Step3(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;

  // wizard-provided saved industry key (preferred)
  currentIndustryKey?: string | null;

  onBack: () => void;
  onReInterview: () => void;

  // Step3 commits industry selection only; wizard proceeds to Step3b next.
  onSubmit: (args: { industryKey: string }) => Promise<void>;
}) {
  const tid = safeTrim(props.tenantId);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);

  // ----------------------------
  // Mode A interview (if present)
  // ----------------------------
  const interview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  const interviewProposedKeyRaw = safeTrim(interview?.proposedIndustry?.key);
  const interviewProposedKey = useMemo(() => normalizeKey(interviewProposedKeyRaw), [interviewProposedKeyRaw]);
  const interviewProposedLabel = safeTrim(interview?.proposedIndustry?.label);

  const interviewConf = clamp01Nullable(interview?.confidenceScore);
  const interviewFit = clamp01Nullable(interview?.fitScore);
  const interviewDebugReason = safeTrim(interview?.meta?.debug?.reason);

  // ----------------------------
  // Website analysis shape (fallback)
  // ----------------------------
  const websiteSuggestedKey = useMemo(() => {
    // support a few common names just in case
    const a = props.aiAnalysis ?? {};
    return (
      normalizeKey(a?.suggestedIndustryKey) ||
      normalizeKey(a?.suggested_industry_key) ||
      normalizeKey(a?.industryKey) ||
      ""
    );
  }, [props.aiAnalysis]);

  const websiteConf = useMemo(() => clamp01Nullable((props.aiAnalysis as any)?.confidenceScore), [props.aiAnalysis]);
  const websiteFit = useMemo(() => mapFitToScore(safeTrim((props.aiAnalysis as any)?.fit)), [props.aiAnalysis]);
  const websiteFitReason = useMemo(() => safeTrim((props.aiAnalysis as any)?.fitReason), [props.aiAnalysis]);

  // wizard-provided currentIndustryKey is the most reliable fallback because it may come from tenant_settings
  const wizardKey = useMemo(() => normalizeKey(props.currentIndustryKey), [props.currentIndustryKey]);

  // ----------------------------
  // Unified “recommended” view
  // Prefer interview, then wizardKey, then website suggested key.
  // ----------------------------
  const recommendedKey = useMemo(() => {
    return interviewProposedKey || wizardKey || websiteSuggestedKey || "";
  }, [interviewProposedKey, wizardKey, websiteSuggestedKey]);

  const conf = useMemo(() => {
    // prefer interview confidence; otherwise website confidence
    return interviewConf !== null ? interviewConf : websiteConf;
  }, [interviewConf, websiteConf]);

  const fit = useMemo(() => {
    // prefer interview fitScore; otherwise map website fit
    return interviewFit !== null ? interviewFit : websiteFit;
  }, [interviewFit, websiteFit]);

  // Map industryKey -> label so we can show canonical labels
  const industryLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) {
      const k = normalizeKey(it?.key);
      const label = safeTrim(it?.label);
      if (k && label) m[k] = label;
    }
    return m;
  }, [items]);

  const displayIndustryName = useMemo(() => {
    const canonical = recommendedKey ? industryLabelMap[recommendedKey] : "";
    if (canonical) return canonical;

    // interview label if present
    if (interviewProposedLabel && interviewProposedLabel.length <= 42) return interviewProposedLabel;

    // last fallback: render the key nicely
    if (recommendedKey) return recommendedKey.replace(/_/g, " ");
    return "your industry";
  }, [industryLabelMap, recommendedKey, interviewProposedLabel]);

  const reasoningLine = useMemo(() => {
    if (interviewConf !== null) {
      if (interviewConf >= 0.85) return "High confidence based on your answers and detected signals.";
      if (interviewConf >= 0.6) return "Based on your answers and detected signals.";
      return "We matched your inputs against known industry patterns.";
    }

    // website analysis phrasing
    if (websiteConf !== null && websiteConf >= 0.85) return "High confidence based on signals found on your site.";
    if (websiteConf !== null && websiteConf >= 0.6) return "Based on signals found on your site.";
    return "We matched your website content against known industry patterns.";
  }, [interviewConf, websiteConf]);

  const detailsText = useMemo(() => {
    // prefer interview debug, otherwise website fitReason
    return interviewDebugReason || websiteFitReason || interviewProposedLabel || "No additional details were provided.";
  }, [interviewDebugReason, websiteFitReason, interviewProposedLabel]);

  const isReady = useMemo(() => {
    // ✅ FIX: Ready if we have ANY usable key (interview OR wizard OR website).
    return Boolean(recommendedKey);
  }, [recommendedKey]);

  async function loadIndustries() {
    setErr(null);
    setLoading(true);
    try {
      if (!tid) throw new Error("NO_TENANT: missing tenantId for industries load.");

      const res = await fetch(buildIndustriesUrl(tid), { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as IndustriesResponse | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      const list = Array.isArray(j.industries) ? j.industries : [];
      setItems(list);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIndustries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  async function commitIndustry(industryKey: string, intent: "refine" | "skip" | "unknown") {
    const k = normalizeKey(industryKey);
    if (!k) throw new Error("Choose an industry.");
    setSubIntent(intent);
    await props.onSubmit({ industryKey: k });
  }

  async function handleConfirmYes() {
    setSaving(true);
    setErr(null);
    try {
      const keyToUse = recommendedKey;
      if (!keyToUse) throw new Error("Missing industry. Please run the interview again.");
      await commitIndustry(keyToUse, "unknown");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This locks in your default prompts, customer questions, and photo requests.
      </div>

      {err ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {isReady ? (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="text-[11px] font-semibold tracking-wide opacity-80">RECOMMENDED</div>

          <div className="mt-2 text-3xl font-extrabold leading-tight">{displayIndustryName}</div>

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
            disabled={saving}
          >
            {detailsOpen ? "Hide details" : "Show details"}
          </button>

          {detailsOpen ? (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100">
              <div className="text-xs font-semibold opacity-80">Why we think this</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-950/90 dark:text-emerald-100/90">
                {detailsText}
              </div>

              {recommendedKey ? (
                <div className="mt-3 text-[11px] opacity-70">
                  Internal key: <span className="font-mono">{recommendedKey}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              onClick={props.onBack}
              disabled={saving}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={() => handleConfirmYes().catch(() => null)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Yes, that’s right →"}
            </button>
          </div>

          <button
            type="button"
            className="mt-3 w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            onClick={props.onReInterview}
            disabled={saving}
          >
            Not quite — improve match
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          {loading ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">Loading…</div>
          ) : (
            <>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">We need one quick step.</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                We don’t have an industry recommendation yet. Let’s run the industry interview to lock it in.
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  onClick={props.onBack}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="rounded-2xl bg-black py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
                  onClick={props.onReInterview}
                >
                  Start interview →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}