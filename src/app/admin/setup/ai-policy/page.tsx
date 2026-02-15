// src/app/admin/setup/ai-policy/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type AiMode = "assessment_only" | "range" | "fixed";
type RenderingStyle = "photoreal" | "clean_oem" | "custom";

type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

type PricingConfig = {
  flat_rate_default: number | null;

  hourly_labor_rate: number | null;
  material_markup_percent: number | null;

  per_unit_rate: number | null;
  per_unit_label: string | null;

  package_json: any | null;
  line_items_json: any | null;

  assessment_fee_amount: number | null;
  assessment_fee_credit_toward_job: boolean;
};

type PolicyResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      ai_policy: {
        ai_mode: AiMode;
        pricing_enabled: boolean;

        // onboarding-owned
        pricing_model?: PricingModel | null;

        // ✅ new: persisted config + suggested defaults (not persisted until Save)
        pricing_config?: PricingConfig | null;
        pricing_suggested?: PricingConfig | null;

        rendering_enabled: boolean;
        rendering_style: RenderingStyle;
        rendering_notes: string;
        rendering_max_per_day: number;
        rendering_customer_opt_in_required: boolean;

        live_qa_enabled?: boolean;
        live_qa_max_questions?: number;
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

function Card({
  title,
  desc,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={[
        "w-full text-left rounded-xl border p-4",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50",
        selected ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-xs text-gray-600">{desc}</div>
        </div>
        <div
          className={[
            "mt-1 h-5 w-5 rounded-full border flex items-center justify-center",
            selected ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
          ].join(" ")}
        >
          {selected ? <div className="h-2 w-2 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

function clampInt(v: any, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampMoney(v: any, fallback: number | null, min = 0, max = 2_000_000) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const m = Math.round(n);
  return Math.max(min, Math.min(max, m));
}

function clampPercent(v: any, fallback: number | null, min = 0, max = 500) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const p = Math.round(n);
  return Math.max(min, Math.min(max, p));
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pricingModelLabel(v: PricingModel | null | undefined) {
  switch (v) {
    case "flat_per_job":
      return "Flat price per job";
    case "hourly_plus_materials":
      return "Hourly labor + materials";
    case "per_unit":
      return "Per-unit (sq ft / linear ft / per item)";
    case "packages":
      return "Packages / tiers";
    case "line_items":
      return "Line items / menu of services";
    case "inspection_only":
      return "Quote after inspection only";
    case "assessment_fee":
      return "Assessment / diagnostic fee";
    default:
      return "Not set yet";
  }
}

function tryParseJson(s: string): { ok: true; value: any } | { ok: false; error: string } {
  const t = safeTrim(s);
  if (!t) return { ok: true, value: null };
  try {
    const v = JSON.parse(t);
    return { ok: true, value: v };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function prettyJson(v: any): string {
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

const EMPTY_PRICING_CONFIG: PricingConfig = {
  flat_rate_default: null,
  hourly_labor_rate: null,
  material_markup_percent: null,
  per_unit_rate: null,
  per_unit_label: null,
  package_json: null,
  line_items_json: null,
  assessment_fee_amount: null,
  assessment_fee_credit_toward_job: false,
};

export default function AiPolicySetupPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const onboardingMode = sp.get("onboarding") === "1";
  const returnTo = sp.get("returnTo");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [aiMode, setAiMode] = useState<AiMode>("assessment_only");
  const [pricingEnabled, setPricingEnabled] = useState(false);

  // read-only, sourced from onboarding
  const [pricingModel, setPricingModel] = useState<PricingModel | null>(null);

  // ✅ pricing config editable (stored in tenant_settings)
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>({ ...EMPTY_PRICING_CONFIG });

  // ✅ suggested defaults from server (computed, not saved until user saves)
  const [pricingSuggested, setPricingSuggested] = useState<PricingConfig | null>(null);

  // JSON editors for packages/line-items
  const [packageJsonText, setPackageJsonText] = useState("");
  const [lineItemsJsonText, setLineItemsJsonText] = useState("");
  const [pricingJsonError, setPricingJsonError] = useState<string | null>(null);

  const [renderingEnabled, setRenderingEnabled] = useState(false);
  const [renderingStyle, setRenderingStyle] = useState<RenderingStyle>("photoreal");
  const [renderingNotes, setRenderingNotes] = useState("");
  const [renderingMaxPerDay, setRenderingMaxPerDay] = useState<number>(20);
  const [renderingOptInRequired, setRenderingOptInRequired] = useState(true);

  const [liveQaEnabled, setLiveQaEnabled] = useState(false);
  const [liveQaMaxQuestions, setLiveQaMaxQuestions] = useState(3);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  function goBackToOnboarding() {
    if (returnTo) router.push(returnTo);
    else router.push("/onboarding/wizard");
  }

  function enforceUiRules(nextPricingEnabled: boolean, nextAiMode: AiMode) {
    // ✅ rule: only allow range/fixed when pricing is enabled
    if (!nextPricingEnabled) return { pricingEnabled: false, aiMode: "assessment_only" as AiMode };
    return { pricingEnabled: true, aiMode: nextAiMode };
  }

  function applySuggestedDefaults() {
    if (!pricingSuggested) return;
    setPricingConfig({ ...pricingSuggested });
    setPackageJsonText(prettyJson(pricingSuggested.package_json));
    setLineItemsJsonText(prettyJson(pricingSuggested.line_items_json));
    setPricingJsonError(null);
    setMsg("Suggested defaults applied (not saved yet).");
  }

  function patchPricingConfig(patch: Partial<PricingConfig>) {
    setPricingConfig((prev) => ({ ...prev, ...patch }));
  }

  async function load() {
    setErr(null);
    setMsg(null);
    setPricingJsonError(null);
    setLoading(true);

    try {
      // ensure cookies are sent/received
      await fetch("/api/tenant/context", { cache: "no-store", credentials: "include" });

      const res = await fetch("/api/admin/ai-policy", { cache: "no-store", credentials: "include" });
      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load AI policy");

      setRole(data.role);

      const loadedPricingEnabled = !!data.ai_policy.pricing_enabled;
      const loadedAiMode = (data.ai_policy.ai_mode ?? "assessment_only") as AiMode;
      const enforced = enforceUiRules(loadedPricingEnabled, loadedAiMode);

      setPricingEnabled(enforced.pricingEnabled);
      setAiMode(enforced.aiMode);

      setPricingModel((data.ai_policy.pricing_model ?? null) as PricingModel | null);

      // ✅ pricing config + suggested defaults
      const cfg = (data.ai_policy.pricing_config ?? null) as PricingConfig | null;
      const suggested = (data.ai_policy.pricing_suggested ?? null) as PricingConfig | null;

      setPricingConfig({ ...EMPTY_PRICING_CONFIG, ...(cfg ?? {}) });
      setPricingSuggested(suggested ?? null);

      setPackageJsonText(prettyJson(cfg?.package_json ?? null));
      setLineItemsJsonText(prettyJson(cfg?.line_items_json ?? null));

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle((data.ai_policy.rendering_style ?? "photoreal") as RenderingStyle);
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);

      setLiveQaEnabled(Boolean(data.ai_policy.live_qa_enabled));
      setLiveQaMaxQuestions(clampInt(data.ai_policy.live_qa_max_questions, 3, 1, 10));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setPricingJsonError(null);
    setSaving(true);

    try {
      const enforced = enforceUiRules(pricingEnabled, aiMode);

      // validate JSON inputs before POST
      const pkgParsed = tryParseJson(packageJsonText);
      if (!pkgParsed.ok) {
        setPricingJsonError(`Package JSON error: ${pkgParsed.error}`);
        throw new Error("Fix Package JSON before saving.");
      }
      const liParsed = tryParseJson(lineItemsJsonText);
      if (!liParsed.ok) {
        setPricingJsonError(`Line items JSON error: ${liParsed.error}`);
        throw new Error("Fix Line Items JSON before saving.");
      }

      const payload = {
        ai_mode: enforced.aiMode,
        pricing_enabled: enforced.pricingEnabled,

        // ✅ pricing config (saved in tenant_settings)
        pricing_config: {
          flat_rate_default: clampMoney(pricingConfig.flat_rate_default, null),
          hourly_labor_rate: clampMoney(pricingConfig.hourly_labor_rate, null),
          material_markup_percent: clampPercent(pricingConfig.material_markup_percent, null),
          per_unit_rate: clampMoney(pricingConfig.per_unit_rate, null),
          per_unit_label: safeTrim(pricingConfig.per_unit_label) || null,
          package_json: pkgParsed.value ?? null,
          line_items_json: liParsed.value ?? null,
          assessment_fee_amount: clampMoney(pricingConfig.assessment_fee_amount, null),
          assessment_fee_credit_toward_job: Boolean(pricingConfig.assessment_fee_credit_toward_job),
        } as PricingConfig,

        rendering_enabled: renderingEnabled,
        rendering_style: renderingStyle,
        rendering_notes: renderingNotes,
        rendering_max_per_day: Math.max(0, Math.min(1000, Number(renderingMaxPerDay) || 0)),
        rendering_customer_opt_in_required: renderingOptInRequired,

        live_qa_enabled: Boolean(liveQaEnabled),
        live_qa_max_questions: Math.max(1, Math.min(10, Number(liveQaMaxQuestions) || 3)),
      };

      const res = await fetch("/api/admin/ai-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save AI policy");

      setMsg("Saved.");
      setRole(data.role);

      const savedPricingEnabled = !!data.ai_policy.pricing_enabled;
      const savedAiMode = (data.ai_policy.ai_mode ?? "assessment_only") as AiMode;
      const ui = enforceUiRules(savedPricingEnabled, savedAiMode);

      setPricingEnabled(ui.pricingEnabled);
      setAiMode(ui.aiMode);

      setPricingModel((data.ai_policy.pricing_model ?? pricingModel ?? null) as PricingModel | null);

      // sync config back from server
      const cfg = (data.ai_policy.pricing_config ?? null) as PricingConfig | null;
      const suggested = (data.ai_policy.pricing_suggested ?? null) as PricingConfig | null;

      setPricingConfig({ ...EMPTY_PRICING_CONFIG, ...(cfg ?? {}) });
      setPricingSuggested(suggested ?? null);

      setPackageJsonText(prettyJson(cfg?.package_json ?? null));
      setLineItemsJsonText(prettyJson(cfg?.line_items_json ?? null));

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle((data.ai_policy.rendering_style ?? "photoreal") as RenderingStyle);
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);

      setLiveQaEnabled(Boolean(data.ai_policy.live_qa_enabled));
      setLiveQaMaxQuestions(clampInt(data.ai_policy.live_qa_max_questions, 3, 1, 10));

      if (onboardingMode) {
        goBackToOnboarding();
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // ✅ if user toggles pricing off, immediately snap aiMode to assessment_only
  useEffect(() => {
    if (!pricingEnabled && aiMode !== "assessment_only") {
      setAiMode("assessment_only");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingEnabled]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiModeLocked = !pricingEnabled;

  const showPricingConfig = pricingEnabled && !!pricingModel;

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {onboardingMode ? "Onboarding: AI & Pricing Policy" : "Setup: AI & Pricing Policy"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Decide what the AI returns, optionally enable renderings, and configure Live Q&amp;A.
          </p>
          {role ? (
            <div className="mt-2 text-sm">
              <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                Role: <span className="font-mono">{role}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          {onboardingMode ? (
            <button
              onClick={() => {
                if (returnTo) router.push(returnTo);
                else router.push("/onboarding/wizard");
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              ← Back to onboarding
            </button>
          ) : (
            <>
              <a
                href="/admin/setup"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
              >
                ← Setup Home
              </a>
              <button
                onClick={load}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : (
          <div className="grid gap-6">
            {!canEdit ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
                You can view this page, but only <span className="font-mono">owner</span> or{" "}
                <span className="font-mono">admin</span> can change the policy.
              </div>
            ) : null}

            {/* Pricing enabled */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Pricing Enabled</div>
                  <div className="mt-1 text-xs text-gray-600">
                    If OFF, the system will never show price numbers, and AI Mode is forced to{" "}
                    <span className="font-mono">assessment_only</span>.
                  </div>
                </div>

                <button
                  onClick={() => canEdit && setPricingEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    pricingEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {pricingEnabled ? "ON" : "OFF"}
                </button>
              </div>

              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Pricing model (from onboarding)</div>
                  <div className="mt-1 text-xs text-gray-600">
                    {pricingEnabled
                      ? "Shown for visibility. This determines which pricing inputs matter."
                      : "Hidden while pricing is disabled (model hints are ignored)."}
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                  {pricingEnabled ? pricingModelLabel(pricingModel) : "Pricing disabled"}
                </div>
              </div>

              {pricingEnabled && pricingSuggested ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <div className="text-xs text-blue-900">
                    Suggested defaults are available (computed from onboarding signals). You can apply them and then fine-tune.
                  </div>
                  <button
                    onClick={applySuggestedDefaults}
                    disabled={!canEdit}
                    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Apply suggested defaults
                  </button>
                </div>
              ) : null}
            </div>

            {/* Pricing config */}
            {showPricingConfig ? (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Pricing configuration</div>
                    <div className="mt-1 text-xs text-gray-600">
                      These inputs feed the pricing engine and become defaults used by prompts / calculations. No industry hardcoding.
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4">
                  {pricingModel === "flat_per_job" ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="text-sm font-semibold text-gray-900">Default job price</div>
                      <div className="mt-1 text-xs text-gray-600">
                        Used as a baseline when the AI returns a fixed number or range.
                      </div>
                      <div className="mt-3">
                        <input
                          type="number"
                          value={pricingConfig.flat_rate_default ?? ""}
                          onChange={(e) => patchPricingConfig({ flat_rate_default: clampMoney(e.target.value, null) })}
                          disabled={!canEdit}
                          min={0}
                          max={2000000}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                          placeholder="e.g. 500"
                        />
                      </div>
                    </div>
                  ) : null}

                  {pricingModel === "hourly_plus_materials" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Hourly labor rate</div>
                        <div className="mt-3">
                          <input
                            type="number"
                            value={pricingConfig.hourly_labor_rate ?? ""}
                            onChange={(e) => patchPricingConfig({ hourly_labor_rate: clampMoney(e.target.value, null) })}
                            disabled={!canEdit}
                            min={0}
                            max={2000000}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                            placeholder="e.g. 125"
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Material markup %</div>
                        <div className="mt-3">
                          <input
                            type="number"
                            value={pricingConfig.material_markup_percent ?? ""}
                            onChange={(e) =>
                              patchPricingConfig({ material_markup_percent: clampPercent(e.target.value, null) })
                            }
                            disabled={!canEdit}
                            min={0}
                            max={500}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                            placeholder="e.g. 30"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {pricingModel === "per_unit" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Per-unit rate</div>
                        <div className="mt-3">
                          <input
                            type="number"
                            value={pricingConfig.per_unit_rate ?? ""}
                            onChange={(e) => patchPricingConfig({ per_unit_rate: clampMoney(e.target.value, null) })}
                            disabled={!canEdit}
                            min={0}
                            max={2000000}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                            placeholder="e.g. 12"
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Unit label</div>
                        <div className="mt-1 text-xs text-gray-600">Examples: sq ft, linear ft, item, seat</div>
                        <div className="mt-3">
                          <input
                            type="text"
                            value={pricingConfig.per_unit_label ?? ""}
                            onChange={(e) => patchPricingConfig({ per_unit_label: safeTrim(e.target.value) || null })}
                            disabled={!canEdit}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                            placeholder="e.g. sq ft"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {pricingModel === "packages" ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="text-sm font-semibold text-gray-900">Packages JSON</div>
                      <div className="mt-1 text-xs text-gray-600">
                        Store your tier structure. This is saved as JSON and can power later UI/logic.
                      </div>

                      <textarea
                        value={packageJsonText}
                        onChange={(e) => setPackageJsonText(e.target.value)}
                        disabled={!canEdit}
                        rows={10}
                        className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 disabled:bg-gray-100"
                        placeholder={`Example:
{
  "tiers": [
    { "name": "Basic", "price": 500, "includes": ["..."] },
    { "name": "Standard", "price": 900, "includes": ["..."] },
    { "name": "Premium", "price": 1400, "includes": ["..."] }
  ]
}`}
                      />
                    </div>
                  ) : null}

                  {pricingModel === "line_items" ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="text-sm font-semibold text-gray-900">Line items JSON</div>
                      <div className="mt-1 text-xs text-gray-600">
                        Store menu-style items/add-ons. Saved as JSON; validation happens later at use-site.
                      </div>

                      <textarea
                        value={lineItemsJsonText}
                        onChange={(e) => setLineItemsJsonText(e.target.value)}
                        disabled={!canEdit}
                        rows={10}
                        className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 disabled:bg-gray-100"
                        placeholder={`Example:
{
  "items": [
    { "key": "base", "label": "Base service", "price": 500 },
    { "key": "pickup", "label": "Pickup / delivery", "price": 150 }
  ]
}`}
                      />
                    </div>
                  ) : null}

                  {pricingModel === "assessment_fee" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Assessment fee amount</div>
                        <div className="mt-3">
                          <input
                            type="number"
                            value={pricingConfig.assessment_fee_amount ?? ""}
                            onChange={(e) =>
                              patchPricingConfig({ assessment_fee_amount: clampMoney(e.target.value, null) })
                            }
                            disabled={!canEdit}
                            min={0}
                            max={2000000}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                            placeholder="e.g. 75"
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-semibold text-gray-900">Credit toward job</div>
                        <div className="mt-1 text-xs text-gray-600">If ON, you intend to credit the fee when work is approved.</div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-sm text-gray-700">Credit fee</span>
                          <button
                            onClick={() =>
                              canEdit &&
                              patchPricingConfig({
                                assessment_fee_credit_toward_job: !pricingConfig.assessment_fee_credit_toward_job,
                              })
                            }
                            disabled={!canEdit}
                            className={[
                              "rounded-md border px-3 py-2 text-sm font-semibold",
                              pricingConfig.assessment_fee_credit_toward_job
                                ? "border-green-300 bg-green-50 text-green-800"
                                : "border-gray-300 bg-white text-gray-800",
                              !canEdit ? "opacity-50" : "hover:bg-gray-50",
                            ].join(" ")}
                          >
                            {pricingConfig.assessment_fee_credit_toward_job ? "ON" : "OFF"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {pricingModel === "inspection_only" ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800">
                      This model means you do not provide price numbers until inspection. No additional pricing inputs required.
                    </div>
                  ) : null}

                  {pricingJsonError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 whitespace-pre-wrap">
                      {pricingJsonError}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : pricingEnabled ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800">
                Pricing is enabled, but onboarding has not set a pricing model yet. Run onboarding to select one.
              </div>
            ) : null}

            {/* AI Mode */}
            <div className="grid gap-3">
              <div className="text-sm font-semibold text-gray-900">
                AI Mode{" "}
                {!pricingEnabled ? (
                  <span className="ml-2 inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
                    Locked (pricing off)
                  </span>
                ) : null}
              </div>

              <Card
                title="Assessment only (recommended default)"
                desc="AI describes visible damage, scope, assumptions, and questions. No pricing shown."
                selected={aiMode === "assessment_only"}
                disabled={!canEdit}
                onClick={() => canEdit && setAiMode("assessment_only")}
              />
              <Card
                title="Estimate range"
                desc="AI can return a low/high range (only when Pricing Enabled is ON)."
                selected={aiMode === "range"}
                disabled={!canEdit || aiModeLocked}
                onClick={() => canEdit && !aiModeLocked && setAiMode("range")}
              />
              <Card
                title="Fixed estimate"
                desc="AI returns a single estimate (only when Pricing Enabled is ON)."
                selected={aiMode === "fixed"}
                disabled={!canEdit || aiModeLocked}
                onClick={() => canEdit && !aiModeLocked && setAiMode("fixed")}
              />

              {!pricingEnabled ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  Pricing is OFF, so AI Mode is forced to <span className="font-mono">assessment_only</span> and price numbers are always suppressed.
                </div>
              ) : null}
            </div>

            {/* Live Q&A */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Live Q&amp;A</div>
                  <div className="mt-1 text-xs text-gray-600">
                    When enabled, the quote flow asks a few quick follow-up questions before finalizing the estimate.
                  </div>
                </div>

                <button
                  onClick={() => canEdit && setLiveQaEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    liveQaEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {liveQaEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">Max questions</div>
                  <div className="mt-1 text-xs text-gray-600">Recommended: 3–5.</div>

                  <div className="mt-3 flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={liveQaMaxQuestions}
                      onChange={(e) => setLiveQaMaxQuestions(Number(e.target.value))}
                      disabled={!canEdit || !liveQaEnabled}
                      className="w-full"
                    />
                    <div className="w-10 text-right text-sm font-mono text-gray-900">{liveQaMaxQuestions}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rendering policy */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">AI Renderings</div>
                  <div className="mt-1 text-xs text-gray-600">Optional “concept render” image of the finished product.</div>
                </div>

                <button
                  onClick={() => canEdit && setRenderingEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    renderingEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {renderingEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800">Rendering style</label>
                  <select
                    value={renderingStyle}
                    onChange={(e) => setRenderingStyle(e.target.value as RenderingStyle)}
                    disabled={!canEdit || !renderingEnabled}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                  >
                    <option value="photoreal">Photoreal concept</option>
                    <option value="clean_oem">Clean OEM refresh</option>
                    <option value="custom">Custom / show-style</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800">House style notes (optional)</label>
                  <textarea
                    value={renderingNotes}
                    onChange={(e) => setRenderingNotes(e.target.value)}
                    disabled={!canEdit || !renderingEnabled}
                    rows={4}
                    placeholder="Example: Keep original stitching pattern; show clean restored bolsters…"
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800">Max renderings per day</label>
                    <input
                      type="number"
                      value={renderingMaxPerDay}
                      onChange={(e) => setRenderingMaxPerDay(parseInt(e.target.value || "0", 10))}
                      disabled={!canEdit || !renderingEnabled}
                      min={0}
                      max={1000}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                    />
                    <p className="mt-1 text-xs text-gray-500">0 means disabled by rate limit.</p>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Customer opt-in required</div>
                        <div className="mt-1 text-xs text-gray-600">
                          If ON, the public form shows a checkbox and only renders when the customer opts in.
                        </div>
                      </div>

                      <button
                        onClick={() => canEdit && setRenderingOptInRequired((v) => !v)}
                        disabled={!canEdit || !renderingEnabled}
                        className={[
                          "rounded-md border px-3 py-2 text-sm font-semibold",
                          renderingOptInRequired
                            ? "border-green-300 bg-green-50 text-green-800"
                            : "border-gray-300 bg-white text-gray-800",
                          !canEdit || !renderingEnabled ? "opacity-50" : "hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {renderingOptInRequired ? "ON" : "OFF"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-4">
              <button
                onClick={save}
                disabled={!canEdit || saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : onboardingMode ? "Save & return to onboarding" : "Save Policy"}
              </button>

              {msg && <span className="text-sm text-green-700">{msg}</span>}
              {err && <span className="text-sm text-red-700 whitespace-pre-wrap">{err}</span>}
            </div>

            {!onboardingMode ? (
              <div className="flex gap-2">
                <a
                  href="/admin/setup/widget"
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  Next: Widget setup →
                </a>
                <a
                  href="/quote"
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  Run a test quote →
                </a>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}