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

function clamp01Nullable(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.max(0, Math.min(100, Math.round(n * 100)))}%`;
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

export function Step3(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;

  // ✅ NEW: wizard can pass the tenant's current/saved industry key
  currentIndustryKey?: string | null;

  onBack: () => void;
  onReInterview: () => void;

  // Step3 commits industry selection only; wizard proceeds to Step3b next.
  onSubmit: (args: { industryKey: string }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // defaults preview
  const [defaults, setDefaults] = useState<IndustryDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  // UX
  const [showDisagree, setShowDisagree] = useState(false);

  const interview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  const isLocked = safeTrim(interview?.status) === "locked";

  const suggestedKey = useMemo(() => normalizeKey(interview?.proposedIndustry?.key ?? ""), [interview?.proposedIndustry?.key]);
  const suggestedConfidence = useMemo(() => (interview ? clamp01Nullable(interview.confidenceScore) : null), [interview]);
  const fitScore = useMemo(() => (interview ? clamp01Nullable(interview.fitScore) : null), [interview]);

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
        score: clamp01Nullable(c?.score) ?? 0,
      }))
      .filter((c) => c.key)
      .slice(0, 6);
  }, [candidates]);

  const suggestedLabel = useMemo(() => {
    if (!suggestedKey) return "";
    const hit = items.find((x) => x.key === suggestedKey);
    return hit?.label ?? "";
  }, [items, suggestedKey]);

  const selectedLabel = useMemo(() => {
    const hit = items.find((x) => x.key === selectedKey);
    return hit?.label ?? "";
  }, [items, selectedKey]);

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

      // ✅ Prefer: wizard-provided current industry, then server, then AI suggested.
      const wizardSel = normalizeKey(safeTrim(props.currentIndustryKey));
      const serverSel =
        normalizeKey(safeTrim((j as any).selectedKey)) ||
        normalizeKey(safeTrim((j as any).industryKey)) ||
        normalizeKey(safeTrim((j as any).tenantIndustryKey)) ||
        "";

      const hasWizard = wizardSel && list.some((x) => x.key === wizardSel);
      const hasServer = serverSel && list.some((x) => x.key === serverSel);
      const hasSuggested = suggestedKey && list.some((x) => x.key === suggestedKey);

      // Choose next:
      // - if tenant already has a real industry, keep it (never revert to "service")
      // - else if AI has a suggestion, adopt it
      // - else fall back to something that isn't "service" if possible
      let next =
        (hasWizard ? wizardSel : "") ||
        (hasServer ? serverSel : "") ||
        (hasSuggested ? suggestedKey : "") ||
        "";

      if (!next) {
        const nonGeneric = list.find((x) => x.key && x.key !== "service");
        next = nonGeneric?.key ?? list[0]?.key ?? "";
      }

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

  // If suggestion arrives later, adopt it ONLY if we are still generic/empty.
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
    const tid = safeTrim(props.tenantId);
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
  }, [props.tenantId, selectedKey]);

  const canSave = Boolean(selectedKey);

  const showAiCard = Boolean(interview) || Boolean(suggestedKey) || topCandidates.length > 0;
  const showThreeWay = Boolean(suggestedKey);

  async function commitIndustry(industryKey: string, intent: "refine" | "skip" | "unknown") {
    const k = safeTrim(industryKey);
    if (!k) throw new Error("Choose an industry.");
    setSubIntent(intent === "unknown" ? "unknown" : intent);
    await props.onSubmit({ industryKey: k });
  }

  const showFallbackPicker = !showThreeWay;

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This locks in your default prompts, customer questions, and photo requests.
      </div>

      {/* AI card */}
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
                ) : (
                  <span className="opacity-90">
                    We don’t have a suggestion yet. Use “Improve match” to answer a few more questions — or pick the closest match
                    below.
                  </span>
                )}
              </div>

              {topCandidates.length ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold opacity-90">Alternative industries</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topCandidates
                      .filter((c) => c.key && c.key !== normalizeKey(selectedKey))
                      .slice(0, 4)
                      .map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="inline-flex items-center rounded-full border border-emerald-300/50 bg-white/60 px-2 py-1 text-[11px] font-semibold text-emerald-950 hover:bg-white dark:bg-black/20 dark:text-emerald-100"
                          onClick={() => {
                            setSelectedKey(c.key);
                            setShowDisagree(true);
                          }}
                          disabled={saving}
                          title="Switch to this industry"
                        >
                          {c.label || c.key}
                          <span className="ml-2 font-mono opacity-70">{pct(clamp01Nullable(c.score))}</span>
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
              <div>
                Confidence: <span className="font-mono">{pct(suggestedConfidence)}</span>
              </div>
              <div className="mt-1">
                Fit: <span className="font-mono">{pct(fitScore)}</span>
              </div>
            </div>
          </div>

          {/* 3-way decision */}
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
                  title="Lock the industry, then refine with an optional sub-industry interview"
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
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Fallback picker only when we don't have a proposed industry yet */}
      {showFallbackPicker ? (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry</div>
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
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {items.map((x) => (
                  <option key={x.id} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>

              {selectedKey ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">Selected</div>
                  <div className="mt-1">
                    <span className="font-semibold">{selectedLabel || selectedKey}</span>{" "}
                    <span className="font-mono text-xs opacity-80">({selectedKey})</span>
                  </div>
                </div>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-3">
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
                  {saving ? "Saving…" : "Continue →"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry starter pack</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            This is the “instant experience” we can provide even with no website.
          </div>

          {!selectedKey ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              Waiting for an industry selection…
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
      )}
    </div>
  );
}