// src/components/pcc/llm/LlmManagerClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { PlatformLlmConfig, PromptSet } from "@/lib/pcc/llm/types";

export function LlmManagerClient({ initialConfig }: { initialConfig: PlatformLlmConfig }) {
  const [cfg, setCfg] = useState<PlatformLlmConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const active = useMemo(
    () => cfg.promptSets.find((p) => p.id === cfg.activePromptSetId) ?? cfg.promptSets[0],
    [cfg]
  );

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pcc/llm/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const text = await res.text();
      const j = text ? JSON.parse(text) : null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || `Save failed (HTTP ${res.status})`);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function setActive(id: string) {
    setCfg((prev) => ({ ...prev, activePromptSetId: id }));
  }

  function updateActive(partial: Partial<PromptSet>) {
    setCfg((prev) => ({
      ...prev,
      promptSets: prev.promptSets.map((p) => (p.id === prev.activePromptSetId ? { ...p, ...partial } : p)),
      updatedAt: new Date().toISOString(),
    }));
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Prompt Sets</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">Pick the active set and adjust guardrails.</div>
        </div>

        <button
          type="button"
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {msg ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {msg}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {cfg.promptSets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.id)}
            className={[
              "rounded-xl border px-3 py-2 text-sm font-semibold",
              p.id === cfg.activePromptSetId
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100",
            ].join(" ")}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">System Prompt</div>
          <textarea
            value={active?.system ?? ""}
            onChange={(e) => updateActive({ system: e.target.value })}
            className="h-56 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          />
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Guardrails</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              V1: basic toggles. We’ll enforce server-side in the quote routes next.
            </div>
          </div>

          <Toggle
            label="Refuse on policy violations"
            checked={Boolean(active?.guardrails?.refuseOnPolicyViolation)}
            onChange={(v) => updateActive({ guardrails: { ...(active?.guardrails ?? {}), refuseOnPolicyViolation: v } })}
          />

          <Toggle
            label="Enable image rendering"
            checked={Boolean(active?.guardrails?.enableImageRendering)}
            onChange={(v) => updateActive({ guardrails: { ...(active?.guardrails ?? {}), enableImageRendering: v } })}
          />

          <Toggle
            label="Enable live Q&A"
            checked={Boolean(active?.guardrails?.enableLiveQa)}
            onChange={(v) => updateActive({ guardrails: { ...(active?.guardrails ?? {}), enableLiveQa: v } })}
          />

          <div className="pt-2">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">DISALLOWED TOPICS (comma-separated)</div>
            <input
              value={(active?.guardrails?.disallowTopics ?? []).join(", ")}
              onChange={(e) =>
                updateActive({
                  guardrails: {
                    ...(active?.guardrails ?? {}),
                    disallowTopics: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder='e.g. "weapons, self-harm"'
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-3 text-left dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
      <div
        className={[
          "h-6 w-11 rounded-full border transition",
          checked
            ? "border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40"
            : "border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-900",
        ].join(" ")}
      >
        <div
          className={[
            "h-5 w-5 rounded-full bg-white shadow-sm transition translate-y-[1px]",
            checked ? "translate-x-[22px]" : "translate-x-[2px]",
          ].join(" ")}
        />
      </div>
    </button>
  );
}