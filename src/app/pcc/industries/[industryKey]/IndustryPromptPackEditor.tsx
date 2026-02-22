// src/app/pcc/industries/[industryKey]/IndustryPromptPackEditor.tsx
"use client";

import React, { useMemo, useState } from "react";

import GenerateIndustryPackButton from "./GenerateIndustryPackButton";
import MergeIndustryButton from "./MergeIndustryButton";
import DeleteIndustryButton from "./DeleteIndustryButton";

type Pack = {
  quoteEstimatorSystem?: string;
  qaQuestionGeneratorSystem?: string;
  extraSystemPreamble?: string;

  renderSystemAddendum?: string;
  renderNegativeGuidance?: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default function IndustryPromptPackEditor(props: {
  industryKey: string;
  industryLabel: string;
  industryDescription: string | null;
  isCanonical: boolean;
  initialPack: Pack | null;
}) {
  const [pack, setPack] = useState<Pack>(() => props.initialPack ?? {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const a = JSON.stringify(props.initialPack ?? {});
    const b = JSON.stringify(pack ?? {});
    return a !== b;
  }, [pack, props.initialPack]);

  async function onSave() {
    setSaving(true);
    setMsg(null);
    setErr(null);

    try {
      const r = await fetch("/api/pcc/industry-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          industryKey: props.industryKey,
          pack: {
            extraSystemPreamble: safeTrim(pack.extraSystemPreamble) || null,
            quoteEstimatorSystem: safeTrim(pack.quoteEstimatorSystem) || null,
            qaQuestionGeneratorSystem: safeTrim(pack.qaQuestionGeneratorSystem) || null,
            renderSystemAddendum: safeTrim(pack.renderSystemAddendum) || null,
            renderNegativeGuidance: safeTrim(pack.renderNegativeGuidance) || null,
          },
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.message || data?.error || `HTTP_${r.status}`);

      setMsg("Saved.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onClear() {
    if (!confirm("Clear this industry's prompt pack overrides?")) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/pcc/industry-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          industryKey: props.industryKey,
          pack: null,
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.message || data?.error || `HTTP_${r.status}`);
      setPack({});
      setMsg("Cleared.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry prompt pack (PCC)</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Platform-managed defaults for <span className="font-mono">{props.industryKey}</span>. Used by estimator, QA, and renders (cron).
          </div>

          {!props.isCanonical ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              <div className="font-semibold">Derived industry (not in industries table)</div>
              <div className="mt-1">
                Merge/Delete are disabled because this key has no canonical row yet. If you want to manage it, first let onboarding create it
                (or create/approve it in the industries table later).
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          {/* ✅ One toolbar: generate + merge/delete live here (no duplicates elsewhere) */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <GenerateIndustryPackButton
              industryKey={props.industryKey}
              industryLabel={props.industryLabel}
              industryDescription={props.industryDescription}
            />

            {props.isCanonical ? <MergeIndustryButton sourceKey={props.industryKey} /> : null}
            {props.isCanonical ? <DeleteIndustryButton industryKey={props.industryKey} /> : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs font-semibold",
                "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950",
                saving && "opacity-60"
              )}
            >
              Clear
            </button>

            <button
              type="button"
              onClick={onSave}
              disabled={saving || !dirty}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs font-semibold",
                dirty
                  ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-800 dark:bg-black dark:text-gray-500",
                saving && "opacity-60"
              )}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {msg ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {msg}
        </div>
      ) : null}

      {err ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Estimator system override</div>
          <textarea
            value={pack.quoteEstimatorSystem ?? ""}
            onChange={(e) => setPack((p) => ({ ...p, quoteEstimatorSystem: e.target.value }))}
            rows={10}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
            placeholder="Optional. If blank, platform defaults apply."
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">QA generator system override</div>
          <textarea
            value={pack.qaQuestionGeneratorSystem ?? ""}
            onChange={(e) => setPack((p) => ({ ...p, qaQuestionGeneratorSystem: e.target.value }))}
            rows={10}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
            placeholder="Optional. If blank, platform defaults apply."
          />
        </div>

        <div className="space-y-2 lg:col-span-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Extra system preamble (optional)</div>
          <textarea
            value={pack.extraSystemPreamble ?? ""}
            onChange={(e) => setPack((p) => ({ ...p, extraSystemPreamble: e.target.value }))}
            rows={4}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
            placeholder="Optional. Prepended to estimator + QA prompts for this industry."
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Render system addendum</div>
          <textarea
            value={pack.renderSystemAddendum ?? ""}
            onChange={(e) => setPack((p) => ({ ...p, renderSystemAddendum: e.target.value }))}
            rows={8}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
            placeholder="Anchor the render in this domain: materials, environment, what it should look like."
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Render negative guidance</div>
          <textarea
            value={pack.renderNegativeGuidance ?? ""}
            onChange={(e) => setPack((p) => ({ ...p, renderNegativeGuidance: e.target.value }))}
            rows={8}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
            placeholder="Explicitly block drift: unrelated scenes/subjects/objects."
          />
        </div>
      </div>
    </div>
  );
}