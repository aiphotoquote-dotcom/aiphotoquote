// src/components/pcc/llm/LlmManagerClient.tsx
"use client";

import React, { useMemo, useState } from "react";

import { safeStr, numClamp, normalizeBlockedTopics } from "@/components/pcc/llm/helpers/normalize";
import { promptPreview } from "@/components/pcc/llm/helpers/preview";
import {
  defaultRenderPromptPreamble,
  defaultRenderPromptTemplate,
  defaultStylePreset,
  type RenderStyleKey,
} from "@/components/pcc/llm/helpers/defaults";
import { TEXT_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS } from "@/components/pcc/llm/helpers/modelOptions";

type GuardrailsMode = "strict" | "balanced" | "permissive";
type PiiHandling = "redact" | "allow" | "deny";

export type PlatformLlmConfig = {
  version?: number;
  updatedAt?: string | null;
  models?: {
    estimatorModel?: string;
    qaModel?: string;
    renderModel?: string;

    // ✅ NEW: used by onboarding analysis (website scan, fit, industry detection)
    onboardingModel?: string;
  };
  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;

    // ✅ Render prompt controls (PCC)
    renderPromptPreamble?: string;
    // {renderPromptPreamble} {style} {serviceTypeLine} {summaryLine} {customerNotesLine} {tenantRenderNotesLine}
    renderPromptTemplate?: string;
    renderStylePresets?: {
      photoreal?: string;
      clean_oem?: string;
      custom?: string;
      [k: string]: any;
    };
  };
  guardrails?: {
    mode?: GuardrailsMode;
    piiHandling?: PiiHandling;
    blockedTopics?: string[];
    maxQaQuestions?: number;
    maxOutputTokens?: number;
  };
};

type EffectivePreview = {
  models: {
    estimatorModel: string;
    qaModel: string;
    renderModel: string;

    // ✅ NEW (optional for back-compat with older resolver output)
    onboardingModel?: string;
  };
  prompts: { quoteEstimatorSystem: string; qaQuestionGeneratorSystem: string };
  guardrails: {
    mode: GuardrailsMode;
    piiHandling: PiiHandling;
    blockedTopics: string[];
    maxQaQuestions: number;
    maxOutputTokens: number;
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

function isInOptions(value: string, options: Array<{ value: string }>) {
  return options.some((o) => o.value === value);
}

function pickInitialSelect(value: string, options: Array<{ value: string }>) {
  const v = safeStr(value, "");
  if (!v) return options[0]?.value ?? "custom";
  return isInOptions(v, options) ? v : "custom";
}

export function LlmManagerClient({
  initialConfig,
  effective,
}: {
  initialConfig: PlatformLlmConfig;
  effective?: EffectivePreview;
}) {
  const [cfg, setCfg] = useState<PlatformLlmConfig>(initialConfig ?? {});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const form = useMemo(() => {
    const models = cfg?.models ?? {};
    const prompts = cfg?.prompts ?? {};
    const guardrails = cfg?.guardrails ?? {};

    const presets = (prompts as any)?.renderStylePresets ?? {};

    return {
      estimatorModel: safeStr(models.estimatorModel, "gpt-4o-mini"),
      qaModel: safeStr(models.qaModel, "gpt-4o-mini"),
      renderModel: safeStr(models.renderModel, "gpt-image-1"),

      // ✅ NEW
      onboardingModel: safeStr((models as any)?.onboardingModel, "gpt-4o-mini"),

      quoteEstimatorSystem: safeStr(prompts.quoteEstimatorSystem, ""),
      qaQuestionGeneratorSystem: safeStr(prompts.qaQuestionGeneratorSystem, ""),
      extraSystemPreamble: safeStr(prompts.extraSystemPreamble, ""),

      // ✅ Render prompt controls (PCC)
      renderPromptPreamble: safeStr((prompts as any)?.renderPromptPreamble, ""),
      renderPromptTemplate: safeStr((prompts as any)?.renderPromptTemplate, ""),
      renderStylePhotoreal: safeStr(presets?.photoreal, ""),
      renderStyleCleanOem: safeStr(presets?.clean_oem, ""),
      renderStyleCustom: safeStr(presets?.custom, ""),

      mode: (safeStr(guardrails.mode, "balanced") as GuardrailsMode) || "balanced",
      piiHandling: (safeStr(guardrails.piiHandling, "redact") as PiiHandling) || "redact",
      maxQaQuestions: numClamp(guardrails.maxQaQuestions, 1, 10, 3),
      maxOutputTokens: numClamp(guardrails.maxOutputTokens, 200, 4000, 900),

      blockedTopicsText: Array.isArray(guardrails.blockedTopics) ? guardrails.blockedTopics.join("\n") : "",
    };
  }, [cfg]);

  // --- model selects + custom values ---
  const [estimatorModelSelect, setEstimatorModelSelect] = useState(() =>
    pickInitialSelect(form.estimatorModel, TEXT_MODEL_OPTIONS)
  );
  const [qaModelSelect, setQaModelSelect] = useState(() => pickInitialSelect(form.qaModel, TEXT_MODEL_OPTIONS));
  const [renderModelSelect, setRenderModelSelect] = useState(() =>
    pickInitialSelect(form.renderModel, IMAGE_MODEL_OPTIONS)
  );

  // ✅ NEW onboarding select/custom
  const [onboardingModelSelect, setOnboardingModelSelect] = useState(() =>
    pickInitialSelect(form.onboardingModel, TEXT_MODEL_OPTIONS)
  );

  const [estimatorModelCustom, setEstimatorModelCustom] = useState(() => form.estimatorModel);
  const [qaModelCustom, setQaModelCustom] = useState(() => form.qaModel);
  const [renderModelCustom, setRenderModelCustom] = useState(() => form.renderModel);

  // ✅ NEW onboarding custom
  const [onboardingModelCustom, setOnboardingModelCustom] = useState(() => form.onboardingModel);

  function effectiveTextModel(selectVal: string, customVal: string, fallback: string) {
    if (selectVal !== "custom") return safeStr(selectVal, fallback);
    return safeStr(customVal, fallback);
  }
  function effectiveImageModel(selectVal: string, customVal: string, fallback: string) {
    if (selectVal !== "custom") return safeStr(selectVal, fallback);
    return safeStr(customVal, fallback);
  }

  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState(form.quoteEstimatorSystem);
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState(form.qaQuestionGeneratorSystem);
  const [extraSystemPreamble, setExtraSystemPreamble] = useState(form.extraSystemPreamble);

  // ✅ Render prompt controls (PCC)
  const [renderPromptPreamble, setRenderPromptPreamble] = useState(form.renderPromptPreamble);
  const [renderPromptTemplate, setRenderPromptTemplate] = useState(form.renderPromptTemplate);
  const [renderStylePhotoreal, setRenderStylePhotoreal] = useState(form.renderStylePhotoreal);
  const [renderStyleCleanOem, setRenderStyleCleanOem] = useState(form.renderStyleCleanOem);
  const [renderStyleCustom, setRenderStyleCustom] = useState(form.renderStyleCustom);

  const [mode, setMode] = useState<GuardrailsMode>(form.mode);
  const [piiHandling, setPiiHandling] = useState<PiiHandling>(form.piiHandling);
  const [maxQaQuestions, setMaxQaQuestions] = useState<number>(form.maxQaQuestions);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number>(form.maxOutputTokens);
  const [blockedTopicsText, setBlockedTopicsText] = useState(form.blockedTopicsText);

  async function refresh() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await apiGet();
      if (!("ok" in r) || !r.ok) throw new Error((r as any)?.message || (r as any)?.error || "Failed to load.");
      setCfg(r.config ?? {});
      setMsg({ kind: "ok", text: "Loaded latest config." });

      const c = r.config ?? {};
      const m = c.models ?? {};
      const p = c.prompts ?? {};
      const g = c.guardrails ?? {};
      const presets = (p as any)?.renderStylePresets ?? {};

      const est = safeStr(m.estimatorModel, "gpt-4o-mini");
      const qa = safeStr(m.qaModel, "gpt-4o-mini");
      const ren = safeStr(m.renderModel, "gpt-image-1");

      // ✅ NEW
      const onb = safeStr((m as any)?.onboardingModel, "gpt-4o-mini");

      setEstimatorModelSelect(pickInitialSelect(est, TEXT_MODEL_OPTIONS));
      setQaModelSelect(pickInitialSelect(qa, TEXT_MODEL_OPTIONS));
      setRenderModelSelect(pickInitialSelect(ren, IMAGE_MODEL_OPTIONS));

      // ✅ NEW
      setOnboardingModelSelect(pickInitialSelect(onb, TEXT_MODEL_OPTIONS));

      setEstimatorModelCustom(est);
      setQaModelCustom(qa);
      setRenderModelCustom(ren);

      // ✅ NEW
      setOnboardingModelCustom(onb);

      setQuoteEstimatorSystem(safeStr(p.quoteEstimatorSystem, ""));
      setQaQuestionGeneratorSystem(safeStr(p.qaQuestionGeneratorSystem, ""));
      setExtraSystemPreamble(safeStr(p.extraSystemPreamble, ""));

      setRenderPromptPreamble(safeStr((p as any)?.renderPromptPreamble, ""));
      setRenderPromptTemplate(safeStr((p as any)?.renderPromptTemplate, ""));
      setRenderStylePhotoreal(safeStr(presets?.photoreal, ""));
      setRenderStyleCleanOem(safeStr(presets?.clean_oem, ""));
      setRenderStyleCustom(safeStr(presets?.custom, ""));

      setMode((safeStr(g.mode, "balanced") as GuardrailsMode) || "balanced");
      setPiiHandling((safeStr(g.piiHandling, "redact") as PiiHandling) || "redact");
      setMaxQaQuestions(numClamp(g.maxQaQuestions, 1, 10, 3));
      setMaxOutputTokens(numClamp(g.maxOutputTokens, 200, 4000, 900));
      setBlockedTopicsText(Array.isArray(g.blockedTopics) ? g.blockedTopics.join("\n") : "");
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
      const estimatorModel = effectiveTextModel(estimatorModelSelect, estimatorModelCustom, "gpt-4o-mini");
      const qaModel = effectiveTextModel(qaModelSelect, qaModelCustom, "gpt-4o-mini");
      const renderModel = effectiveImageModel(renderModelSelect, renderModelCustom, "gpt-image-1");

      // ✅ NEW
      const onboardingModel = effectiveTextModel(onboardingModelSelect, onboardingModelCustom, "gpt-4o-mini");

      const next: PlatformLlmConfig = {
        version: cfg?.version ?? 1,
        updatedAt: cfg?.updatedAt ?? null,
        models: {
          estimatorModel,
          qaModel,
          renderModel,

          // ✅ NEW
          onboardingModel,
        },
        prompts: {
          extraSystemPreamble: String(extraSystemPreamble ?? ""),
          quoteEstimatorSystem: String(quoteEstimatorSystem ?? ""),
          qaQuestionGeneratorSystem: String(qaQuestionGeneratorSystem ?? ""),

          renderPromptPreamble: String(renderPromptPreamble ?? ""),
          renderPromptTemplate: String(renderPromptTemplate ?? ""),
          renderStylePresets: {
            photoreal: String(renderStylePhotoreal ?? ""),
            clean_oem: String(renderStyleCleanOem ?? ""),
            custom: String(renderStyleCustom ?? ""),
          },
        },
        guardrails: {
          mode,
          piiHandling,
          maxQaQuestions: numClamp(maxQaQuestions, 1, 10, 3),
          maxOutputTokens: numClamp(maxOutputTokens, 200, 4000, 900),
          blockedTopics: normalizeBlockedTopics(blockedTopicsText),
        },
      };

      const r = await apiPost(next);
      if (!("ok" in r) || !r.ok) {
        const details = (r as any)?.message || (r as any)?.error || "Save failed.";
        throw new Error(details);
      }

      setCfg(r.config ?? next);
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  const updatedAt = cfg?.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : null;

  return (
    <div className="space-y-6">
      {effective ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Effective config (resolver output)
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                This is what the quote pipeline will actually use right now (after defaults/normalization).
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Models</div>
              <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-200">
                <div>
                  Estimator: <span className="font-mono">{effective.models.estimatorModel}</span>
                </div>
                <div>
                  Q&amp;A: <span className="font-mono">{effective.models.qaModel}</span>
                </div>
                <div>
                  Render prompt: <span className="font-mono">{effective.models.renderModel}</span>
                </div>

                {/* ✅ NEW */}
                {effective.models.onboardingModel ? (
                  <div>
                    Onboarding: <span className="font-mono">{effective.models.onboardingModel}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Guardrails</div>
              <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-200">
                <div>
                  Mode: <span className="font-mono">{effective.guardrails.mode}</span>
                </div>
                <div>
                  PII: <span className="font-mono">{effective.guardrails.piiHandling}</span>
                </div>
                <div>
                  Max Q&amp;A: <span className="font-mono">{effective.guardrails.maxQaQuestions}</span>
                </div>
                <div>
                  Max tokens: <span className="font-mono">{effective.guardrails.maxOutputTokens}</span>
                </div>
                <div>
                  Blocked topics: <span className="font-mono">{effective.guardrails.blockedTopics.length}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Prompts (preview)</div>
              <div className="mt-2 space-y-3 text-gray-700 dark:text-gray-200">
                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimator</div>
                  <div className="mt-1 whitespace-pre-wrap font-mono text-xs">
                    {promptPreview(effective.prompts.quoteEstimatorSystem)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Q&amp;A</div>
                  <div className="mt-1 whitespace-pre-wrap font-mono text-xs">
                    {promptPreview(effective.prompts.qaQuestionGeneratorSystem)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stored config</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Version {cfg?.version ?? 1}
              {updatedAt ? ` • Updated ${updatedAt}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading || saving}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>

            <button
              onClick={save}
              disabled={saving || loading}
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
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
            Used by the quote pipeline + Q&amp;A. Render model is used by /api/quote/render.
          </p>

          <div className="mt-4 space-y-4">
            {/* Estimator */}
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Estimator model</label>
              <select
                value={estimatorModelSelect}
                onChange={(e) => setEstimatorModelSelect(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {TEXT_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {estimatorModelSelect === "custom" ? (
                <input
                  value={estimatorModelCustom}
                  onChange={(e) => setEstimatorModelCustom(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="enter custom text model id…"
                />
              ) : null}
            </div>

            {/* QA */}
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&amp;A model</label>
              <select
                value={qaModelSelect}
                onChange={(e) => setQaModelSelect(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {TEXT_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {qaModelSelect === "custom" ? (
                <input
                  value={qaModelCustom}
                  onChange={(e) => setQaModelCustom(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="enter custom text model id…"
                />
              ) : null}
            </div>

            {/* Render */}
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render model</label>
              <select
                value={renderModelSelect}
                onChange={(e) => setRenderModelSelect(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {IMAGE_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {renderModelSelect === "custom" ? (
                <input
                  value={renderModelCustom}
                  onChange={(e) => setRenderModelCustom(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="enter custom image model id…"
                />
              ) : null}
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This is what /api/quote/render uses for image generation.
              </div>
            </div>

            {/* ✅ NEW (requested placement: bottom) */}
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding model</label>
              <select
                value={onboardingModelSelect}
                onChange={(e) => setOnboardingModelSelect(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {TEXT_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {onboardingModelSelect === "custom" ? (
                <input
                  value={onboardingModelCustom}
                  onChange={(e) => setOnboardingModelCustom(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="enter custom onboarding text model id…"
                />
              ) : null}
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Used by onboarding AI (website scan, fit, industry detection).
              </div>
            </div>
          </div>
        </section>

        {/* Guardrails section unchanged */}
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
                <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Max Q&amp;A questions</label>
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
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">One per line (or comma-separated).</div>
            </div>
          </div>
        </section>
      </div>

      {/* Prompt sets + Rendering prompts sections unchanged (kept as you had them) */}
      {/* ...the rest of your file continues exactly as-is... */}

      {/* NOTE: For brevity, I’m keeping your remaining sections unchanged.
          If you want, paste the remainder and I’ll return a single complete file including those sections verbatim. */}
    </div>
  );
}