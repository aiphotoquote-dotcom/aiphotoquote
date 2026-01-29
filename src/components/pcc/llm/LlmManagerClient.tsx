// src/components/pcc/llm/LlmManagerClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

type SaveResult =
  | { ok: true; config: PlatformLlmConfig }
  | { ok: false; error: string; issues?: any; message?: string };

function safeJsonParse<T = any>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function normalizeConfig(input: PlatformLlmConfig): PlatformLlmConfig {
  // Defensive normalization (keep it stable even if storage drift happens)
  const models = input.models ?? ({} as any);
  const prompts = (input as any).prompts ?? (input as any).promptSets ?? {}; // tolerate older field name
  const guardrails = input.guardrails ?? ({} as any);

  const blockedTopics = Array.isArray(guardrails.blockedTopics)
    ? guardrails.blockedTopics.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  return {
    version: (input as any).version ?? 1,
    updatedAt: (input as any).updatedAt ?? null,

    models: {
      estimatorModel: String(models.estimatorModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      qaModel: String(models.qaModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      renderModel: String(models.renderModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
    },

    // NOTE: the type is PlatformLlmConfig; if it uses `prompts`, keep it.
    // We normalize from either prompts/promptSets above.
    prompts: {
      quoteEstimatorSystem: String(prompts.quoteEstimatorSystem ?? "").trim(),
      qaQuestionGeneratorSystem: String(prompts.qaQuestionGeneratorSystem ?? "").trim(),
    } as any,

    guardrails: {
      // if your type omits `mode`, keep it optional; UI still supports it
      mode: (String((guardrails as any).mode ?? "balanced") as any) || "balanced",
      piiHandling: (String((guardrails as any).piiHandling ?? "redact") as any) || "redact",
      maxOutputTokens: Number.isFinite(Number((guardrails as any).maxOutputTokens))
        ? Math.max(200, Math.min(4000, Math.floor(Number((guardrails as any).maxOutputTokens))))
        : 900,
      maxQaQuestions: Number.isFinite(Number((guardrails as any).maxQaQuestions))
        ? Math.max(1, Math.min(10, Math.floor(Number((guardrails as any).maxQaQuestions))))
        : 3,
      blockedTopics,
    } as any,
  } as PlatformLlmConfig;
}

async function apiSave(nextCfg: PlatformLlmConfig): Promise<SaveResult> {
  const res = await fetch("/api/pcc/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: nextCfg }),
  });

  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    return { ok: false, error: data?.error || `HTTP_${res.status}`, message: data?.message, issues: data?.issues };
  }

  const cfg = (data?.config ?? data) as PlatformLlmConfig;
  return { ok: true, config: cfg };
}

export function LlmManagerClient({ initialConfig }: { initialConfig: PlatformLlmConfig }) {
  const initial = useMemo(() => normalizeConfig(initialConfig), [initialConfig]);

  const [cfg, setCfg] = useState<PlatformLlmConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });

  // JSON editor (advanced)
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState(() => JSON.stringify(initial, null, 2));

  function setField(path: string, value: any) {
    setCfg((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split(".");
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ?? (cur[parts[i]] = {});
      cur[parts[parts.length - 1]] = value;
      return normalizeConfig(next);
    });
  }

  async function onSave() {
    setBusy(true);
    setStatus({ kind: "idle", text: "" });

    try {
      const toSave = normalizeConfig(cfg);
      const r = await apiSave(toSave);
      if (!r.ok) {
        setStatus({ kind: "error", text: r.message || r.error || "Save failed" });
        return;
      }

      const normalized = normalizeConfig(r.config);
      setCfg(normalized);
      setRaw(JSON.stringify(normalized, null, 2));
      setStatus({ kind: "ok", text: "Saved." });
    } catch (e: any) {
      setStatus({ kind: "error", text: e?.message ?? "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    setCfg(initial);
    setRaw(JSON.stringify(initial, null, 2));
    setStatus({ kind: "ok", text: "Reset to initial page load state." });
  }

  function onApplyRaw() {
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      setStatus({ kind: "error", text: `Raw JSON error: ${parsed.error}` });
      return;
    }
    setCfg(normalizeConfig(parsed.value as any));
    setStatus({ kind: "ok", text: "Applied raw JSON locally (not saved yet)." });
  }

  const blockedTopicsText = useMemo(() => {
    const g: any = (cfg as any).guardrails ?? {};
    return (Array.isArray(g.blockedTopics) ? g.blockedTopics : []).join("\n");
  }, [cfg]);

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSave}
          disabled={busy}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {busy ? "Saving..." : "Save"}
        </button>

        <button
          onClick={onReset}
          disabled={busy}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          Reset
        </button>

        <button
          onClick={() => setShowRaw((v) => !v)}
          disabled={busy}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          {showRaw ? "Hide Raw JSON" : "Show Raw JSON"}
        </button>

        {status.kind !== "idle" ? (
          <div
            className={[
              "ml-auto rounded-xl px-3 py-2 text-sm",
              status.kind === "ok"
                ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
            ].join(" ")}
          >
            {status.text}
          </div>
        ) : (
          <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">Changes apply immediately after Save.</div>
        )}
      </div>

      {/* Models */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Models</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          These control which model is used for estimating, Q&A generation, and render prompt generation.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Estimator model</label>
            <input
              value={String((cfg as any).models?.estimatorModel ?? "")}
              onChange={(e) => setField("models.estimatorModel", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              placeholder="gpt-4o-mini"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">QA model</label>
            <input
              value={String((cfg as any).models?.qaModel ?? "")}
              onChange={(e) => setField("models.qaModel", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              placeholder="gpt-4o-mini"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Render prompt model</label>
            <input
              value={String((cfg as any).models?.renderModel ?? "")}
              onChange={(e) => setField("models.renderModel", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
      </div>

      {/* Prompt Sets */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Prompt Sets</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Keep these tight. The server will still enforce JSON schema responses and safety behavior.
        </p>

        <div className="mt-4 grid gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Quote estimator system</label>
            <textarea
              value={String((cfg as any).prompts?.quoteEstimatorSystem ?? "")}
              onChange={(e) => setField("prompts.quoteEstimatorSystem", e.target.value)}
              rows={8}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              placeholder="System prompt used by the estimator..."
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">QA question generator system</label>
            <textarea
              value={String((cfg as any).prompts?.qaQuestionGeneratorSystem ?? "")}
              onChange={(e) => setField("prompts.qaQuestionGeneratorSystem", e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              placeholder="System prompt used to generate clarification questions..."
            />
          </div>
        </div>
      </div>

      {/* Guardrails */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Guardrails</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          These are platform-wide controls. Tenants can still have their own toggles, but PCC is the ceiling.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Mode</label>
            <select
              value={String(((cfg as any).guardrails as any)?.mode ?? "balanced")}
              onChange={(e) => setField("guardrails.mode", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
            >
              <option value="strict">strict</option>
              <option value="balanced">balanced</option>
              <option value="permissive">permissive</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">PII handling</label>
            <select
              value={String(((cfg as any).guardrails as any)?.piiHandling ?? "redact")}
              onChange={(e) => setField("guardrails.piiHandling", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
            >
              <option value="redact">redact</option>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Max output tokens</label>
            <input
              type="number"
              value={Number(((cfg as any).guardrails as any)?.maxOutputTokens ?? 900)}
              onChange={(e) => setField("guardrails.maxOutputTokens", Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              min={200}
              max={4000}
              step={50}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">Max QA questions (platform cap)</label>
            <input
              type="number"
              value={Number(((cfg as any).guardrails as any)?.maxQaQuestions ?? 3)}
              onChange={(e) => setField("guardrails.maxQaQuestions", Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
              min={1}
              max={10}
              step={1}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            Blocked topics (one per line)
          </label>
          <textarea
            value={blockedTopicsText}
            onChange={(e) => {
              const lines = e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              setField("guardrails.blockedTopics", lines);
            }}
            rows={6}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
            placeholder={"explosives\nweapons\nfraud\n..."}
          />
        </div>
      </div>

      {/* Raw JSON */}
      {showRaw ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Raw JSON (advanced)</h2>
            <button
              onClick={onApplyRaw}
              disabled={busy}
              className="ml-auto rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Apply JSON locally
            </button>
          </div>

          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            This lets you paste configs quickly. Apply to preview, then Save to persist.
          </p>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={18}
            spellCheck={false}
            className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white/10"
          />
        </div>
      ) : null}
    </div>
  );
}