// src/components/pcc/llm/TenantLlmBehaviorAdvanced.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type GuardrailsMode = "strict" | "balanced" | "permissive";
type PiiHandling = "redact" | "allow" | "deny";

type TenantLlmOverrides = {
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
  // Optional (not necessarily shown in UI, but supported by effective merge)
  maxQaQuestions?: number;
  updatedAt?: string;
};

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: any[] }
  | { ok: false; error: string; message?: string };

type TenantLlmResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      // read-only summaries (for context)
      platform: {
        models: { estimatorModel: string; qaModel: string; renderModel: string };
        prompts: { quoteEstimatorSystem: string; qaQuestionGeneratorSystem: string; extraSystemPreamble?: string };
        guardrails: {
          mode: GuardrailsMode;
          piiHandling: PiiHandling;
          blockedTopics: string[];
          maxQaQuestions: number;
          maxOutputTokens: number;
        };
      };
      // editable
      tenant: TenantLlmOverrides;
      effective: {
        models: { estimatorModel: string; qaModel: string; renderModel: string };
        prompts: { quoteEstimatorSystem: string; qaQuestionGeneratorSystem: string; extraSystemPreamble?: string };
        guardrails: {
          mode: GuardrailsMode;
          piiHandling: PiiHandling;
          blockedTopics: string[];
          maxQaQuestions: number;
          maxOutputTokens: number;
        };
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 120 chars: ${text.slice(0, 120)}`
    );
  }
  return (await res.json()) as T;
}

function clampText(s: string, max = 20000) {
  const v = String(s ?? "");
  return v.length > max ? v.slice(0, max) : v;
}

export default function TenantLlmBehaviorAdvanced() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [platformSummary, setPlatformSummary] = useState<TenantLlmResp extends { ok: true } ? any : any>(null);
  const [effectiveSummary, setEffectiveSummary] = useState<TenantLlmResp extends { ok: true } ? any : any>(null);

  // Editable overrides
  const [estimatorModel, setEstimatorModel] = useState("");
  const [qaModel, setQaModel] = useState("");
  const [renderModel, setRenderModel] = useState("");

  const [extraSystemPreamble, setExtraSystemPreamble] = useState("");
  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState("");
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  async function ensureTenantContext(): Promise<string | null> {
    // This GET is the "cookie initializer" (same pattern as AI Policy page)
    const res = await fetch("/api/tenant/context", { cache: "no-store" });
    const data = await safeJson<ContextResp>(res);

    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");
    setActiveTenantId(data.activeTenantId ?? null);
    return data.activeTenantId ?? null;
  }

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      const tid = await ensureTenantContext();
      if (!tid) {
        // No active tenant selected yet
        setRole(null);
        setPlatformSummary(null);
        setEffectiveSummary(null);
        return;
      }

      const res = await fetch("/api/tenant/llm", { cache: "no-store" });
      const data = await safeJson<TenantLlmResp>(res);

      if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant LLM settings");

      setRole(data.role);
      setPlatformSummary(data.platform);
      setEffectiveSummary(data.effective);

      const t = data.tenant ?? {};
      setEstimatorModel(String(t.models?.estimatorModel ?? ""));
      setQaModel(String(t.models?.qaModel ?? ""));
      setRenderModel(String(t.models?.renderModel ?? ""));

      setExtraSystemPreamble(String(t.prompts?.extraSystemPreamble ?? ""));
      setQuoteEstimatorSystem(String(t.prompts?.quoteEstimatorSystem ?? ""));
      setQaQuestionGeneratorSystem(String(t.prompts?.qaQuestionGeneratorSystem ?? ""));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setSaving(true);

    try {
      const tid = await ensureTenantContext();
      if (!tid) throw new Error("Select a tenant first.");

      const payload: TenantLlmOverrides = {
        models: {
          ...(estimatorModel.trim() ? { estimatorModel: estimatorModel.trim() } : {}),
          ...(qaModel.trim() ? { qaModel: qaModel.trim() } : {}),
          ...(renderModel.trim() ? { renderModel: renderModel.trim() } : {}),
        },
        prompts: {
          ...(extraSystemPreamble.trim() ? { extraSystemPreamble: clampText(extraSystemPreamble) } : {}),
          ...(quoteEstimatorSystem.trim() ? { quoteEstimatorSystem: clampText(quoteEstimatorSystem) } : {}),
          ...(qaQuestionGeneratorSystem.trim()
            ? { qaQuestionGeneratorSystem: clampText(qaQuestionGeneratorSystem) }
            : {}),
        },
      };

      // Clean empty objects
      if (payload.models && Object.keys(payload.models).length === 0) delete payload.models;
      if (payload.prompts && Object.keys(payload.prompts).length === 0) delete payload.prompts;

      const res = await fetch("/api/tenant/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await safeJson<TenantLlmResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Save failed");

      setMsg("Saved.");
      setRole(data.role);
      setPlatformSummary(data.platform);
      setEffectiveSummary(data.effective);

      const t = data.tenant ?? {};
      setEstimatorModel(String(t.models?.estimatorModel ?? ""));
      setQaModel(String(t.models?.qaModel ?? ""));
      setRenderModel(String(t.models?.renderModel ?? ""));
      setExtraSystemPreamble(String(t.prompts?.extraSystemPreamble ?? ""));
      setQuoteEstimatorSystem(String(t.prompts?.quoteEstimatorSystem ?? ""));
      setQaQuestionGeneratorSystem(String(t.prompts?.qaQuestionGeneratorSystem ?? ""));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant LLM settings</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Tenant overrides apply on top of industry + platform defaults.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
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

        {!activeTenantId ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            Select a tenant first. (Use the <span className="font-semibold">Menu</span> button → Tenant switcher.)
          </div>
        ) : null}

        {msg ? (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100">
            {msg}
          </div>
        ) : null}

        {err ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {/* Read-only context */}
      {platformSummary ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="font-semibold text-gray-900 dark:text-gray-100">Platform summary (read-only)</div>
          <div className="mt-2 grid gap-2 text-xs text-gray-700 dark:text-gray-300">
            <div>
              <span className="font-semibold">Models:</span>{" "}
              {platformSummary.models.estimatorModel} • {platformSummary.models.qaModel} •{" "}
              {platformSummary.models.renderModel}
            </div>
            <div>
              <span className="font-semibold">Guardrails (locked):</span>{" "}
              {platformSummary.guardrails.mode} • PII {platformSummary.guardrails.piiHandling} • max Q’s{" "}
              {platformSummary.guardrails.maxQaQuestions} • max tokens {platformSummary.guardrails.maxOutputTokens}
            </div>
          </div>
        </div>
      ) : null}

      {/* Editable overrides */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenant overrides</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Leave a field blank to inherit from industry/platform.
        </div>

        {!canEdit ? (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-200">
            You can view this, but only <span className="font-mono">owner</span> or <span className="font-mono">admin</span>{" "}
            can edit.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Estimator model override</label>
              <input
                value={estimatorModel}
                onChange={(e) => setEstimatorModel(e.target.value)}
                disabled={!canEdit}
                placeholder="(inherit)"
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A model override</label>
              <input
                value={qaModel}
                onChange={(e) => setQaModel(e.target.value)}
                disabled={!canEdit}
                placeholder="(inherit)"
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render prompt model override</label>
            <input
              value={renderModel}
              onChange={(e) => setRenderModel(e.target.value)}
              disabled={!canEdit}
              placeholder="(inherit)"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This is only used for prompt synthesis; image generation is separate.
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Extra system preamble override (optional)
            </label>
            <textarea
              value={extraSystemPreamble}
              onChange={(e) => setExtraSystemPreamble(e.target.value)}
              disabled={!canEdit}
              placeholder="(inherit)"
              rows={4}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quote estimator system override</label>
              <textarea
                value={quoteEstimatorSystem}
                onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
                disabled={!canEdit}
                placeholder="(inherit)"
                rows={10}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Q&A question generator system override
              </label>
              <textarea
                value={qaQuestionGeneratorSystem}
                onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
                disabled={!canEdit}
                placeholder="(inherit)"
                rows={10}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Optional effective summary */}
      {effectiveSummary ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="font-semibold text-gray-900 dark:text-gray-100">Effective config (after merge)</div>
          <div className="mt-2 grid gap-2 text-xs text-gray-700 dark:text-gray-300">
            <div>
              <span className="font-semibold">Models:</span> {effectiveSummary.models.estimatorModel} •{" "}
              {effectiveSummary.models.qaModel} • {effectiveSummary.models.renderModel}
            </div>
            <div>
              <span className="font-semibold">Guardrails:</span> {effectiveSummary.guardrails.mode} • PII{" "}
              {effectiveSummary.guardrails.piiHandling} • max Q’s {effectiveSummary.guardrails.maxQaQuestions} • max tokens{" "}
              {effectiveSummary.guardrails.maxOutputTokens}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}