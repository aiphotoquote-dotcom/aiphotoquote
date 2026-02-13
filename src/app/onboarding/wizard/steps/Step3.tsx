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

type ModeA_Interview = {
  mode: "A";
  status: "collecting" | "locked";
  round: number;
  confidenceScore: number;
  fitScore: number;
  proposedIndustry: { key: string; label: string } | null;
  candidates: Array<{ key: string; label: string; score: number; exists?: boolean }>;
  meta?: any;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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

// ✅ accept any so callers can pass optional keys without TS errors
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

/**
 * Step3 -> Step3b intent (no server coupling).
 * Step3b reads and clears this.
 *
 * IMPORTANT:
 * - We should NOT auto-set "skip" anymore (that was causing Step3b to auto-skip).
 * - Default to "unknown" unless the user explicitly chooses a path that implies intent.
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
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // defaults preview (manual fallback)
  const [defaults, setDefaults] = useState<IndustryDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);

  const interview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  const suggestedKey = useMemo(() => {
    const k = normalizeKey(interview?.proposedIndustry?.key ?? "");
    return k;
  }, [interview?.proposedIndustry?.key]);

  const suggestedLabelFromAI = useMemo(() => safeTrim(interview?.proposedIndustry?.label ?? ""), [interview?.proposedIndustry?.label]);

  const wizardSel = useMemo(() => normalizeKey(safeTrim(props.currentIndustryKey)), [props.currentIndustryKey]);

  const conf = clamp01Nullable(interview?.confidenceScore);
  const fit = clamp01Nullable(interview?.fitScore);

  const reason = useMemo(() => {
    const r = safeTrim(interview?.meta?.debug?.reason ?? "");
    return r;
  }, [interview?.meta]);

  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) m[normalizeKey(it.key)] = it.label;
    return m;
  }, [items]);

  const suggestedLabel = useMemo(() => {
    if (suggestedKey && labelMap[suggestedKey]) return labelMap[suggestedKey];
    if (suggestedLabelFromAI) return suggestedLabelFromAI;
    return suggestedKey ? suggestedKey.replace(/_/g, " ") : "";
  }, [suggestedKey, labelMap, suggestedLabelFromAI]);

  const savedLabel = useMemo(() => {
    if (!wizardSel) return "";
    return labelMap[wizardSel] || "";
  }, [wizardSel, labelMap]);

  const showRecommendedUI = useMemo(() => {
    if (!suggestedKey) return false;
    return true;
  }, [suggestedKey]);

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

      const hasWizard = wizardSel && list.some((x) => normalizeKey(x.key) === wizardSel);
      const hasSuggested = suggestedKey && list.some((x) => normalizeKey(x.key) === suggestedKey);

      const next =
        (hasSuggested ? suggestedKey : "") ||
        (hasWizard ? wizardSel : "") ||
        normalizeKey(list.find((x) => normalizeKey(x.key) !== "service")?.key) ||
        normalizeKey(list[0]?.key) ||
        "";

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

  // defaults preview (manual fallback)
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

  async function commitIndustry(industryKey: string) {
    const k = normalizeKey(industryKey);
    if (!k) throw new Error("Choose an industry.");
    // ✅ default to unknown so Step3b PROMPT shows (no auto-skip)
    setSubIntent("unknown");
    await props.onSubmit({ industryKey: k });
  }

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This locks in your default prompts, customer questions, and photo requests.
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* ✅ Unified “recommended industry” UI (matches website-analysis feel) */}
      {showRecommendedUI ? (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="text-[11px] font-semibold tracking-wide opacity-80">{wizardSel ? "LOCKED IN" : "RECOMMENDED INDUSTRY"}</div>

          <div className="mt-2 text-3xl font-extrabold leading-tight">{savedLabel || suggestedLabel || "Industry"}</div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold dark:border-emerald-900/40 dark:bg-black">
              Confidence: <span className="ml-2 font-mono">{pct(conf)}</span>
            </span>
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold dark:border-emerald-900/40 dark:bg-black">
              Fit: <span className="ml-2 font-mono">{pct(fit)}</span>
            </span>
          </div>

          <div className="mt-3 text-sm opacity-90">Confirm this so we can tailor your defaults.</div>

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
              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed opacity-90">
                {reason || "Based on the signals we detected, this looks like the best match."}
              </div>

              {suggestedKey ? (
                <div className="mt-3 text-[11px] opacity-70">
                  Internal key: <span className="font-mono">{suggestedKey}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-emerald-200 bg-white py-3 text-sm font-semibold text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100"
              onClick={props.onBack}
              disabled={saving}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
              disabled={saving || !tid || !(wizardSel || suggestedKey)}
              onClick={async () => {
                setSaving(true);
                setErr(null);
                try {
                  const key = wizardSel || suggestedKey;
                  if (!key) throw new Error("Missing industry selection.");
                  await commitIndustry(key);
                } catch (e: any) {
                  setErr(e?.message ?? String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Yes, that’s right →"}
            </button>
          </div>

          <button
            type="button"
            className="mt-3 w-full rounded-2xl border border-emerald-200 bg-transparent py-3 text-sm font-semibold text-emerald-950 hover:bg-white/50 disabled:opacity-50 dark:border-emerald-900/40 dark:text-emerald-100 dark:hover:bg-black/20"
            onClick={props.onReInterview}
            disabled={saving}
            title="Answer a few questions to change the industry suggestion"
          >
            Not quite — improve match
          </button>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-gray-900">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Choose the best match</div>
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={props.onReInterview}
              disabled={saving}
            >
              Improve match
            </button>
          </div>

          <div className="px-4 py-4">
            {loading ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">Loading industries…</div>
            ) : (
              <div className="grid gap-3">
                <label className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">INDUSTRY</label>
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(normalizeKey(e.target.value))}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  {items.map((x) => (
                    <option key={x.id} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>

                <div className="mt-2">
                  {defaultsLoading ? (
                    <div className="text-sm text-gray-600 dark:text-gray-300">Loading starter defaults…</div>
                  ) : defaults ? (
                    <div className="grid gap-3">
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
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                      Defaults aren’t available yet for this industry.
                    </div>
                  )}
                </div>

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
                    disabled={!selectedKey || saving}
                    onClick={async () => {
                      setSaving(true);
                      setErr(null);
                      try {
                        const key = safeTrim(selectedKey);
                        if (!key) throw new Error("Choose an industry.");
                        await commitIndustry(key);
                      } catch (e: any) {
                        setErr(e?.message ?? String(e));
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? "Saving…" : "Yes, that’s right →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}