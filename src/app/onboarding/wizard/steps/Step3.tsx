"use client";

import React, { useEffect, useState } from "react";
import type { IndustriesResponse, IndustryItem } from "../types";
import { buildIndustriesUrl } from "../utils";
import { Field } from "./Field";

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

  const suggestedKey = String(props.aiAnalysis?.suggestedIndustryKey ?? "").trim();

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

  useEffect(() => {
    loadIndustries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  const canSave = createMode ? newLabel.trim().length >= 2 : Boolean(selectedKey);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This lets us load the right prompts, pricing defaults, and language for your customers.
      </div>

      {suggestedKey ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="font-semibold">AI suggestion</div>
          <div className="mt-1">
            Suggested industry key: <span className="font-mono text-xs">{suggestedKey}</span>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
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
                <div className="font-semibold text-gray-900 dark:text-gray-100">Selected key</div>
                <div className="mt-1 font-mono text-xs">{selectedKey}</div>
              </div>
            ) : null}
          </div>
        )}
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