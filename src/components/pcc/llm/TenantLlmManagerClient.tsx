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

    // render pipeline (platform-owned baseline)
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

  /**
   * Optional: we will *read* these if API provides them.
   * (Saved from ai-policy page; tenant “render prompt layer”.)
   */
  renderingPolicy?: {
    promptAddendum?: string;
    negativeGuidance?: string;
    style?: string;
    enabled?: boolean;
  };
};

type EffectiveRenderShape = {
  model: string;

  // platform baseline
  platformPreamble?: string;
  platformTemplate?: string;

  // industry pack (what the industry editor collects)
  industryAddendum?: string;
  industryNegativeGuidance?: string;

  // tenant add-ons (ai-policy)
  tenantAddendum?: string;
  tenantNegativeGuidance?: string;

  // final compiled prompt
  compiledPrompt?: string;

  // metadata
  platformVersion?: number;
  industryVersion?: number;
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

  rendering?: EffectiveRenderShape;
};

type ApiGetResp =
  | {
      ok: true;
      platform: PlatformLlmConfig;
      industry: Partial<PlatformLlmConfig> & { version?: number };
      tenant: TenantOverrides | null;
      effective: EffectiveShape;
      effectiveBase: EffectiveShape;
      permissions: any;
      debug?: any;
    }
  | { ok: false; error: string; message?: string };

type ApiPostResp =
  | { ok: true; tenant: TenantOverrides | null; effective: any; effectiveBase: any }
  | { ok: false; error: string; message?: string; issues?: any };

type KeyPolicyStatus =
  | {
      ok: true;
      tenantId: string;
      planTier: string | null;
      activationGraceCredits: number | null;
      activationGraceUsed: number | null;
      hasTenantOpenAiKey: boolean;

      hasPlatformKey: boolean;
      platformAllowed: boolean;
      graceRemaining: boolean;

      effectiveKeySourceNow: "tenant" | "platform_grace" | "none";
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

async function safeJsonOptional<T>(
  res: Response
): Promise<{ ok: true; data: T } | { ok: false; status: number; ct: string }> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { ok: false, status: res.status, ct };
  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, ct };
  }
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
  if (kind === "ok")
    return "border-green-200 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100";
  if (kind === "warn")
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100";
  if (kind === "err")
    return "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200";
  return "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";
}

function diffExists(a: string, b: string) {
  return safeStr(a) !== safeStr(b);
}

/**
 * Safe "first non-empty string" picker.
 * This is ONLY for defensive reading; it never changes persisted schema.
 */
function pickFirstString(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = (obj as any)[k];
    if (typeof v === "string" && safeStr(v)) return safeStr(v);
  }
  return "";
}

function normalizeKeyPolicyStatus(anyResp: any): KeyPolicyStatus {
  if (!anyResp || anyResp.ok !== true) return anyResp as KeyPolicyStatus;

  const tenantId = safeStr(anyResp.tenantId, "");
  const kp = anyResp.keyPolicy && typeof anyResp.keyPolicy === "object" ? anyResp.keyPolicy : null;

  const planTierRaw = kp ? kp.planTier : anyResp.planTier;
  const planTier = safeStr(planTierRaw, "") || null;

  const activationGraceCreditsRaw = kp ? kp.activationGraceCredits : anyResp.activationGraceCredits;
  const activationGraceUsedRaw = kp ? kp.activationGraceUsed : anyResp.activationGraceUsed;

  const activationGraceCredits = Number.isFinite(Number(activationGraceCreditsRaw))
    ? Number(activationGraceCreditsRaw)
    : 0;
  const activationGraceUsed = Number.isFinite(Number(activationGraceUsedRaw)) ? Number(activationGraceUsedRaw) : 0;

  const hasTenantOpenAiKey = Boolean(
    kp ? kp.hasTenantKey ?? kp.hasTenantOpenAiKey : anyResp.hasTenantOpenAiKey ?? anyResp.hasTenantKey
  );

  const hasPlatformKey = Boolean(kp ? kp.platformKeyPresent ?? kp.hasPlatformKey : anyResp.hasPlatformKey);

  const platformAllowed = Boolean(kp ? kp.platformAllowed : anyResp.platformAllowed);
  const graceRemaining = Boolean(kp ? kp.graceRemaining : anyResp.graceRemaining);

  let effectiveKeySourceNow: "tenant" | "platform_grace" | "none" = safeStr(
    kp ? kp.effectiveKeySourceNow : anyResp.effectiveKeySourceNow
  ) as any;

  if (
    effectiveKeySourceNow !== "tenant" &&
    effectiveKeySourceNow !== "platform_grace" &&
    effectiveKeySourceNow !== "none"
  ) {
    effectiveKeySourceNow = "none";
  }

  const computedSource: "tenant" | "platform_grace" | "none" = hasTenantOpenAiKey
    ? "tenant"
    : platformAllowed && hasPlatformKey
      ? "platform_grace"
      : "none";

  if (effectiveKeySourceNow !== computedSource) effectiveKeySourceNow = computedSource;

  const wouldConsumeGraceOnNewQuote = Boolean(kp ? kp.wouldConsumeGraceOnNewQuote : anyResp.wouldConsumeGraceOnNewQuote);
  const reason = (kp ? kp.reason : anyResp.reason) ?? null;

  return {
    ok: true,
    tenantId,
    planTier,
    activationGraceCredits,
    activationGraceUsed,
    hasTenantOpenAiKey,
    hasPlatformKey,
    platformAllowed,
    graceRemaining,
    effectiveKeySourceNow,
    wouldConsumeGraceOnNewQuote,
    reason,
  };
}

function ModelSelect(props: {
  label: string;
  help?: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (next: string) => void;
  baselineValue: string;
  effectiveValue: string;
  showEffectiveLine?: boolean;
}) {
  const { label, help, options, value, onChange, baselineValue, effectiveValue, showEffectiveLine } = props;

  const valueIsEmpty = !safeStr(value);
  const valueIsKnown = !valueIsEmpty && isInOptions(value, options.filter((o) => o.value !== "custom"));
  const valueIsCustom = !valueIsEmpty && !valueIsKnown;

  const selectValue = valueIsEmpty ? "" : valueIsKnown ? value : "__custom__";
  const inheritedLabel = `Inherited — ${prettyModelLabel(baselineValue, options)} (baseline)`;

  return (
    <div>
      <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</label>

      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return onChange("");
          if (v === "__custom__") return onChange(valueIsCustom ? value : "");
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

function joinNonEmpty(parts: Array<string | null | undefined>, sep = "\n\n") {
  return parts.map((p) => safeStr(p)).filter(Boolean).join(sep);
}

function renderLayerLine(label: string, value: string) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className="font-mono text-gray-900 dark:text-gray-100">{value}</span>
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

  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ kind: "ok" | "warn" | "err" | "info"; text: string } | null>(null);

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
    await safeJson<any>(await fetch("/api/tenant/context", { method: "GET", cache: "no-store", credentials: "include" }));
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

  const KEY_POLICY_ENDPOINT = "/api/tenant/key-policy";

  async function apiGetKeyPolicyStatus(): Promise<KeyPolicyStatus> {
    const qs = new URLSearchParams({ tenantId });
    const res = await fetch(`${KEY_POLICY_ENDPOINT}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });

    const parsed = await safeJsonOptional<any>(res);
    if (!parsed.ok) {
      const hint = res.status === 404 ? "Endpoint not deployed" : `HTTP ${res.status}`;
      return { ok: false, error: "UNAVAILABLE", message: hint };
    }

    return normalizeKeyPolicyStatus(parsed.data);
  }

  const OPENAI_KEY_ENDPOINT = "/api/tenant/openai-key";

  async function apiSetTenantOpenAiKey(key: string) {
    const res = await fetch(OPENAI_KEY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tenantId, openaiApiKey: key }),
    });
    return safeJson<any>(res);
  }

  async function apiClearTenantOpenAiKey() {
    const res = await fetch(OPENAI_KEY_ENDPOINT, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tenantId }),
    });
    return safeJson<any>(res);
  }

  async function refreshKeyStatusOnly() {
    try {
      let ks = await apiGetKeyPolicyStatus();
      if (!("ok" in ks) || !ks.ok) {
        if ((ks as any).error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          ks = await apiGetKeyPolicyStatus();
        }
      }
      setKeyStatus(ks);
    } catch {
      setKeyStatus({ ok: false, error: "UNAVAILABLE", message: "Unavailable" });
    }
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

      const t = (r as any).tenant ?? {};
      setEstimatorModel(safeStr(t.models?.estimatorModel, ""));
      setQaModel(safeStr(t.models?.qaModel, ""));
      setRenderModel(safeStr(t.models?.renderModel, ""));

      setExtraSystemPreamble(safeStr(t.prompts?.extraSystemPreamble, ""));
      setQuoteEstimatorSystem(safeStr(t.prompts?.quoteEstimatorSystem, ""));
      setQaQuestionGeneratorSystem(safeStr(t.prompts?.qaQuestionGeneratorSystem, ""));

      setMaxQaQuestions(numClamp(t.maxQaQuestions, 1, 10, 3));

      await refreshKeyStatusOnly();

      setMsg({ kind: "ok", text: "Loaded LLM settings." });
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
      setMsg({ kind: "ok", text: "Saved tenant layer." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setMsg(null);
    setSaving(true);
    try {
      const overrides: TenantOverrides = {
        updatedAt: tenant?.updatedAt ?? null,
        models: {},
        prompts: {},
        maxQaQuestions: undefined,
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
      setMsg({ kind: "ok", text: "Cleared tenant layer (back to baseline)." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function saveTenantKey() {
    setKeyMsg(null);
    setKeySaving(true);
    try {
      const k = safeStr(openaiKeyInput, "");
      if (!k) {
        setKeyMsg({ kind: "warn", text: "Paste an OpenAI API key first." });
        return;
      }

      let r = await apiSetTenantOpenAiKey(k);
      if (!r?.ok) {
        if (r?.error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          r = await apiSetTenantOpenAiKey(k);
        }
      }
      if (!r?.ok) throw new Error(r?.message || r?.error || "Failed to save key.");

      setOpenaiKeyInput("");
      setKeyMsg({ kind: "ok", text: "Saved tenant OpenAI key." });
      await refreshKeyStatusOnly();
    } catch (e: any) {
      setKeyMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setKeySaving(false);
    }
  }

  async function clearTenantKey() {
    setKeyMsg(null);
    setKeySaving(true);
    try {
      let r = await apiClearTenantOpenAiKey();
      if (!r?.ok) {
        if (r?.error === "NO_ACTIVE_TENANT") {
          await ensureTenantCookie();
          r = await apiClearTenantOpenAiKey();
        }
      }
      if (!r?.ok) throw new Error(r?.message || r?.error || "Failed to clear key.");

      setOpenaiKeyInput("");
      setKeyMsg({ kind: "ok", text: "Cleared tenant OpenAI key." });
      await refreshKeyStatusOnly();
    } catch (e: any) {
      setKeyMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      setKeySaving(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, industryKey]);

  const okData = data && (data as any).ok ? (data as any) : null;
  const effective: EffectiveShape | null = okData?.effective ?? null;
  const effectiveBase: EffectiveShape | null = okData?.effectiveBase ?? null;
  const platform: PlatformLlmConfig | null = okData?.platform ?? null;
  const industry: any = okData?.industry ?? null;

  const baselineEstimator = safeStr(effectiveBase?.models?.estimatorModel, "gpt-4o-mini");
  const baselineQa = safeStr(effectiveBase?.models?.qaModel, "gpt-4o-mini");
  const baselineRender = safeStr(effectiveBase?.models?.renderModel, "gpt-image-1");

  const effectiveEstimator = safeStr(effective?.models?.estimatorModel, baselineEstimator);
  const effectiveQa = safeStr(effective?.models?.qaModel, baselineQa);
  const effectiveRender = safeStr(effective?.models?.renderModel, baselineRender);

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

  // ---- Rendering effective view (read-only) ----
  const renderEffective: EffectiveRenderShape | null = (effective as any)?.rendering ?? null;

  const platformRenderPreamble = safeStr(platform?.prompts?.renderPromptPreamble, "");
  const platformRenderTemplate = safeStr(platform?.prompts?.renderPromptTemplate, "");

  /**
   * ✅ Industry values:
   * Prefer the API-provided effective rendering layer (renderEffective.*),
   * because the server is already doing schema-tolerant normalization.
   *
   * Fallback to industry.prompts only for back-compat / partial deployments.
   */
  const industryRenderAddendum =
    safeStr(renderEffective?.industryAddendum, "") ||
    pickFirstString((industry as any)?.prompts, [
      "renderSystemAddendum",
      "renderSystemAddon",
      "renderSystemAddOn",
      "renderAddendum",
      "renderAddon",
      "renderAddOn",
      "renderPromptAddendum",
      "renderPromptAddon",
      "render_system_addendum",
      "render_system_addon",
      "render_addendum",
      "render_addon",
      "render_prompt_addendum",
      // last-resort legacy
      "renderPromptTemplate",
    ]);

  const industryRenderNegative =
    safeStr(renderEffective?.industryNegativeGuidance, "") ||
    pickFirstString((industry as any)?.prompts, [
      "renderNegativeGuidance",
      "renderNegative",
      "renderNegatives",
      "render_negative_guidance",
      "render_negative",
      "render_negatives",
      "rendering_negative_guidance",
      "renderingNegativeGuidance",
    ]);

  // Tenant (ai-policy) values (from API convenience object or renderEffective)
  const tenantRenderAddendum =
    safeStr(renderEffective?.tenantAddendum, "") || safeStr((tenant as any)?.renderingPolicy?.promptAddendum, "");

  const tenantRenderNegativeGuidance =
    safeStr(renderEffective?.tenantNegativeGuidance, "") || safeStr((tenant as any)?.renderingPolicy?.negativeGuidance, "");

  const compiledFallback = joinNonEmpty(
    [
      platformRenderPreamble && `# Platform render preamble\n${platformRenderPreamble}`,
      platformRenderTemplate && `# Platform render template\n${platformRenderTemplate}`,
      industryRenderAddendum && `# Industry render addendum\n${industryRenderAddendum}`,
      industryRenderNegative && `# Industry render negative guidance\n${industryRenderNegative}`,
      tenantRenderAddendum && `# Tenant add-on\n${tenantRenderAddendum}`,
      tenantRenderNegativeGuidance && `# Avoid / negative guidance\n${tenantRenderNegativeGuidance}`,
    ],
    "\n\n"
  );

  const compiledRenderPrompt = safeStr(renderEffective?.compiledPrompt, "") || (compiledFallback ? compiledFallback : "");

  const renderPlatformVersion = Number.isFinite(Number(platform?.version)) ? Number(platform?.version) : null;
  const renderIndustryVersion = Number.isFinite(Number((industry as any)?.version)) ? Number((industry as any)?.version) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant LLM settings</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Prompts are layered: <span className="font-mono">platform → industry → tenant</span>. Tenant entries are optional and only apply on top of the baseline.
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
              onClick={reset}
              disabled={saving || loading}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
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

        {msg ? <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${chipClass(msg.kind)}`}>{msg.text}</div> : null}

        {/* (Key UI unchanged below) */}
        <div className="mt-4 space-y-4">
          {!keyStatus ? (
            <div className={`rounded-xl border px-3 py-2 text-sm ${chipClass("info")}`}>Loading key policy…</div>
          ) : !("ok" in keyStatus) || !keyStatus.ok ? (
            <div className={`rounded-xl border px-3 py-2 text-sm ${chipClass("warn")}`}>
              Key policy status unavailable.{" "}
              <span className="opacity-80">{(keyStatus as any).message ? String((keyStatus as any).message) : ""}</span>
            </div>
          ) : (
            (() => {
              const keyKind =
                keyStatus.effectiveKeySourceNow === "tenant"
                  ? "ok"
                  : keyStatus.effectiveKeySourceNow === "platform_grace"
                    ? "warn"
                    : "err";

              const title =
                keyStatus.effectiveKeySourceNow === "tenant"
                  ? "Using tenant OpenAI key"
                  : keyStatus.effectiveKeySourceNow === "platform_grace"
                    ? "Using platform OpenAI key (tier0 / grace)"
                    : "No OpenAI key available";

              return (
                <div className={`rounded-2xl border p-4 ${chipClass(keyKind)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{title}</div>
                      <div className="mt-1 text-xs opacity-90">
                        Plan tier: <span className="font-mono">{safeStr(keyStatus.planTier, "(unknown)")}</span> · Tenant key present:{" "}
                        <span className="font-mono">{keyStatus.hasTenantOpenAiKey ? "yes" : "no"}</span>
                        {" · "}
                        Platform key present: <span className="font-mono">{keyStatus.hasPlatformKey ? "yes" : "no"}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs opacity-90">
                      <div>
                        Grace:{" "}
                        <span className="font-mono">
                          {Number(keyStatus.activationGraceUsed ?? 0)}/{Number(keyStatus.activationGraceCredits ?? 0)}
                        </span>
                      </div>
                      <div>
                        Source: <span className="font-mono">{keyStatus.effectiveKeySourceNow}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs opacity-90">
                    {safeStr(keyStatus.reason) ||
                      (keyStatus.wouldConsumeGraceOnNewQuote
                        ? "New quotes will consume a grace credit while platform key is used."
                        : "Platform key use will not consume grace for this request type.")}
                  </div>
                </div>
              );
            })()
          )}

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant OpenAI key</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Paste a key to <span className="font-semibold">set or replace</span>. We store it encrypted and never display it back.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refreshKeyStatusOnly}
                  disabled={keySaving || loading}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  Refresh status
                </button>

                <button
                  onClick={clearTenantKey}
                  disabled={keySaving || loading}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/40 dark:bg-gray-950 dark:text-red-200 dark:hover:bg-red-950/30"
                >
                  {keySaving ? "Working…" : "Clear key"}
                </button>
              </div>
            </div>

            {keyMsg ? <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${chipClass(keyMsg.kind)}`}>{keyMsg.text}</div> : null}

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
              <input
                type="password"
                value={openaiKeyInput}
                onChange={(e) => setOpenaiKeyInput(e.target.value)}
                placeholder="Paste OpenAI API key…"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
              <button
                onClick={saveTenantKey}
                disabled={keySaving || loading}
                className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              >
                {keySaving ? "Saving…" : "Save key"}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tip: If you’re testing tier/grace behavior, clear the tenant key to force platform/grace evaluation.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenant layer</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Leave blank to add nothing and inherit the baseline (platform + industry).
          </p>

          <div className="mt-4 space-y-4">
            <ModelSelect
              label="Estimator model (tenant layer)"
              options={TEXT_MODEL_OPTIONS}
              value={estimatorModel}
              onChange={setEstimatorModel}
              baselineValue={baselineEstimator}
              effectiveValue={effectiveEstimator}
              showEffectiveLine={true}
              help={`Baseline: ${baselineEstimator} · Effective: ${effectiveEstimator}`}
            />

            <ModelSelect
              label="Q&A model (tenant layer)"
              options={TEXT_MODEL_OPTIONS}
              value={qaModel}
              onChange={setQaModel}
              baselineValue={baselineQa}
              effectiveValue={effectiveQa}
              showEffectiveLine={true}
              help={`Baseline: ${baselineQa} · Effective: ${effectiveQa}`}
            />

            <ModelSelect
              label="Render image model (tenant layer)"
              options={IMAGE_MODEL_OPTIONS}
              value={renderModel}
              onChange={setRenderModel}
              baselineValue={baselineRender}
              effectiveValue={effectiveRender}
              showEffectiveLine={true}
              help="This controls which model is used by your render pipeline (when rendering is enabled)."
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
                  Tenant can only tighten. Platform cap still applies.
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
              <span className="font-mono text-gray-900 dark:text-gray-100">{safeStr(platform?.guardrails?.maxOutputTokens ?? 1200)}</span>
            </div>
          </div>
        </section>
      </div>

      <Collapsible
        title="Tenant prompt inputs"
        subtitle="Leave blank to add nothing. Preview shows baseline (platform + industry) vs effective (includes tenant)."
        defaultOpen
      >
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Extra system preamble (tenant layer)</label>
            <textarea
              value={extraSystemPreamble}
              onChange={(e) => setExtraSystemPreamble(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(none)"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quote estimator system (tenant layer)</label>
            <textarea
              value={quoteEstimatorSystem}
              onChange={(e) => setQuoteEstimatorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(none)"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-100">Q&A generator system (tenant layer)</label>
            <textarea
              value={qaQuestionGeneratorSystem}
              onChange={(e) => setQaQuestionGeneratorSystem(e.target.value)}
              className="mt-1 h-64 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              placeholder="(none)"
            />
          </div>
        </div>

        {/* PREVIEW */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Baseline (platform + industry)</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{shortTs(platform?.updatedAt)}</div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Extra system preamble</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effectiveBase?.prompts?.extraSystemPreamble ?? ""}
                </pre>
              </div>

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
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective (includes tenant)</div>

            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Extra system preamble</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective?.prompts?.extraSystemPreamble ?? ""}
                </pre>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimator</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective?.prompts?.quoteEstimatorSystem ?? ""}
                </pre>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Q&A</div>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {effective?.prompts?.qaQuestionGeneratorSystem ?? ""}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible
        title="Rendering prompt (effective)"
        subtitle="Advanced visibility only. Shows platform baseline + industry render guidance + tenant add-ons from ai-policy."
        defaultOpen={false}
      >
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {renderLayerLine("Render model (effective)", safeStr(renderEffective?.model, effectiveRender))}
            {renderLayerLine("Platform version", renderPlatformVersion !== null ? `v${renderPlatformVersion}` : "(unknown)")}
            {renderLayerLine("Industry version", renderIndustryVersion !== null ? `v${renderIndustryVersion}` : "(unknown)")}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Layers (read-only)</div>

              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Platform render preamble</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {platformRenderPreamble || "(none)"}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Platform render template</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {platformRenderTemplate || "(none)"}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Industry render addendum</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {industryRenderAddendum || "(none)"}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Industry render negative guidance</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {industryRenderNegative || "(none)"}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tenant add-on (ai-policy)</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {tenantRenderAddendum || "(none) — set on AI & Pricing Policy page"}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tenant negative guidance (ai-policy)</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {tenantRenderNegativeGuidance || "(none) — set on AI & Pricing Policy page"}
                  </pre>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-900/40">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective compiled render prompt</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {safeStr(renderEffective?.compiledPrompt) ? "From API" : "Fallback view"}
                </div>
              </div>

              {!compiledRenderPrompt ? (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${chipClass("info")}`}>Not available.</div>
              ) : (
                <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {compiledRenderPrompt}
                </pre>
              )}
            </div>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}