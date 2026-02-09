"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { IndustriesResponse, IndustryItem } from "../types";
import { buildIndustriesUrl } from "../utils";

type IndustryDefaults = {
  industryKey: string;
  subIndustries: Array<{ key: string; label: string; blurb?: string | null }>;
  commonServices: string[];
  commonPhotoRequests: string[];
  defaultCustomerQuestions: string[];
};

type Candidate = { key: string; label?: string; score?: number };

type ModeA_Interview = {
  mode: "A";
  status: "collecting" | "locked";
  round: number;
  confidenceScore: number;
  fitScore: number;
  proposedIndustry: {
    key: string;
    label: string;
    description?: string | null;
    exists: boolean;
    shouldCreate: boolean;
  } | null;
  candidates: Array<{ key: string; label: string; score: number; exists?: boolean }>;
  nextQuestion: any | null;
  answers: Array<any>;
  meta?: any;
};

async function fetchIndustryDefaults(args: { tenantId: string; industryKey: string }): Promise<IndustryDefaults | null> {
  const qs = new URLSearchParams({ tenantId: args.tenantId, industryKey: args.industryKey });
  const res = await fetch(`/api/onboarding/industry-defaults?${qs.toString()}`, { method: "GET", cache: "no-store" });

  if (res.status === 404 || res.status === 405) return null;

  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) return null;
  return (j.defaults ?? null) as IndustryDefaults | null;
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(n: number) {
  return Math.max(0, Math.min(100, Math.round(n * 100)));
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

export function Step3(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;

  onBack: () => void;
  onReInterview: () => void;

  // Step3 commits industry selection only.
  // If refineSubIndustry is true, Wizard routes to Step3b.
  onSubmit: (args: { industryKey: string; refineSubIndustry?: boolean }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [defaults, setDefaults] = useState<IndustryDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  const [showDisagree, setShowDisagree] = useState(false);

  // Mode A interview (preferred)
  const interview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  // Legacy fallback (defensive)
  const legacyInference = useMemo(() => props.aiAnalysis?.industryInference ?? null, [props.aiAnalysis]);

  const usingModeA = Boolean(interview);
  const isLocked = usingModeA && safeTrim(interview?.status) === "locked";

  const suggestedKey = useMemo(() => {
    if (usingModeA) return normalizeKey(interview?.proposedIndustry?.key ?? "");
    const k =
      safeTrim(legacyInference?.suggestedIndustryKey) ||
      safeTrim(props.aiAnalysis?.suggestedIndustryKey) ||
      safeTrim(props.aiAnalysis?.industryInference?.suggestedIndustryKey);
    return normalizeKey(k);
  }, [usingModeA, interview?.proposedIndustry?.key, legacyInference, props.aiAnalysis]);

  const suggestedConfidence = useMemo(() => {
    if (usingModeA) return toNum(interview?.confidenceScore, 0);
    const raw =
      legacyInference?.confidenceScore !== null && legacyInference?.confidenceScore !== undefined
        ? legacyInference?.confidenceScore
        : props.aiAnalysis?.confidenceScore;
    return raw !== null && raw !== undefined ? toNum(raw, 0) : null;
  }, [usingModeA, interview?.confidenceScore, legacyInference, props.aiAnalysis]);

  const fitScore = useMemo(() => (usingModeA ? toNum(interview?.fitScore, 0) : null), [usingModeA, interview?.fitScore]);

  const aiStatus = useMemo(() => safeTrim(interview?.status) || safeTrim(legacyInference?.status) || "", [interview, legacyInference]);

  const debugReason = useMemo(() => {
    return (
      safeTrim(interview?.meta?.debug?.reason) ||
      safeTrim(legacyInference?.meta?.debug?.reason) ||
      safeTrim(props.aiAnalysis?.meta?.debug?.reason) ||
      ""
    );
  }, [interview, legacyInference, props.aiAnalysis]);

  const candidates: Candidate[] = useMemo(() => {
    if (usingModeA && Array.isArray(interview?.candidates)) return interview!.candidates;
    if (Array.isArray(legacyInference?.candidates)) return legacyInference.candidates;
    if (Array.isArray(props.aiAnalysis?.candidates)) return props.aiAnalysis.candidates;
    return [];
  }, [usingModeA, interview?.candidates, legacyInference, props.aiAnalysis]);

  const topCandidates = useMemo(() => {
    return candidates.slice(0, 10).map((c: any) => ({
      key: normalizeKey(safeTrim(c?.key ?? "")),
      label: safeTrim(c?.label ?? ""),
      score: toNum(c?.score, 0),
    }));
  }, [candidates]);

  const selectedLabel = useMemo(() => items.find((x) => x.key === selectedKey)?.label ?? "", [items, selectedKey]);

  const suggestedLabel = useMemo(() => {
    if (!suggestedKey) return "";
    return items.find((x) => x.key === suggestedKey)?.label ?? "";
  }, [items, suggestedKey]);

  const hasAnyAiSignal = useMemo(() => {
    const hasCandidates = topCandidates.some((c) => Boolean(c.key));
    const hasModeAStats = usingModeA && (Boolean(aiStatus) || Number.isFinite(suggestedConfidence as any) || Number.isFinite(fitScore as any));
    return Boolean(suggestedKey) || hasCandidates || hasModeAStats;
  }, [topCandidates, usingModeA, aiStatus, suggestedConfidence, fitScore, suggestedKey]);

  const showAiCard = hasAnyAiSignal;
  const showNeedSignal = !hasAnyAiSignal;

  async function loadIndustries() {
    setErr(null);
    setLoading(true);
    try {
      const tid = safeTrim(props.tenantId);
      if (!tid) throw new Error("NO_TENANT: missing tenantId for industries load.");

      const res = await fetch(buildIndustriesUrl(tid), { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as IndustriesResponse | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      const list = Array.isArray(j.industries) ? j.industries : [];
      setItems(list);

      const serverSel = normalizeKey(safeTrim(j.selectedKey));
      const hasSuggested = Boolean(suggestedKey) && list.some((x) => x.key === suggestedKey);

      const next =
        (hasSuggested ? suggestedKey : "") ||
        (serverSel && list.some((x) => x.key === serverSel) ? serverSel : "") ||
        (list[0]?.key ?? "");

      setSelectedKey(next);
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

  // If interview arrives after industries load, adopt suggestion
  useEffect(() => {
    if (!items.length) return;
    if (!suggestedKey) return;
    if (!items.some((x) => x.key === suggestedKey)) return;

    const cur = normalizeKey(safeTrim(selectedKey));
    const isGeneric = !cur || cur === "service";

    if (isLocked && (isGeneric || cur === suggestedKey)) {
      setSelectedKey(suggestedKey);
      return;
    }
    if (isGeneric) setSelectedKey(suggestedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedKey, items.length, isLocked]);

  useEffect(() => {
    const tid = safeTrim(props.tenantId);
    if (!tid) return;
    if (!selectedKey) {
      setDefaults(null);
      return;
    }

    let alive = true;
    setDefaultsLoading(true);

    fetchIndustryDefaults({ tenantId: tid, industryKey: selectedKey })
      .then((d) => alive && setDefaults(d))
      .catch(() => alive && setDefaults(null))
      .finally(() => alive && setDefaultsLoading(false));

    return () => {
      alive = false;
    };
  }, [props.tenantId, selectedKey]);

  const canSave = Boolean(selectedKey);

  const altCandidates = useMemo(() => {
    const cur = normalizeKey(safeTrim(selectedKey));
    const sug = normalizeKey(safeTrim(suggestedKey));
    return topCandidates
      .filter((c) => c.key && c.key !== cur && c.key !== sug)
      .slice(0, 5);
  }, [topCandidates, selectedKey, suggestedKey]);

  async function commit(refineSubIndustry: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const key = safeTrim(selectedKey);
      if (!key) throw new Error("Choose an industry.");
      await props.onSubmit({ industryKey: key, refineSubIndustry });
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

      {showAiCard ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{usingModeA ? "AI interview result" : "AI signal"}</div>

              <div className="mt-1">
                {suggestedKey ? (
                  suggestedLabel ? (
                    <>
                      <span className="font-semibold">{suggestedLabel}</span>{" "}
                      <span className="font-mono text-xs opacity-90">({suggestedKey})</span>
                    </>
                  ) : (
                    <>
                      Suggested industry key: <span className="font-mono text-xs">{suggestedKey}</span>
                    </>
                  )
                ) : (
                  <span className="opacity-90">We have a few close matches — pick one below or click “Improve match”.</span>
                )}
              </div>

              {debugReason ? (
                <div className="mt-3 text-[11px] opacity-80">
                  <span className="font-semibold">Why:</span> {debugReason}
                </div>
              ) : null}

              {aiStatus ? (
                <div className="mt-2 text-[11px] opacity-80">
                  <span className="font-semibold">Status:</span> <span className="font-mono">{aiStatus}</span>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 text-xs text-right">
              {Number.isFinite(suggestedConfidence as any) ? (
                <div>
                  Confidence: <span className="font-mono">{pct(suggestedConfidence as number)}%</span>
                </div>
              ) : null}
              {Number.isFinite(fitScore as any) ? (
                <div className="mt-1">
                  Fit: <span className="font-mono">{pct(fitScore as number)}%</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* LOCKED: three options */}
          {isLocked && suggestedKey ? (
            <div className="mt-4">
              <div className="text-sm opacity-90">
                Based on your answers, this looks like{" "}
                <span className="font-semibold">{suggestedLabel || suggestedKey}</span>. What do you want to do?
              </div>

              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  className="w-full rounded-2xl bg-black px-4 py-3 text-left text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  disabled={saving}
                  onClick={() => {
                    setSelectedKey(suggestedKey);
                    setShowDisagree(false);
                    commit(false);
                  }}
                >
                  Yes — use {suggestedLabel || "this industry"}
                </button>

                <button
                  type="button"
                  className="w-full rounded-2xl border border-emerald-300/50 bg-white/60 px-4 py-3 text-left text-sm font-semibold text-emerald-950 disabled:opacity-50 dark:bg-black/20 dark:text-emerald-100"
                  disabled={saving}
                  onClick={() => {
                    setSelectedKey(suggestedKey);
                    setShowDisagree(false);
                    commit(true);
                  }}
                >
                  Yes — use {suggestedLabel || "this industry"}, but I’m more specific
                  <div className="mt-1 text-xs opacity-80">We’ll ask 1–3 quick questions to nail the sub-industry.</div>
                </button>

                <button
                  type="button"
                  className="w-full rounded-2xl border border-emerald-300/50 bg-transparent px-4 py-3 text-left text-sm font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
                  disabled={saving}
                  onClick={() => setShowDisagree((v) => !v)}
                >
                  Not quite
                </button>
              </div>

              {showDisagree ? (
                <div className="mt-3 rounded-2xl border border-emerald-300/40 bg-white/50 p-3 text-xs text-emerald-950 dark:bg-black/20 dark:text-emerald-100">
                  <div className="font-semibold">No problem.</div>
                  <div className="mt-1 opacity-90">
                    Pick an alternative, choose from the dropdown below, or restart the interview so we can ask better questions.
                  </div>

                  {altCandidates.length ? (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold opacity-90">Alternative industries</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {altCandidates.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            className="inline-flex items-center rounded-full border border-emerald-300/50 bg-white/70 px-2 py-1 text-[11px] font-semibold hover:bg-white dark:bg-black/30"
                            onClick={() => setSelectedKey(c.key)}
                            disabled={saving}
                          >
                            {c.label || c.key}
                            <span className="ml-2 font-mono opacity-70">{pct(c.score || 0)}%</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-emerald-300/50 bg-transparent px-3 py-2 text-xs font-semibold"
                      onClick={props.onReInterview}
                      disabled={saving}
                    >
                      Restart interview →
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-emerald-300/50 bg-transparent px-4 py-2 text-xs font-semibold text-emerald-950 dark:text-emerald-100"
                disabled={saving}
                onClick={props.onReInterview}
              >
                Improve match →
              </button>
            </div>
          )}
        </div>
      ) : showNeedSignal ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">We need a bit more signal</div>
          <div className="mt-1">We couldn’t confidently suggest an industry yet. Go back and answer a couple more questions.</div>
          <div className="mt-3">
            <button
              type="button"
              className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
              onClick={props.onReInterview}
            >
              Continue interview →
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* LEFT */}
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Choose from platform industries</div>
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={props.onReInterview}
              disabled={saving}
            >
              Improve match
            </button>
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading industries…</div>
          ) : (
            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Industry</div>
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  {items.map((x) => (
                    <option key={x.id} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedKey ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">Selected</div>
                  <div className="mt-1">
                    <span className="font-semibold">{selectedLabel || selectedKey}</span>{" "}
                    <span className="font-mono text-xs opacity-80">({selectedKey})</span>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                <div className="font-semibold text-gray-900 dark:text-gray-100">How we stay flexible</div>
                <div className="mt-1">Step 3 picks your industry. Step 3b optionally narrows you into a sub-industry.</div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry starter pack</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">This is the “instant experience” we can provide even with no website.</div>

          {!selectedKey ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              Select an industry to preview default services + questions.
            </div>
          ) : defaultsLoading ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading defaults…</div>
          ) : defaults ? (
            <div className="mt-4 grid gap-3">
              {defaults.commonServices?.length ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Common services</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                    {defaults.commonServices.slice(0, 6).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {defaults.commonPhotoRequests?.length ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Photos we’ll ask for</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                    {defaults.commonPhotoRequests.slice(0, 6).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {defaults.defaultCustomerQuestions?.length ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Default customer questions</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                    {defaults.defaultCustomerQuestions.slice(0, 5).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              Defaults aren’t available yet for this industry.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
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
          disabled={!canSave || saving}
          onClick={() => commit(false)}
        >
          {saving ? "Saving…" : "Yes — use this setup"}
        </button>
      </div>
    </div>
  );
}