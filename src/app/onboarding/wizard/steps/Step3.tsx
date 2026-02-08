// src/app/onboarding/wizard/steps/Step3.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { IndustriesResponse, IndustryItem } from "../types";
import { buildIndustriesUrl } from "../utils";
import { Field } from "./Field";

type IndustryDefaults = {
  industryKey: string;
  // v1: keep it simple; we can expand later
  subIndustries: Array<{ key: string; label: string; blurb?: string | null }>;
  commonServices: string[];
  commonPhotoRequests: string[];
  defaultCustomerQuestions: string[];
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

  // ✅ If route not implemented yet, don't break Step3 — just return null
  if (res.status === 404 || res.status === 405) return null;

  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) return null;
  return (j.defaults ?? null) as IndustryDefaults | null;
}

export function Step3(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;
  onBack: () => void;
  onSubmit: (args: { industryKey?: string; industryLabel?: string }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [createMode, setCreateMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ New: defaults preview state
  const [defaults, setDefaults] = useState<IndustryDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  const suggestedKey = String(props.aiAnalysis?.suggestedIndustryKey ?? "").trim();
  const suggestedConfidence =
    props.aiAnalysis?.confidenceScore !== null && props.aiAnalysis?.confidenceScore !== undefined
      ? Number(props.aiAnalysis?.confidenceScore)
      : null;

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
      const tid = String(props.tenantId ?? "").trim();
      if (!tid) throw new Error("NO_TENANT: missing tenantId for industries load.");

      const res = await fetch(buildIndustriesUrl(tid), { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as IndustriesResponse | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      const list = Array.isArray(j.industries) ? j.industries : [];
      setItems(list);

      const serverSel = String(j.selectedKey ?? "").trim();
      const hasSuggested = suggestedKey && list.some((x) => x.key === suggestedKey);

      const next =
        (serverSel && list.some((x) => x.key === serverSel) ? serverSel : "") ||
        (hasSuggested ? suggestedKey : "") ||
        (list[0]?.key ?? "");

      setSelectedKey(next);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Load industries
  useEffect(() => {
    loadIndustries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  // Load defaults when selectedKey changes (best-effort)
  useEffect(() => {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) return;
    if (!selectedKey || createMode) {
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
  }, [props.tenantId, selectedKey, createMode]);

  const canSave = createMode ? newLabel.trim().length >= 2 : Boolean(selectedKey);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This lets us instantly tailor prompts, customer questions, and defaults — even if you don’t have a website.
      </div>

      {suggestedKey ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">AI suggestion</div>
              <div className="mt-1">
                {suggestedLabel ? (
                  <>
                    <span className="font-semibold">{suggestedLabel}</span>{" "}
                    <span className="font-mono text-xs opacity-90">({suggestedKey})</span>
                  </>
                ) : (
                  <>
                    Suggested industry key: <span className="font-mono text-xs">{suggestedKey}</span>
                  </>
                )}
              </div>
            </div>

            {Number.isFinite(suggestedConfidence as any) ? (
              <div className="text-xs">
                Confidence:{" "}
                <span className="font-mono">{Math.round((suggestedConfidence as number) * 100)}%</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* LEFT: selector */}
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Choose an industry</div>
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              onClick={() => {
                setCreateMode((v) => !v);
                setNewLabel("");
              }}
            >
              {createMode ? "Select existing" : "Create new"}
            </button>
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading industries…</div>
          ) : createMode ? (
            <div className="mt-4 grid gap-3">
              <Field label="New industry label" value={newLabel} onChange={setNewLabel} placeholder="e.g., Marine upholstery" />
              <div className="text-xs text-gray-600 dark:text-gray-300">
                We’ll save this as a tenant-specific industry (doesn’t change the global platform list yet).
              </div>
            </div>
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
                      {x.label} {x.source === "tenant" ? "(your tenant)" : ""}
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
            </div>
          )}
        </div>

        {/* RIGHT: defaults preview */}
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry starter pack</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            This is the “instant experience” we can provide even with no website.
          </div>

          {!selectedKey || createMode ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              Select an industry to preview default services + questions.
            </div>
          ) : defaultsLoading ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading defaults…</div>
          ) : defaults ? (
            <div className="mt-4 grid gap-3">
              {defaults.subIndustries?.length ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Common sub-industries</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {defaults.subIndustries.slice(0, 10).map((s) => (
                      <span
                        key={s.key}
                        className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                        title={s.blurb ?? undefined}
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

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
              Defaults aren’t available yet for this industry. That’s okay — next step is adding the defaults table + API.
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
          onClick={async () => {
            setSaving(true);
            setErr(null);
            try {
              if (createMode) await props.onSubmit({ industryLabel: newLabel.trim() });
              else await props.onSubmit({ industryKey: selectedKey });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}