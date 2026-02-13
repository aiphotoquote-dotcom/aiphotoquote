"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function isPlaceholder(key: string) {
  return !key || key === "service";
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

  // wizard-provided saved industry key (preferred)
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

  // prevent auto-submit loops
  const autoCommittedRef = useRef(false);

  const tid = safeTrim(props.tenantId);

  const interview: ModeA_Interview | null = useMemo(() => {
    const x = props.aiAnalysis?.industryInterview;
    if (!x || typeof x !== "object") return null;
    if ((x as any).mode !== "A") return null;
    return x as ModeA_Interview;
  }, [props.aiAnalysis]);

  const suggestedKey = useMemo(() => normalizeKey(interview?.proposedIndustry?.key ?? ""), [interview?.proposedIndustry?.key]);

  const wizardSel = useMemo(() => normalizeKey(safeTrim(props.currentIndustryKey)), [props.currentIndustryKey]);

  const selectedLabel = useMemo(() => {
    const hit = items.find((x) => x.key === selectedKey);
    return hit?.label ?? "";
  }, [items, selectedKey]);

  const wizardLabel = useMemo(() => {
    if (!wizardSel) return "";
    const hit = items.find((x) => x.key === wizardSel);
    return hit?.label ?? "";
  }, [items, wizardSel]);

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

      const rawServerSel =
        normalizeKey(safeTrim((j as any).selectedKey)) ||
        normalizeKey(safeTrim((j as any).industryKey)) ||
        normalizeKey(safeTrim((j as any).tenantIndustryKey)) ||
        "";

      const serverSel = isPlaceholder(rawServerSel) ? "" : rawServerSel;

      const hasWizard = wizardSel && list.some((x) => x.key === wizardSel);
      const hasSuggested = suggestedKey && list.some((x) => x.key === suggestedKey);
      const hasServer = serverSel && list.some((x) => x.key === serverSel);

      // choose selection (but Step3 may auto-commit below)
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

  // defaults preview
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

  async function commitIndustry(industryKey: string, intent: "refine" | "skip" | "unknown") {
    const k = safeTrim(industryKey);
    if (!k) throw new Error("Choose an industry.");
    setSubIntent(intent);
    await props.onSubmit({ industryKey: k });
  }

  /**
   * ✅ Key behavior change:
   * If the tenant already has a real industry (wizardSel) we should not “ask again”.
   * We auto-commit (skip) and let the wizard advance to Step3b immediately.
   */
  useEffect(() => {
    if (autoCommittedRef.current) return;
    if (loading) return;
    if (!tid) return;
    if (!items.length) return;

    const hasRealSaved = wizardSel && !isPlaceholder(wizardSel) && items.some((x) => x.key === wizardSel);
    if (!hasRealSaved) return;

    autoCommittedRef.current = true;

    // ensure UI selection reflects saved value (for the brief moment it’s visible)
    setSelectedKey(wizardSel);

    // auto-advance; Step3b will see intent=skip
    setSaving(true);
    setErr(null);

    commitIndustry(wizardSel, "skip")
      .catch((e: any) => {
        // If commit fails, unlock the page so user can proceed manually.
        autoCommittedRef.current = false;
        setErr(e?.message ?? String(e));
      })
      .finally(() => {
        setSaving(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tid, items.length, wizardSel]);

  const showManualUI = useMemo(() => {
    // show manual UI when we DON'T have a real saved industry
    if (loading) return false;
    if (!wizardSel) return true;
    if (isPlaceholder(wizardSel)) return true;
    if (!items.some((x) => x.key === wizardSel)) return true;
    return false;
  }, [loading, wizardSel, items]);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This locks in your default prompts, customer questions, and photo requests.
      </div>

      {/* Auto-locking state (the “don’t ask again” fix) */}
      {!showManualUI ? (
        <div className="mt-5 overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="text-[11px] font-semibold tracking-wide opacity-80">LOCKED IN</div>

          <div className="mt-2 text-3xl font-extrabold leading-tight">
            {wizardLabel || selectedLabel || "Industry selected"}
          </div>

          <div className="mt-2 text-sm opacity-90">
            We’ll use this industry to generate your starter defaults. You can change it anytime later in Admin settings.
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                saving
                  ? "border-emerald-200 bg-white text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100"
                  : "border-emerald-200 bg-white text-emerald-950 dark:border-emerald-900/40 dark:bg-black dark:text-emerald-100"
              )}
            >
              {saving ? "Saving & continuing…" : "Continuing…"}
            </div>

            <button
              type="button"
              className="rounded-full border border-emerald-200 bg-transparent px-3 py-1 text-xs font-semibold hover:bg-white/50 dark:border-emerald-900/40 dark:hover:bg-black/20"
              onClick={props.onReInterview}
              disabled={saving}
              title="Answer a few questions to change the industry suggestion"
            >
              Change / improve match
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {err}
              <div className="mt-2 text-xs opacity-80">You can still select an industry manually below.</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Manual selection UI (only when we truly need it) */}
      {showManualUI ? (
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
            {err ? (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {err}
              </div>
            ) : null}

            {loading ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">Loading industries…</div>
            ) : (
              <div className="grid gap-3">
                <label className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">INDUSTRY</label>
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  {items.map((x) => (
                    <option key={x.id} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>

                {selectedKey ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">SELECTED</div>
                    <div className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">{selectedLabel || "Selected industry"}</div>
                  </div>
                ) : null}

                {/* Starter pack preview */}
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
        </div>
      ) : null}
    </div>
  );
}