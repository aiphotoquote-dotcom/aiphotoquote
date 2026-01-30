// src/components/pcc/llm/TenantLlmManagerClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type GuardrailsMode = "strict" | "balanced" | "permissive";
type PiiHandling = "redact" | "allow" | "deny";

type PlatformLlmConfig = {
  version: number;
  models: { estimatorModel: string; qaModel: string; renderModel?: string };
  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
    extraSystemPreamble?: string;
  };
  guardrails: {
    mode?: GuardrailsMode;
    piiHandling?: PiiHandling;
    blockedTopics: string[];
    maxQaQuestions: number;
    maxOutputTokens?: number;
  };
  updatedAt: string;
};

type TenantOverrides = {
  version?: number;
  updatedAt?: string | null;
  models?: { estimatorModel?: string; qaModel?: string; renderModel?: string };
  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;
  };
  maxQaQuestions?: number;
};

type ApiGetResp =
  | {
      ok: true;
      platform: PlatformLlmConfig;
      industry: Partial<PlatformLlmConfig>;
      tenant: TenantOverrides | null;
      effective: {
        models: { estimatorModel: string; qaModel: string; renderModel: string };
        prompts: {
          extraSystemPreamble?: string;
          quoteEstimatorSystem: string;
          qaQuestionGeneratorSystem: string;
        };
        guardrails: {
          mode: GuardrailsMode;
          piiHandling: PiiHandling;
          blockedTopics: string[];
          maxQaQuestions: number;
          maxOutputTokens: number;
        };
      };
      permissions: any;
    }
  | { ok: false; error: string; message?: string };

type ApiPostResp =
  | { ok: true; tenant: TenantOverrides | null; effective: any }
  | { ok: false; error: string; message?: string; issues?: any };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
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

export function TenantLlmManagerClient(props: { tenantId: string; industryKey: string | null }) {
  const { tenantId, industryKey } = props;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [data, setData] = useState<ApiGetResp | null>(null);

  const tenant = useMemo<TenantOverrides>(() => {
    if (data && (data as any).ok) return ((data as any).tenant ?? {}) as TenantOverrides;
    return {};
  }, [data]);

  const [estimatorModel, setEstimatorModel] = useState("");
  const [qaModel, setQaModel] = useState("");
  const [renderModel, setRenderModel] = useState("");

  const [extraSystemPreamble, setExtraSystemPreamble] = useState("");
  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState("");
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState("");

  const [maxQaQuestions, setMaxQaQuestions] = useState<number>(3);

  async function ensureTenantCookie(): Promise<void> {
    // This endpoint is the ONLY thing that should auto-select and/or refresh tenant cookie.
    // credentials: "include" is critical for mobile Safari consistency.
    await safeJson<any>(
      await fetch("/api/tenant/context", { method: "GET", cache: "no-store", credentials: "include" })
    );
  }

  async function apiGet(): Promise<ApiGetResp> {
    const qs = new URLSearchParams({ tenantId, industryKey: industryKey ?? "" });
    const res = await fetch(`/api/tenant/llm?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    return safeJson<ApiGetResp>(res);
  }

  async function apiPost(overrides: TenantOverrides): Promise<ApiPostResp> {
    const res = await fetch("/api/tenant/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, industryKey, overrides }),
      credentials: "include",
    });
    return safeJson<ApiPostResp>(res);
  }

  async function refresh() {
    setMsg(null);
    setLoading(true);

    try {
      let r = await apiGet();

      // If the API says NO_ACTIVE_TENANT, force a cookie refresh via context and retry once.
      if (!("ok" in r) || !r.ok) {
        if ((r as any).error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          r = await apiGet();
        }
      }

      if (!("ok" in r) || !r.ok) {
        throw new Error((r as any).message || (r as any).error || "Failed to load.");
      }

      setData(r);

      const t = (r as any).tenant ?? {};
      setEstimatorModel(safeStr(t.models?.estimatorModel, ""));
      setQaModel(safeStr(t.models?.qaModel, ""));
      setRenderModel(safeStr(t.models?.renderModel, ""));

      setExtraSystemPreamble(safeStr(t.prompts?.extraSystemPreamble, ""));
      setQuoteEstimatorSystem(safeStr(t.prompts?.quoteEstimatorSystem, ""));
      setQaQuestionGeneratorSystem(safeStr(t.prompts?.qaQuestionGeneratorSystem, ""));

      setMaxQaQuestions(numClamp(t.maxQaQuestions, 1, 10, 3));

      setMsg({ kind: "ok", text: "Loaded tenant LLM settings." });
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
      const overrides: TenantOverrides = {
        version: tenant?.version ?? 1,
        updatedAt: tenant?.updatedAt ?? null,
        models: {
          estimatorModel: safeStr(estimatorModel, "") || undefined,
          qaModel: safeStr(qaModel, "") || undefined,
          renderModel: safeStr(renderModel, "") || undefined,
        },
        prompts: {
          extraSystemPreamble: String(extraSystemPreamble || "") || undefined,
          quoteEstimatorSystem: String(quoteEstimatorSystem || "") || undefined,
          qaQuestionGeneratorSystem: String(qaQuestionGeneratorSystem || "") || undefined,
        },
        maxQaQuestions: numClamp(maxQaQuestions, 1, 10, 3),
      };

      let r = await apiPost(overrides);

      if (!("ok" in r) || !r.ok) {
        if ((r as any).error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          r = await apiPost(overrides);
        }
      }

      if (!("ok" in r) || !r.ok) {
        throw new Error((r as any).message || (r as any).error || "Save failed.");
      }

      await refresh();
      setMsg({ kind: "ok", text: "Saved tenant overrides." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, industryKey]);

  const okData = data && (data as any).ok ? (data as any) : null;
  const effective = okData?.effective ?? null;
  const platform = okData?.platform ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant LLM settings</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Tenant overrides apply on top of industry + platform defaults.
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
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
            }`}
          >
            {msg.text}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenant overrides</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Leave a field blank to inherit from industry/platform.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Estimator model override</label>
              <input
                value={estimatorModel}
                onChange={(e) => setEstimatorModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="(inherit)"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A model override</label>
              <input
                value={qaModel}
                onChange={(e) => setQaModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="(inherit)"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render prompt model override</label>
              <input
                value={renderModel}
                onChange={(e) => setRenderModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                placeholder="(inherit)"
              />
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This affects text prompt synthesis only (image generation uses the image model).
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
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Tenant can only tighten. Platform cap still applies.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Platform guardrails (locked)</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            These are set by platform and cannot be changed by tenants.
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">Mode</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {platform?.guardrails?.mode ?? "balanced"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">PII handling</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {platform?.guardrails?.piiHandling ?? "redact"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">Blocked topics</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {(platform?.guardrails?.blockedTopics?.length ?? 0).toString()}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenant prompt overrides</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Leave blank to inherit. Effective prompts preview is shown below.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Extra system preamble override
            </label>
            <textarea
              value={extraSystemPreamble}
              onChange={(e) => setExtraSystemPreamble(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Quote estimator system override
            </label>
            <textarea
              value={quoteEstimatorSystem}
              onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Q&A generator system override
            </label>
            <textarea
              value={qaQuestionGeneratorSystem}
              onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
          </div>
        </div>

        {effective ? (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective preview</div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Effective estimator system
                </div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective.prompts?.quoteEstimatorSystem ?? ""}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Effective Q&A system</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective.prompts?.qaQuestionGeneratorSystem ?? ""}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}