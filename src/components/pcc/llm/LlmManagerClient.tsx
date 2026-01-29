// src/components/pcc/llm/LlmManagerClient.tsx
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
    extraSystemPreamble?: string;
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
  models: { estimatorModel: string; qaModel: string; renderModel: string };
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
  const parts = raw
    .split(/\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);

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

function promptPreview(s: string, max = 220) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
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

    return {
      estimatorModel: safeStr(models.estimatorModel, "gpt-4o-mini"),
      qaModel: safeStr(models.qaModel, "gpt-4o-mini"),
      renderModel: safeStr(models.renderModel, "gpt-4o-mini"),

      quoteEstimatorSystem: safeStr(prompts.quoteEstimatorSystem, ""),
      qaQuestionGeneratorSystem: safeStr(prompts.qaQuestionGeneratorSystem, ""),
      extraSystemPreamble: safeStr(prompts.extraSystemPreamble, ""),

      mode: (safeStr(guardrails.mode, "balanced") as GuardrailsMode) || "balanced",
      piiHandling: (safeStr(guardrails.piiHandling, "redact") as PiiHandling) || "redact",
      maxQaQuestions: numClamp(guardrails.maxQaQuestions, 1, 10, 3),
      maxOutputTokens: numClamp(guardrails.maxOutputTokens, 200, 4000, 900),

      blockedTopicsText: Array.isArray(guardrails.blockedTopics) ? guardrails.blockedTopics.join("\n") : "",
    };
  }, [cfg]);

  const [estimatorModel, setEstimatorModel] = useState(form.estimatorModel);
  const [qaModel, setQaModel] = useState(form.qaModel);
  const [renderModel, setRenderModel] = useState(form.renderModel);

  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState(form.quoteEstimatorSystem);
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState(form.qaQuestionGeneratorSystem);
  const [extraSystemPreamble, setExtraSystemPreamble] = useState(form.extraSystemPreamble);

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

      setEstimatorModel(safeStr(m.estimatorModel, "gpt-4o-mini"));
      setQaModel(safeStr(m.qaModel, "gpt-4o-mini"));
      setRenderModel(safeStr(m.renderModel, "gpt-4o-mini"));

      setQuoteEstimatorSystem(safeStr(p.quoteEstimatorSystem, ""));
      setQaQuestionGeneratorSystem(safeStr(p.qaQuestionGeneratorSystem, ""));
      setExtraSystemPreamble(safeStr(p.extraSystemPreamble, ""));

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
      const next: PlatformLlmConfig = {
        version: cfg?.version ?? 1,
        updatedAt: cfg?.updatedAt ?? null,
        models: {
          estimatorModel: safeStr(estimatorModel, "gpt-4o-mini"),
          qaModel: safeStr(qaModel, "gpt-4o-mini"),
          renderModel: safeStr(renderModel, "gpt-4o-mini"),
        },
        prompts: {
          extraSystemPreamble: String(extraSystemPreamble ?? ""),
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
      {/* Effective preview (read-only) */}
      {effective ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective config (resolver output)</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                This is what the quote pipeline will actually use right now (after defaults/normalization).
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Models</div>
              <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-200">
                <div>Estimator: <span className="font-mono">{effective.models.estimatorModel}</span></div>
                <div>Q&amp;A: <span className="font-mono">{effective.models.qaModel}</span></div>
                <div>Render prompt: <span className="font-mono">{effective.models.renderModel}</span></div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Guardrails</div>
              <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-200">
                <div>Mode: <span className="font-mono">{effective.guardrails.mode}</span></div>
                <div>PII: <span className="font-mono">{effective.guardrails.piiHandling}</span></div>
                <div>Max Q&amp;A: <span className="font-mono">{effective.guardrails.maxQaQuestions}</span></div>
                <div>Max tokens: <span className="font-mono">{effective.guardrails.maxOutputTokens}</span></div>
                <div>Blocked topics: <span className="font-mono">{effective.guardrails.blockedTopics.length}</span></div>
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

      {/* Existing Config card */}
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
            Used by the quote pipeline + Q&amp;A. (Rendering uses image generation, but we store a model here for prompt
            synthesis later.)
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
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&amp;A model</label>
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
                This doesn’t change image generation. We’ll use this for text prompt synthesis later.
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

      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Prompt sets</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          System prompts. Keep them tight and deterministic.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Extra system preamble</label>
            <textarea
              value={extraSystemPreamble}
              onChange={(e) => setExtraSystemPreamble(e.target.value)}
              className="mt-1 h-40 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="Prepended to BOTH prompts (optional)…"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
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
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&amp;A question generator system</label>
              <textarea
                value={qaQuestionGeneratorSystem}
                onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
                className="mt-1 h-72 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="System prompt used to generate clarifying questions…"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}