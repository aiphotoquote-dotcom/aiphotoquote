// src/app/onboarding/wizard/steps/Step3.tsx
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function fetchIndustryDefaults(args: { tenantId: string; industryKey: string }): Promise<IndustryDefaults | null> {
  const qs = new URLSearchParams({ tenantId: args.tenantId, industryKey: args.industryKey });
  const res = await fetch(`/api/onboarding/industry-defaults?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (res.status === 404 || res.status === 405) return null;

  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) return null;
  return (j.defaults ?? null) as IndustryDefaults | null;
}

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

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Pass "sub-industry intent" to Step3b
 */
function setSubIntent(v: "refine" | "skip" | "unknown") {
  try {
    window.sessionStorage.setItem("apq_onboarding_sub_intent", v);
  } catch {
    // ignore
  }
}

/**
 * ✅ Persist AI interview per-tenant so Step3 doesn't "forget" on refresh/rerender.
 */
function interviewCacheKey(tenantId: string) {
  return `apq_industry_interview:${tenantId}`;
}

function readCachedInterview(tenantId: string): ModeA_Interview | null {
  try {
    const raw = window.sessionStorage.getItem(interviewCacheKey(tenantId));
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    if (j.mode !== "A") return null;
    return j as ModeA_Interview;
  } catch {
    return null;
  }
}

function writeCachedInterview(tenantId: string, interview: ModeA_Interview) {
  try {
    window.sessionStorage.setItem(interviewCacheKey(tenantId), JSON.stringify(interview));
  } catch {
    // ignore
  }
}

export function Step3(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;

  onBack: () => void;
  onReInterview: () => void;

  onSubmit: (args: { industryKey: string }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [defaults, setDefaults] = useState<IndustryDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  const [showDisagree, setShowDisagree] = useState(false);

  // ✅ cached interview fallback
  const [cachedInterview, setCachedInterview] = useState<ModeA_Interview | null>(null);

  const tid = safeTrim(props.tenantId);

  // Load cached interview when tenant changes
  useEffect(() => {
    if (!tid) {
      setCachedInterview(null);
      return;
    }
    setCachedInterview(readCachedInterview(tid));
  }, [tid]);

  // Extract Mode A interview from props
  const propInterview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  // ✅ source of truth: props interview if present else cached
  const interview: ModeA_Interview | null = propInterview ?? cachedInterview;

  // If props interview exists, persist it
  useEffect(() => {
    if (!tid) return;
    if (!propInterview) return;
    writeCachedInterview(tid, propInterview);
    setCachedInterview((prev) => {
      const prevRound = Number(prev?.round ?? 0) || 0;
      const nextRound = Number(propInterview.round ?? 0) || 0;
      return nextRound >= prevRound ? propInterview : prev;
    });
  }, [tid, propInterview]);

  const isLocked = safeTrim(interview?.status) === "locked";

  const suggestedKey = useMemo(
    () => normalizeKey(interview?.proposedIndustry?.key ?? ""),
    [interview?.proposedIndustry?.key]
  );

  const suggestedConfidence = useMemo(() => (interview ? clamp01(interview.confidenceScore) : null), [interview]);
  const fitScore = useMemo(() => (interview ? clamp01(interview.fitScore) : null), [interview]);

  const aiStatus = useMemo(() => safeTrim(interview?.status) || "", [interview]);
  const debugReason = useMemo(() => safeTrim(interview?.meta?.debug?.reason) || "", [interview]);

  const candidates: Candidate[] = useMemo(() => {
    if (Array.isArray(interview?.candidates)) return interview!.candidates;
    return [];
  }, [interview?.candidates]);

  const topCandidates = useMemo(() => {
    return candidates
      .map((c: any) => ({
        key: normalizeKey(safeTrim(c?.key ?? "")),
        label: safeTrim(c?.label ?? ""),
        score: clamp01(c?.score),
      }))
      .filter((c) => c.key)
      .slice(0, 6);
  }, [candidates]);

  const selectedLabel = useMemo(() => {
    const hit = items.find((x) => x.key === selectedKey);
    return hit?.label ?? "";
  }, [items, selectedKey]);

  const suggestedLabel = useMemo(() => {
    if (!suggestedKey) return "";
    const hit = items.find((x) => x.key === suggestedKey);
    return hit?.label ?? "";
  }, [items, suggestedKey]);

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

      const serverSel = normalizeKey(safeTrim((j as any).selectedKey));
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
  }, [tid]);

  // If suggestion arrives after industries load, adopt it
  useEffect(() => {
    if (!items.length) return;
    if (!suggestedKey) return;

    const exists = items.some((x) => x.key === suggestedKey);
    if (!exists) return;

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
    if (!tid) return;
    if (!selectedKey) {
      setDefaults(null);
      return;
    }

    let alive = true;
    setDefaultsLoading(true);

    fetchIndustryDefaults({ tenantId: tid, industryKey: selectedKey })
      .then((d) => {
        if (!alive) return;
        setDefaults(d);
      })
      .catch(() => {
        if (!alive) return;
        setDefaults(null);
      })
      .finally(() => {
        if (!alive) return;
        setDefaultsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [tid, selectedKey]);

  const canSave = Boolean(selectedKey);

  const showAiCard = Boolean(interview) || topCandidates.length > 0 || Boolean(suggestedKey);
  const showThreeWay = Boolean(suggestedKey);

  async function commitIndustry(key: string, intent: "refine" | "skip" | "unknown") {
    const k = safeTrim(key);
    if (!k) throw new Error("Choose an industry.");
    setSubIntent(intent);
    await props.onSubmit({ industryKey: k });
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
              <div className="font-semibold">AI interview result</div>

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
                ) : topCandidates.length ? (
                  <span className="opacity-90">A few close matches surfaced — pick one below or restart the interview.</span>
                ) : (
                  <span className="opacity-90">Restart the interview to get a confident industry suggestion.</span>
                )}
              </div>

              {topCandidates.length ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold opacity-90">Alternative industries</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topCandidates
                      .filter((c) => c.key && c.key !== normalizeKey(selectedKey))
                      .slice(0, 6)
                      .map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="inline-flex items-center rounded-full border border-emerald-300/50 bg-white/60 px-2 py-1 text-[11px] font-semibold text-emerald-950 hover:bg-white disabled:opacity-50 dark:bg-black/20 dark:text-emerald-100"
                          onClick={() => {
                            setSelectedKey(c.key);
                            setShowDisagree(true);
                          }}
                          disabled={saving}
                          title="Switch to this industry"
                        >
                          {c.label || c.key}
                          <span className="ml-2 font-mono opacity-70">{pct(c.score)}%</span>
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}

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

            <div className="shrink-0 text-right text-xs">
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

          {showThreeWay ? (
            <div className="mt-4">
              <div className="text-sm opacity-90">
                This looks like <span className="font-semibold">{suggestedLabel || suggestedKey}</span>. What do you want to do?
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  disabled={saving || !suggestedKey}
                  onClick={async () => {
                    if (!suggestedKey) return;
                    setSaving(true);
                    setErr(null);
                    try {
                      setSelectedKey(suggestedKey);
                      setShowDisagree(false);
                      await commitIndustry(suggestedKey, "skip");
                    } catch (e: any) {
                      setErr(e?.message ?? String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Yes — use {suggestedLabel || "this industry"}
                </button>

                <button
                  type="button"
                  className="rounded-xl border border-emerald-300/50 bg-white/60 px-4 py-2 text-xs font-semibold text-emerald-950 hover:bg-white disabled:opacity-50 dark:bg-black/20 dark:text-emerald-100"
                  disabled={saving || !suggestedKey}
                  onClick={async () => {
                    if (!suggestedKey) return;
                    setSaving(true);
                    setErr(null);
                    try {
                      setSelectedKey(suggestedKey);
                      setShowDisagree(false);
                      await commitIndustry(suggestedKey, "refine");
                    } catch (e: any) {
                      setErr(e?.message ?? String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Yes — but I’m more focused
                </button>

                <button
                  type="button"
                  className="rounded-xl border border-emerald-300/50 bg-transparent px-4 py-2 text-xs font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
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
                    Try one of the alternatives above, or restart the interview so we can ask better questions.
                  </div>

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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs opacity-90">Restart the interview to get a confident industry suggestion.</div>
              <button
                type="button"
                className="rounded-xl border border-emerald-300/50 bg-transparent px-3 py-2 text-xs font-semibold text-emerald-950 dark:text-emerald-100"
                disabled={saving}
                onClick={props.onReInterview}
              >
                Improve match →
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          <div className="font-semibold">Choose an industry</div>
          <div className="mt-1 opacity-90">
            We don’t have a suggestion yet. Click “Improve match” to answer a few more questions.
          </div>
          <div className="mt-3">
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              onClick={props.onReInterview}
              disabled={saving}
            >
              Improve match →
            </button>
          </div>
        </div>
      )}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Starter pack */}
      <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry starter pack</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          This is the “instant experience” we can provide even with no website.
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading…</div>
        ) : !selectedKey ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            Choose an industry to preview defaults.
          </div>
        ) : defaultsLoading ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading defaults…</div>
        ) : defaults ? (
          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Selected industry</div>
              <div className="mt-1">
                <span className="font-semibold">{selectedLabel || selectedKey}</span>{" "}
                <span className="font-mono text-xs opacity-80">({selectedKey})</span>
              </div>
            </div>

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

      {/* Bottom nav */}
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
          onClick={async () => {
            setSaving(true);
            setErr(null);
            try {
              const key = safeTrim(selectedKey);
              if (!key) throw new Error("Choose an industry.");
              await commitIndustry(key, "unknown");
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Yes — use this setup"}
        </button>
      </div>
    </div>
  );
}