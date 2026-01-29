"use client";

import React, { useMemo, useState } from "react";

type GuardrailsMode = "strict" | "balanced" | "permissive";
type PiiHandling = "redact" | "allow" | "deny";

export type PlatformLlmConfig = {
  version?: number;
  updatedAt?: string | null;
  models?: {
    estimatorModel?: string;
    qaModel?: string;
    renderModel?: string;
  };
  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
  };
  guardrails?: {
    mode?: GuardrailsMode;
    piiHandling?: PiiHandling;
    blockedTopics?: string[];
    maxQaQuestions?: number;
    maxOutputTokens?: number;
  };
};

type ApiGetResp = { ok: true; config: PlatformLlmConfig } | { ok: false; error: string; message?: string };
type ApiPostResp =
  | { ok: true; config: PlatformLlmConfig }
  | { ok: false; error: string; message?: string; issues?: any };

async function apiGet(): Promise<ApiGetResp> {
  const res = await fetch("/api/pcc/llm/config", { method: "GET", cache: "no-store" });
  return res.json();
}

async function apiPost(config: PlatformLlmConfig): Promise<ApiPostResp> {
  const res = await fetch("/api/pcc/llm/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config }),
  });
  return res.json();
}

function safeStr(v: unknown, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function numClamp(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeBlockedTopics(raw: string): string[] {
  // one per line OR comma-separated
  const parts = raw
    .split(/\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // de-dupe (case-insensitive)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function configToForm(cfg: PlatformLlmConfig) {
  const models = cfg?.models ?? {};
  const prompts = cfg?.prompts ?? {};
  const guardrails = cfg?.guardrails ?? {};

  return {
    estimatorModel: safeStr(models.estimatorModel, "gpt-4o-mini"),
    qaModel: safeStr(models.qaModel, "gpt-4o-mini"),
    renderModel: safeStr(models.renderModel, "gpt-4o-mini"),

    quoteEstimatorSystem: safeStr(prompts.quoteEstimatorSystem, ""),
    qaQuestionGeneratorSystem: safeStr(prompts.qaQuestionGeneratorSystem, ""),

    mode: (safeStr(guardrails.mode, "balanced") as GuardrailsMode) || "balanced",
    piiHandling: (safeStr(guardrails.piiHandling, "redact") as PiiHandling) || "redact",

    maxQaQuestions: numClamp(guardrails.maxQaQuestions, 1, 10, 3),
    maxOutputTokens: numClamp(guardrails.maxOutputTokens, 200, 4000, 900),

    blockedTopicsText: Array.isArray(guardrails.blockedTopics) ? guardrails.blockedTopics.join("\n") : "",
  };
}

function formToConfig(args: {
  base: PlatformLlmConfig;
  estimatorModel: string;
  qaModel: string;
  renderModel: string;
  quoteEstimatorSystem: string;
  qaQuestionGeneratorSystem: string;
  mode: GuardrailsMode;
  piiHandling: PiiHandling;
  maxQaQuestions: number;
  maxOutputTokens: number;
  blockedTopicsText: string;
}): PlatformLlmConfig {
  const {
    base,
    estimatorModel,
    qaModel,
    renderModel,
    quoteEstimatorSystem,
    qaQuestionGeneratorSystem,
    mode,
    piiHandling,
    maxQaQuestions,
    maxOutputTokens,
    blockedTopicsText,
  } = args;

  return {
    version: base?.version ?? 1,
    updatedAt: base?.updatedAt ?? null,
    models: {
      estimatorModel: safeStr(estimatorModel, "gpt-4o-mini"),
      qaModel: safeStr(qaModel, "gpt-4o-mini"),
      renderModel: safeStr(renderModel, "gpt-4o-mini"),
    },
    prompts: {
      quoteEstimatorSystem: String(quoteEstimatorSystem ?? ""),
      qaQuestionGeneratorSystem: String(qaQuestionGeneratorSystem ?? ""),
    },
    guardrails: {
      mode,
      piiHandling,
      maxQaQuestions: numClamp(maxQaQuestions, 1, 10, 3),
      maxOutputTokens: numClamp(maxOutputTokens, 200, 4000, 900),
      blockedTopics: normalizeBlockedTopics(blockedTopicsText),
    },
  };
}

function stableStringify(obj: any) {
  // Good enough for UI dirty-check: normalize config -> JSON compare
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function LlmManagerClient({ initialConfig }: { initialConfig: PlatformLlmConfig }) {
  const [cfg, setCfg] = useState<PlatformLlmConfig>(initialConfig ?? {});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // baseline form snapshot derived from cfg
  const baseline = useMemo(() => configToForm(cfg ?? {}), [cfg]);

  // editable inputs (start from baseline ONCE)
  const [estimatorModel, setEstimatorModel] = useState(baseline.estimatorModel);
  const [qaModel, setQaModel] = useState(baseline.qaModel);
  const [renderModel, setRenderModel] = useState(baseline.renderModel);

  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState(baseline.quoteEstimatorSystem);
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState(baseline.qaQuestionGeneratorSystem);

  const [mode, setMode] = useState<GuardrailsMode>(baseline.mode);
  const [piiHandling, setPiiHandling] = useState<PiiHandling>(baseline.piiHandling);
  const [maxQaQuestions, setMaxQaQuestions] = useState<number>(baseline.maxQaQuestions);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number>(baseline.maxOutputTokens);
  const [blockedTopicsText, setBlockedTopicsText] = useState(baseline.blockedTopicsText);

  // current form snapshot
  const currentConfig = useMemo(() => {
    return formToConfig({
      base: cfg,
      estimatorModel,
      qaModel,
      renderModel,
      quoteEstimatorSystem,
      qaQuestionGeneratorSystem,
      mode,
      piiHandling,
      maxQaQuestions,
      maxOutputTokens,
      blockedTopicsText,
    });
  }, [
    cfg,
    estimatorModel,
    qaModel,
    renderModel,
    quoteEstimatorSystem,
    qaQuestionGeneratorSystem,
    mode,
    piiHandling,
    maxQaQuestions,
    maxOutputTokens,
    blockedTopicsText,
  ]);

  // dirty-check by comparing normalized “form-shaped” data, not timestamps/version
  const isDirty = useMemo(() => {
    const a = formToConfig({
      base: { version: 1, updatedAt: null }, // ignore baseline version/updatedAt
      ...baseline,
      maxQaQuestions: baseline.maxQaQuestions,
      maxOutputTokens: baseline.maxOutputTokens,
      mode: baseline.mode,
      piiHandling: baseline.piiHandling,
      blockedTopicsText: baseline.blockedTopicsText,
    } as any);

    const b = formToConfig({
      base: { version: 1, updatedAt: null }, // ignore version/updatedAt
      estimatorModel,
      qaModel,
      renderModel,
      quoteEstimatorSystem,
      qaQuestionGeneratorSystem,
      mode,
      piiHandling,
      maxQaQuestions,
      maxOutputTokens,
      blockedTopicsText,
    } as any);

    // Only compare the “meaningful” payload portions
    const aCmp = { models: a.models, prompts: a.prompts, guardrails: a.guardrails };
    const bCmp = { models: b.models, prompts: b.prompts, guardrails: b.guardrails };

    return stableStringify(aCmp) !== stableStringify(bCmp);
  }, [
    baseline,
    estimatorModel,
    qaModel,
    renderModel,
    quoteEstimatorSystem,
    qaQuestionGeneratorSystem,
    mode,
    piiHandling,
    maxQaQuestions,
    maxOutputTokens,
    blockedTopicsText,
  ]);

  function resetToSaved() {
    setMsg(null);
    const b = configToForm(cfg ?? {});
    setEstimatorModel(b.estimatorModel);
    setQaModel(b.qaModel);
    setRenderModel(b.renderModel);

    setQuoteEstimatorSystem(b.quoteEstimatorSystem);
    setQaQuestionGeneratorSystem(b.qaQuestionGeneratorSystem);

    setMode(b.mode);
    setPiiHandling(b.piiHandling);
    setMaxQaQuestions(b.maxQaQuestions);
    setMaxOutputTokens(b.maxOutputTokens);
    setBlockedTopicsText(b.blockedTopicsText);
  }

  async function refresh() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await apiGet();
      if (!("ok" in r) || !r.ok) throw new Error((r as any)?.message || (r as any)?.error || "Failed to load.");
      setCfg(r.config ?? {});
      setMsg({ kind: "ok", text: "Loaded latest config." });

      // Reset inputs to match loaded config (authoritative)
      const b = configToForm(r.config ?? {});
      setEstimatorModel(b.estimatorModel);
      setQaModel(b.qaModel);
      setRenderModel(b.renderModel);

      setQuoteEstimatorSystem(b.quoteEstimatorSystem);
      setQaQuestionGeneratorSystem(b.qaQuestionGeneratorSystem);

      setMode(b.mode);
      setPiiHandling(b.piiHandling);
      setMaxQaQuestions(b.maxQaQuestions);
      setMaxOutputTokens(b.maxOutputTokens);
      setBlockedTopicsText(b.blockedTopicsText);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const r = await apiPost(currentConfig);
      if (!("ok" in r) || !r.ok) {
        const details = (r as any)?.message || (r as any)?.error || "Save failed.";
        throw new Error(details);
      }

      // Server is authoritative (version bump + updatedAt)
      setCfg(r.config ?? currentConfig);

      // Snap inputs to saved config (so dirty resets cleanly)
      const b = configToForm(r.config ?? currentConfig);
      setEstimatorModel(b.estimatorModel);
      setQaModel(b.qaModel);
      setRenderModel(b.renderModel);

      setQuoteEstimatorSystem(b.quoteEstimatorSystem);
      setQaQuestionGeneratorSystem(b.qaQuestionGeneratorSystem);

      setMode(b.mode);
      setPiiHandling(b.piiHandling);
      setMaxQaQuestions(b.maxQaQuestions);
      setMaxOutputTokens(b.maxOutputTokens);
      setBlockedTopicsText(b.blockedTopicsText);

      setMsg({ kind: "ok", text: "Saved." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  const updatedAt = cfg?.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : null;
  const saveDisabled = saving || loading || !isDirty;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Config</div>
              {isDirty ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                  Unsaved changes
                </span>
              ) : null}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Version {cfg?.version ?? 1}
              {updatedAt ? ` • Updated ${updatedAt}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resetToSaved}
              disabled={loading || saving || !isDirty}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
              title="Reset form fields back to the last saved config"
            >
              Reset
            </button>

            <button
              onClick={refresh}
              disabled={loading || saving}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>

            <button
              onClick={save}
              disabled={saveDisabled}
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              title={!isDirty ? "No changes to save" : "Save changes"}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {msg ? (
          <div
            className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
              msg.kind === "ok"
                ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100"
            }`}
          >
            {msg.text}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Models</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            These are used by the quote pipeline + Q&A. (Rendering uses image generation, but we still store a model here
            for text prompt generation later.)
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Estimator model</label>
              <input
                value={estimatorModel}
                onChange={(e) => setEstimatorModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="gpt-4o-mini"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A model</label>
              <input
                value={qaModel}
                onChange={(e) => setQaModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="gpt-4o-mini"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render prompt model</label>
              <input
                value={renderModel}
                onChange={(e) => setRenderModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="gpt-4o-mini"
              />
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This doesn’t change image generation (that uses the image model). We’ll use this for text prompt
                synthesis later.
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Guardrails</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Lightweight controls that influence platform behavior (not a full safety system).
          </p>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as GuardrailsMode)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  <option value="strict">strict</option>
                  <option value="balanced">balanced</option>
                  <option value="permissive">permissive</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">PII handling</label>
                <select
                  value={piiHandling}
                  onChange={(e) => setPiiHandling(e.target.value as PiiHandling)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  <option value="redact">redact</option>
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Max Q&A questions</label>
                <input
                  type="number"
                  value={maxQaQuestions}
                  onChange={(e) => setMaxQaQuestions(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  min={1}
                  max={10}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Max output tokens</label>
                <input
                  type="number"
                  value={maxOutputTokens}
                  onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  min={200}
                  max={4000}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Blocked topics</label>
              <textarea
                value={blockedTopicsText}
                onChange={(e) => setBlockedTopicsText(e.target.value)}
                className="mt-1 h-32 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder={"One per line (or comma-separated)\nexample:\ncredit card\nssn\npassword"}
              />
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                One per line (or comma-separated). Stored as an array.
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Prompt sets</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          These are full system prompts. Keep them tight and deterministic.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quote estimator system</label>
            <textarea
              value={quoteEstimatorSystem}
              onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
              className="mt-1 h-72 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="System prompt used for estimate generation…"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A question generator system</label>
            <textarea
              value={qaQuestionGeneratorSystem}
              onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
              className="mt-1 h-72 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="System prompt used to generate clarifying questions…"
            />
          </div>
        </div>
      </section>
    </div>
  );
}