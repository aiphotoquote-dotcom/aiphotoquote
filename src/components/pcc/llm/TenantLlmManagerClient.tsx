// src/components/pcc/llm/TenantLlmManagerClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { TEXT_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS } from "@/components/pcc/llm/helpers/modelOptions";

type GuardrailsMode = "strict" | "balanced" | "permissive";
type PiiHandling = "redact" | "allow" | "deny";

type PlatformLlmConfig = {
  version: number;
  models: { estimatorModel: string; qaModel: string; renderModel?: string };
  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
    extraSystemPreamble?: string;
    renderPromptPreamble?: string;
    renderPromptTemplate?: string;
    renderStylePresets?: Record<string, string>;
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
  updatedAt?: string | null;
  models?: { estimatorModel?: string; qaModel?: string; renderModel?: string };
  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;
  };
  maxQaQuestions?: number;
};

type EffectiveShape = {
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

type ApiGetResp =
  | {
      ok: true;
      platform: PlatformLlmConfig;
      industry: Partial<PlatformLlmConfig>;
      tenant: TenantOverrides | null;
      effective: EffectiveShape;
      effectiveBase: EffectiveShape; // ✅ baseline (platform + industry only)
      permissions: any;
    }
  | { ok: false; error: string; message?: string };

type ApiPostResp =
  | { ok: true; tenant: TenantOverrides | null; effective: any; effectiveBase: any }
  | { ok: false; error: string; message?: string; issues?: any };

/**
 * Key policy status (read-only)
 * NOTE: This expects an endpoint to exist. If it doesn't, we fail gracefully and show "Unavailable".
 */
type KeyPolicyStatus =
  | {
      ok: true;
      tenantId: string;
      planTier: string | null;
      activationGraceCredits: number | null;
      activationGraceUsed: number | null;
      hasTenantOpenAiKey: boolean;
      effectiveKeySourceNow: "tenant" | "platform_grace";
      wouldConsumeGraceOnNewQuote: boolean;
      reason?: string | null;
    }
  | { ok: false; error: string; message?: string };

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

function isInOptions(value: string, options: Array<{ value: string }>) {
  return options.some((o) => o.value === value);
}

function prettyModelLabel(value: string, options: Array<{ value: string; label: string }>) {
  const found = options.find((o) => o.value === value);
  return found?.label ?? value;
}

function shortTs(ts: unknown) {
  const s = safeStr(ts);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function chipClass(kind: "ok" | "warn" | "err" | "info") {
  if (kind === "ok") return "border-green-200 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100";
  if (kind === "warn") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100";
  if (kind === "err") return "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200";
  return "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";
}

function diffExists(a: string, b: string) {
  return safeStr(a) !== safeStr(b);
}

/**
 * Model select behavior:
 * - stored override value is either "" (inherit) OR a concrete model id (including custom text)
 * - UI shows a first row: "Inherited — <baseline> (default)" with value ""
 * - if selected value isn't in options and isn't empty -> treat as custom
 */
function ModelSelect(props: {
  label: string;
  help?: string;
  options: Array<{ value: string; label: string }>;
  value: string; // stored override value ("" means inherit)
  onChange: (next: string) => void;

  baselineValue: string; // ✅ resolved without tenant overrides (platform + industry)
  effectiveValue: string; // resolved including tenant overrides
  showEffectiveLine?: boolean;
}) {
  const { label, help, options, value, onChange, baselineValue, effectiveValue, showEffectiveLine } = props;

  const valueIsEmpty = !safeStr(value);
  const valueIsKnown = !valueIsEmpty && isInOptions(value, options.filter((o) => o.value !== "custom"));
  const valueIsCustom = !valueIsEmpty && !valueIsKnown;

  const selectValue = valueIsEmpty ? "" : valueIsKnown ? value : "__custom__";

  const inheritedLabel = `Inherited — ${prettyModelLabel(baselineValue, options)} (default)`;

  return (
    <div>
      <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</label>

      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            onChange(""); // inherit
            return;
          }
          if (v === "__custom__") {
            onChange(valueIsCustom ? value : "");
            return;
          }
          onChange(v);
        }}
        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
      >
        <option value="">{inheritedLabel}</option>

        {options
          .filter((o) => o.value !== "custom")
          .map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}

        <option value="__custom__">Custom…</option>
      </select>

      {help ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</div> : null}

      {selectValue === "__custom__" ? (
        <input
          value={valueIsCustom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          placeholder="Enter custom model id…"
        />
      ) : null}

      {showEffectiveLine ? (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          Effective:{" "}
          <span className="font-mono text-gray-900 dark:text-gray-100">
            {safeStr(value) ? safeStr(value) : safeStr(effectiveValue)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Collapsible(props: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const { title, subtitle, defaultOpen, children } = props;
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-6 py-5 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{subtitle}</div> : null}
        </div>
        <div className="mt-0.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{open ? "Hide" : "Show"}</div>
      </button>

      {open ? <div className="px-6 pb-6">{children}</div> : null}
    </div>
  );
}

export function TenantLlmManagerClient(props: { tenantId: string; industryKey: string | null }) {
  const { tenantId, industryKey } = props;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err" | "info"; text: string } | null>(null);

  const [data, setData] = useState<ApiGetResp | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyPolicyStatus | null>(null);

  const tenant = useMemo<TenantOverrides>(() => {
    if (data && (data as any).ok) return ((data as any).tenant ?? {}) as TenantOverrides;
    return {};
  }, [data]);

  const okData = data && (data as any).ok ? (data as any) : null;
  const effective: EffectiveShape | null = okData?.effective ?? null;
  const effectiveBase: EffectiveShape | null = okData?.effectiveBase ?? null;
  const platform = okData?.platform ?? null;
  const permissions = okData?.permissions ?? null;

  const baselineEstimator = safeStr(effectiveBase?.models?.estimatorModel, "gpt-4o-mini");
  const baselineQa = safeStr(effectiveBase?.models?.qaModel, "gpt-4o-mini");
  const baselineRender = safeStr(effectiveBase?.models?.renderModel, "gpt-image-1");

  const effectiveEstimator = safeStr(effective?.models?.estimatorModel, baselineEstimator);
  const effectiveQa = safeStr(effective?.models?.qaModel, baselineQa);
  const effectiveRender = safeStr(effective?.models?.renderModel, baselineRender);

  // ---------- form state ----------
  const [estimatorModel, setEstimatorModel] = useState("");
  const [qaModel, setQaModel] = useState("");
  const [renderModel, setRenderModel] = useState("");

  const [extraSystemPreamble, setExtraSystemPreamble] = useState("");
  const [quoteEstimatorSystem, setQuoteEstimatorSystem] = useState("");
  const [qaQuestionGeneratorSystem, setQaQuestionGeneratorSystem] = useState("");

  const [maxQaQuestions, setMaxQaQuestions] = useState<number>(3);

  // ---------- derived: dirty ----------
  const dirty = useMemo(() => {
    const t = tenant ?? {};
    const m0 = {
      estimatorModel: safeStr(t.models?.estimatorModel, ""),
      qaModel: safeStr(t.models?.qaModel, ""),
      renderModel: safeStr(t.models?.renderModel, ""),
    };
    const p0 = {
      extraSystemPreamble: safeStr(t.prompts?.extraSystemPreamble, ""),
      quoteEstimatorSystem: safeStr(t.prompts?.quoteEstimatorSystem, ""),
      qaQuestionGeneratorSystem: safeStr(t.prompts?.qaQuestionGeneratorSystem, ""),
    };
    const q0 = numClamp(t.maxQaQuestions, 1, 10, 3);

    return (
      diffExists(estimatorModel, m0.estimatorModel) ||
      diffExists(qaModel, m0.qaModel) ||
      diffExists(renderModel, m0.renderModel) ||
      diffExists(extraSystemPreamble, p0.extraSystemPreamble) ||
      diffExists(quoteEstimatorSystem, p0.quoteEstimatorSystem) ||
      diffExists(qaQuestionGeneratorSystem, p0.qaQuestionGeneratorSystem) ||
      maxQaQuestions !== q0
    );
  }, [
    tenant,
    estimatorModel,
    qaModel,
    renderModel,
    extraSystemPreamble,
    quoteEstimatorSystem,
    qaQuestionGeneratorSystem,
    maxQaQuestions,
  ]);

  async function ensureTenantCookie(): Promise<void> {
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

  async function apiGetKeyStatus(): Promise<KeyPolicyStatus> {
    const qs = new URLSearchParams({ tenantId });
    const res = await fetch(`/api/tenant/llm-key-status?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    return safeJson<KeyPolicyStatus>(res);
  }

  function applyLoadedToForm(r: ApiGetResp) {
    const t = (r as any).tenant ?? {};
    setEstimatorModel(safeStr(t.models?.estimatorModel, ""));
    setQaModel(safeStr(t.models?.qaModel, ""));
    setRenderModel(safeStr(t.models?.renderModel, ""));

    setExtraSystemPreamble(safeStr(t.prompts?.extraSystemPreamble, ""));
    setQuoteEstimatorSystem(safeStr(t.prompts?.quoteEstimatorSystem, ""));
    setQaQuestionGeneratorSystem(safeStr(t.prompts?.qaQuestionGeneratorSystem, ""));

    setMaxQaQuestions(numClamp(t.maxQaQuestions, 1, 10, 3));
  }

  async function refresh() {
    setMsg(null);
    setLoading(true);

    try {
      let r = await apiGet();

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
      applyLoadedToForm(r);

      // Key status is optional (endpoint may not exist yet); fail gracefully.
      try {
        let ks = await apiGetKeyStatus();
        if (!("ok" in ks) || !ks.ok) {
          if ((ks as any).error === "NO_ACTIVE_TENANT") {
            await ensureTenantCookie();
            ks = await apiGetKeyStatus();
          }
        }
        setKeyStatus(ks);
      } catch (e: any) {
        setKeyStatus({ ok: false, error: "UNAVAILABLE", message: e?.message ?? String(e) });
      }

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

  async function resetToInherited() {
    // Clears tenant overrides by saving empty values. Your API should interpret as "inherit".
    setMsg(null);
    setSaving(true);
    try {
      const overrides: TenantOverrides = {
        updatedAt: tenant?.updatedAt ?? null,
        models: {},
        prompts: {},
        maxQaQuestions: numClamp(platform?.guardrails?.maxQaQuestions, 1, 10, 3),
      };

      let r = await apiPost(overrides);

      if (!("ok" in r) || !r.ok) {
        if ((r as any).error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          r = await apiPost(overrides);
        }
      }

      if (!("ok" in r) || !r.ok) {
        throw new Error((r as any).message || (r as any).error || "Reset failed.");
      }

      await refresh();
      setMsg({ kind: "ok", text: "Cleared tenant overrides. Inheriting platform + industry defaults." });
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

  const maxQaCap = numClamp(platform?.guardrails?.maxQaQuestions ?? 3, 1, 10, 3);
  const effectiveMaxQa = numClamp(effective?.guardrails?.maxQaQuestions ?? maxQaCap, 1, 10, maxQaCap);

  const keyCard = useMemo(() => {
    if (!keyStatus) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          Loading key policy…
        </div>
      );
    }

    if (!("ok" in keyStatus) || !keyStatus.ok) {
      return (
        <div className={`rounded-xl border px-3 py-2 text-sm ${chipClass("warn")}`}>
          Key policy status unavailable.{" "}
          <span className="opacity-80">{(keyStatus as any).message || (keyStatus as any).error || ""}</span>
        </div>
      );
    }

    const ks = keyStatus;
    const using = ks.effectiveKeySourceNow;
    const kind = using === "tenant" ? "ok" : "warn";
    const title =
      using === "tenant"
        ? "Using tenant OpenAI key"
        : "Using platform OpenAI key (tier0 / grace)";

    const graceText =
      ks.planTier === "tier0"
        ? "Tier0: platform key allowed (token-limited elsewhere)."
        : ks.wouldConsumeGraceOnNewQuote
        ? "New quotes will consume a grace credit while platform key is used."
        : "Platform key is allowed without consuming grace (phase2 or tier0).";

    return (
      <div className={`rounded-2xl border p-4 ${chipClass(kind as any)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs opacity-90">
              Plan tier:{" "}
              <span className="font-mono">{safeStr(ks.planTier, "(unknown)")}</span>{" "}
              · Tenant key present:{" "}
              <span className="font-mono">{ks.hasTenantOpenAiKey ? "yes" : "no"}</span>
            </div>
          </div>
          <div className="text-right text-xs opacity-90">
            <div>
              Grace:{" "}
              <span className="font-mono">
                {Number(ks.activationGraceUsed ?? 0)}/{Number(ks.activationGraceCredits ?? 0)}
              </span>
            </div>
            <div>
              Source: <span className="font-mono">{using}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs opacity-90">{ks.reason ? ks.reason : graceText}</div>
      </div>
    );
  }, [keyStatus]);

  return (
    <div className="space-y-6">
      {/* Header / actions */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant LLM settings</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Tenant overrides apply on top of <span className="font-mono">platform → industry → tenant</span>.
              Guardrails are platform-locked.
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tenant: <span className="font-mono">{tenantId}</span>
              {industryKey ? (
                <>
                  {" "}
                  · Industry: <span className="font-mono">{industryKey}</span>
                </>
              ) : null}
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
              onClick={resetToInherited}
              disabled={saving || loading}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
              title="Clear all tenant overrides (inherit everything)"
            >
              Reset
            </button>

            <button
              onClick={save}
              disabled={saving || loading || !dirty}
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>

        {msg ? (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${chipClass(msg.kind)}`}>{msg.text}</div>
        ) : null}

        <div className="mt-5">{keyCard}</div>
      </div>

      {/* Two-column: Overrides + Guardrails */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Overrides</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Leave blank to inherit the baseline.</p>

          <div className="mt-4 space-y-4">
            <ModelSelect
              label="Estimator model override"
              options={TEXT_MODEL_OPTIONS}
              value={estimatorModel}
              onChange={setEstimatorModel}
              baselineValue={baselineEstimator}
              effectiveValue={effectiveEstimator}
              showEffectiveLine
              help={`Baseline: ${baselineEstimator} · Effective: ${effectiveEstimator}`}
            />

            <ModelSelect
              label="Q&A model override"
              options={TEXT_MODEL_OPTIONS}
              value={qaModel}
              onChange={setQaModel}
              baselineValue={baselineQa}
              effectiveValue={effectiveQa}
              showEffectiveLine
              help={`Baseline: ${baselineQa} · Effective: ${effectiveQa}`}
            />

            <ModelSelect
              label="Render image model override"
              options={IMAGE_MODEL_OPTIONS}
              value={renderModel}
              onChange={setRenderModel}
              baselineValue={baselineRender}
              effectiveValue={effectiveRender}
              showEffectiveLine
              help="Used by the image-render pipeline. (Actual render enablement is controlled by tenant settings + customer opt-in.)"
            />

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
                  Tenant can only tighten. Platform cap:{" "}
                  <span className="font-mono">{maxQaCap}</span>. Effective:{" "}
                  <span className="font-mono">{effectiveMaxQa}</span>.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Guardrails (locked)</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            These are platform-owned and cannot be changed per tenant.
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">Mode</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">{platform?.guardrails?.mode ?? "balanced"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">PII handling</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">{platform?.guardrails?.piiHandling ?? "redact"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">Blocked topics</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {(platform?.guardrails?.blockedTopics?.length ?? 0).toString()}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-gray-600 dark:text-gray-300">Max output tokens</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {safeStr(platform?.guardrails?.maxOutputTokens ?? 1200)}
              </span>
            </div>

            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-neutral-900/40 dark:text-gray-200">
              Tip: prompt composition adds platform + industry + tenant layers; guardrails always remain platform-locked.
            </div>
          </div>
        </section>
      </div>

      {/* Prompts with preview */}
      <Collapsible
        title="Prompt overrides"
        subtitle="Leave blank to inherit. Preview shows effective prompts after platform/industry/tenant composition."
        defaultOpen
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Extra system preamble override</label>
            <textarea
              value={extraSystemPreamble}
              onChange={(e) => setExtraSystemPreamble(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Adds additional system instructions above platform + industry defaults.
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quote estimator system override</label>
            <textarea
              value={quoteEstimatorSystem}
              onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              If blank, inherits baseline estimator prompt and then composition applies pricing policy + tenant context at runtime.
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A generator system override</label>
            <textarea
              value={qaQuestionGeneratorSystem}
              onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(inherit)"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Controls which clarifying questions get asked during Phase 1 when Live Q&A is enabled.
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Baseline (platform + industry)</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{shortTs(platform?.updatedAt)}</div>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimator</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effectiveBase?.prompts?.quoteEstimatorSystem ?? ""}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Q&A</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effectiveBase?.prompts?.qaQuestionGeneratorSystem ?? ""}
                </pre>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective (includes tenant)</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {dirty ? "Unsaved changes (preview may differ after save)" : "Current effective preview"}
              </div>
            </div>

            <div className="mt-3 grid gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Effective estimator system</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective?.prompts?.quoteEstimatorSystem ?? ""}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Effective Q&A system</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective?.prompts?.qaQuestionGeneratorSystem ?? ""}
                </pre>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          <div className="font-semibold text-gray-900 dark:text-gray-100">How this applies at runtime</div>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              <span className="font-mono">resolveTenantLlm()</span> loads tenant toggles + pricing payload; platform config comes
              from PCC store.
            </li>
            <li>
              Prompts are composed (platform → industry → tenant) and then pricing policy is enforced by server logic (both in
              prompt and post-processing).
            </li>
            <li>
              OpenAI key selection is enforced server-side and is frozen into each quote log (Phase 1) for auditability.
            </li>
          </ul>
        </div>
      </Collapsible>

      {/* Permissions (optional visibility) */}
      {permissions ? (
        <Collapsible title="Permissions" subtitle="Debug-only: what this user is allowed to edit." defaultOpen={false}>
          <pre className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(permissions, null, 2)}
          </pre>
        </Collapsible>
      ) : null}
    </div>
  );
}