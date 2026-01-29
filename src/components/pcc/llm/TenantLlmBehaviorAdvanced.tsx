// src/components/pcc/llm/TenantLlmBehaviorAdvanced.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type RespOk = {
  ok: true;
  tenantId: string;
  role: "owner" | "admin" | "member";
  platform: any;
  overrides: any | null;
  effective: {
    models: { estimatorModel: string; qaModel: string; renderModel: string };
    prompts: {
      quoteEstimatorSystem: string;
      qaQuestionGeneratorSystem: string;
      extraSystemPreamble: string;
    };
    guardrails: {
      mode: "strict" | "balanced" | "permissive";
      piiHandling: "redact" | "allow" | "deny";
      blockedTopics: string[];
      maxQaQuestions: number;
      maxOutputTokens: number;
    };
  };
};

type Resp = RespOk | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export default function TenantLlmBehaviorAdvanced() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);
  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  const [data, setData] = useState<RespOk | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Tenant-editable fields (overrides)
  const [estimatorModel, setEstimatorModel] = useState("");
  const [qaModel, setQaModel] = useState("");
  const [extraSystemPreamble, setExtraSystemPreamble] = useState("");
  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState("");
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState("");

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/llm", { cache: "no-store" });
      const json = await safeJson<Resp>(res);
      if (!("ok" in json) || !json.ok) throw new Error(json.message || json.error || "Failed to load tenant LLM");

      setData(json);
      setRole(json.role);

      // Populate form from *overrides* if present; otherwise blank means "inherit"
      const o = json.overrides ?? {};
      setEstimatorModel(String(o?.models?.estimatorModel ?? ""));
      setQaModel(String(o?.models?.qaModel ?? ""));
      setExtraSystemPreamble(String(o?.prompts?.extraSystemPreamble ?? ""));
      setQuoteEstimatorSystem(String(o?.prompts?.quoteEstimatorSystem ?? ""));
      setQaQuestionGeneratorSystem(String(o?.prompts?.qaQuestionGeneratorSystem ?? ""));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setData(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      const overrides = {
        models: {
          estimatorModel: estimatorModel.trim() || undefined,
          qaModel: qaModel.trim() || undefined,
        },
        prompts: {
          extraSystemPreamble: extraSystemPreamble.trim() || undefined,
          quoteEstimatorSystem: quoteEstimatorSystem.trim() || undefined,
          qaQuestionGeneratorSystem: qaQuestionGeneratorSystem.trim() || undefined,
        },
      };

      const res = await fetch("/api/tenant/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides }),
      });

      const json = await safeJson<any>(res);
      if (!json?.ok) throw new Error(json?.message || json?.error || "Save failed");

      setMsg("Saved tenant overrides.");
      await load(); // reload to refresh effective view
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-950/40">
        <div className="text-sm text-gray-700 dark:text-gray-200">Loading LLM settings…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
        {err || "Failed to load."}
        <div className="mt-3">
          <button
            onClick={load}
            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-900 hover:bg-red-50 dark:border-red-900/40 dark:bg-neutral-950 dark:text-red-100 dark:hover:bg-white/5"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const eff = data.effective;

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">Tenant LLM Behavior</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Tenant overrides sit on top of platform + industry defaults. Guardrails are platform-controlled.
          </div>
          {role ? (
            <div className="mt-2 text-xs">
              <span className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-gray-700 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-200">
                Role: <span className="font-mono">{role}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100 dark:hover:bg-white/5"
          >
            Refresh
          </button>

          <button
            onClick={save}
            disabled={!canEdit || saving}
            className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-gray-100"
          >
            {saving ? "Saving…" : "Save Overrides"}
          </button>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-100">
          Read-only: only <span className="font-mono">owner</span> or <span className="font-mono">admin</span> can edit.
        </div>
      ) : null}

      {msg ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
          {msg}
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Effective (read-only) */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950">
        <div className="text-xs font-semibold text-gray-900 dark:text-white">Effective (what will run)</div>
        <div className="mt-2 grid gap-2 text-xs text-gray-700 dark:text-gray-200">
          <div>
            <span className="font-semibold">Estimator model:</span>{" "}
            <span className="font-mono">{eff.models.estimatorModel}</span>
          </div>
          <div>
            <span className="font-semibold">Q&amp;A model:</span>{" "}
            <span className="font-mono">{eff.models.qaModel}</span>
          </div>
          <div>
            <span className="font-semibold">Render prompt model:</span>{" "}
            <span className="font-mono">{eff.models.renderModel}</span>
          </div>
        </div>

        <div className="mt-3 text-xs font-semibold text-gray-900 dark:text-white">Platform guardrails (read-only)</div>
        <div className="mt-2 grid gap-1 text-xs text-gray-700 dark:text-gray-200">
          <div>
            mode: <span className="font-mono">{eff.guardrails.mode}</span> • pii:{" "}
            <span className="font-mono">{eff.guardrails.piiHandling}</span>
          </div>
          <div>
            maxQaQuestions: <span className="font-mono">{eff.guardrails.maxQaQuestions}</span> • maxOutputTokens:{" "}
            <span className="font-mono">{eff.guardrails.maxOutputTokens}</span>
          </div>
          <div className="text-gray-500 dark:text-gray-400">
            blockedTopics: {Array.isArray(eff.guardrails.blockedTopics) ? eff.guardrails.blockedTopics.join(", ") : ""}
          </div>
        </div>
      </div>

      {/* Overrides (editable) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-neutral-950">
          <div className="text-xs font-semibold text-gray-900 dark:text-white">Models (tenant override)</div>

          <label className="mt-3 block text-xs font-semibold text-gray-700 dark:text-gray-200">
            Estimator model (blank = inherit)
          </label>
          <input
            value={estimatorModel}
            onChange={(e) => setEstimatorModel(e.target.value)}
            disabled={!canEdit}
            placeholder={eff.models.estimatorModel}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100"
          />

          <label className="mt-3 block text-xs font-semibold text-gray-700 dark:text-gray-200">
            Q&amp;A model (blank = inherit)
          </label>
          <input
            value={qaModel}
            onChange={(e) => setQaModel(e.target.value)}
            disabled={!canEdit}
            placeholder={eff.models.qaModel}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100"
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-neutral-950">
          <div className="text-xs font-semibold text-gray-900 dark:text-white">Extra system preamble (tenant override)</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            This is prepended to both prompts. Leave blank to inherit platform.
          </div>
          <textarea
            value={extraSystemPreamble}
            onChange={(e) => setExtraSystemPreamble(e.target.value)}
            disabled={!canEdit}
            placeholder={eff.prompts.extraSystemPreamble || "(platform default)"}
            className="mt-3 h-32 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-neutral-950">
          <div className="text-xs font-semibold text-gray-900 dark:text-white">Quote estimator system (tenant override)</div>
          <textarea
            value={quoteEstimatorSystem}
            onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
            disabled={!canEdit}
            placeholder="Blank = inherit effective"
            className="mt-3 h-56 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100"
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-neutral-950">
          <div className="text-xs font-semibold text-gray-900 dark:text-white">Q&amp;A question generator system (tenant override)</div>
          <textarea
            value={qaQuestionGeneratorSystem}
            onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
            disabled={!canEdit}
            placeholder="Blank = inherit effective"
            className="mt-3 h-56 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">
        Tip: leaving fields blank is intentional — it means “inherit platform/industry defaults.”
      </div>
    </div>
  );
}