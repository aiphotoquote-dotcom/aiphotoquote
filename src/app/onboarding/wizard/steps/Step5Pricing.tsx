// src/app/onboarding/wizard/steps/Step5Pricing.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type AiMode = "assessment_only" | "range" | "fixed";
type RenderingStyle = "photoreal" | "clean_oem" | "custom";

type PolicyResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      ai_policy: {
        ai_mode: AiMode;
        pricing_enabled: boolean;

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

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Card({
  title,
  desc,
  selected,
  onClick,
  disabled,
}: {
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded-2xl border p-4 shadow-sm transition",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        selected
          ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-gray-200 bg-white hover:bg-gray-50 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs opacity-80">{desc}</div>
        </div>
        <div
          className={cn(
            "mt-1 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center",
            selected ? "border-emerald-600 bg-emerald-600" : "border-gray-300 bg-white dark:border-gray-700 dark:bg-black"
          )}
        >
          {selected ? <div className="h-2 w-2 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

/**
 * NOTE:
 * “How do you charge?” is not wired to DB yet (tenant_settings).
 * We collect it now for UX and stash in sessionStorage. We'll persist it later.
 */
type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

function readPricingModel(): PricingModel | "" {
  try {
    const v = window.sessionStorage.getItem("apq_onboarding_pricing_model") || "";
    return (v as any) || "";
  } catch {
    return "";
  }
}

function writePricingModel(v: PricingModel) {
  try {
    window.sessionStorage.setItem("apq_onboarding_pricing_model", v);
  } catch {
    // ignore
  }
}

export function Step5Pricing(props: {
  tenantId: string | null;
  ensureActiveTenant: (tid: string) => Promise<void>;
  onBack: () => void;
  onSaved: () => void;
  onError: (m: string) => void;

  // Optional: allow jumping into full policy screen
  onOpenAdvancedPolicy?: () => void;
}) {
  const tid = safeTrim(props.tenantId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [aiMode, setAiMode] = useState<AiMode>("assessment_only");
  const [pricingEnabled, setPricingEnabled] = useState<boolean>(false);

  // keep the rest so we can re-post full policy without wiping settings
  const [policyRest, setPolicyRest] = useState<any>(null);

  const [pricingModel, setPricingModel] = useState<PricingModel | "">("");

  const [err, setErr] = useState<string | null>(null);
  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  async function load() {
    setErr(null);
    setLoading(true);

    try {
      if (!tid) throw new Error("NO_TENANT: missing tenantId for pricing step.");

      await props.ensureActiveTenant(tid);

      const res = await fetch("/api/admin/ai-policy", { cache: "no-store", credentials: "include" });
      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load AI policy");

      setRole(data.role);
      setAiMode(data.ai_policy.ai_mode);
      setPricingEnabled(!!data.ai_policy.pricing_enabled);

      // keep the rest so we can post back without clobbering
      setPolicyRest(data.ai_policy);

      // restore cached “how you charge”
      setPricingModel(readPricingModel());
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function saveAndContinue() {
    setErr(null);
    setSaving(true);

    try {
      if (!tid) throw new Error("NO_TENANT: missing tenantId for pricing save.");
      await props.ensureActiveTenant(tid);

      if (!canEdit) throw new Error("You can view this step, but only owner/admin can save pricing policy.");

      if (!pricingModel) throw new Error("Please choose how you usually charge before continuing.");

      if (!policyRest || typeof policyRest !== "object") {
        throw new Error("Policy not loaded yet. Please refresh and try again.");
      }

      // stash pricing model for now (future: persist in tenant_settings)
      writePricingModel(pricingModel as PricingModel);

      const payload = {
        // what Step5 owns
        ai_mode: aiMode,
        pricing_enabled: pricingEnabled,

        // preserve everything else
        rendering_enabled: !!policyRest.rendering_enabled,
        rendering_style: (policyRest.rendering_style ?? "photoreal") as RenderingStyle,
        rendering_notes: policyRest.rendering_notes ?? "",
        rendering_max_per_day: Number(policyRest.rendering_max_per_day ?? 20) || 0,
        rendering_customer_opt_in_required: !!policyRest.rendering_customer_opt_in_required,

        live_qa_enabled: Boolean(policyRest.live_qa_enabled),
        live_qa_max_questions: Number(policyRest.live_qa_max_questions ?? 3) || 3,
      };

      const res = await fetch("/api/admin/ai-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save AI policy");

      // keep UI in sync (in case backend normalizes)
      setRole(data.role);
      setAiMode(data.ai_policy.ai_mode);
      setPricingEnabled(!!data.ai_policy.pricing_enabled);
      setPolicyRest(data.ai_policy);

      props.onSaved();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      props.onError(msg);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  const pricingModelLabel = useMemo(() => {
    switch (pricingModel) {
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
        return "";
    }
  }, [pricingModel]);

  const canSave = Boolean(tid) && !loading && canEdit && Boolean(pricingModel) && !saving;

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Pricing setup</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Tell us how you price work — this controls what the AI is allowed to show customers.
      </div>

      <div className="mt-5 grid gap-4">
        {err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            Loading pricing policy…
          </div>
        ) : (
          <>
            {/* A) How they charge */}
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">How do you usually charge?</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                This helps tailor defaults. (We’ll persist this in tenant settings next.)
              </div>

              <div className="mt-4 grid gap-3">
                <Card
                  title="Flat price per job"
                  desc="One number for the whole job."
                  selected={pricingModel === "flat_per_job"}
                  onClick={() => setPricingModel("flat_per_job")}
                />
                <Card
                  title="Hourly labor + materials"
                  desc="Labor hours plus material costs/markup."
                  selected={pricingModel === "hourly_plus_materials"}
                  onClick={() => setPricingModel("hourly_plus_materials")}
                />
                <Card
                  title="Per-unit pricing"
                  desc="Sq ft, linear ft, per panel/room/item, etc."
                  selected={pricingModel === "per_unit"}
                  onClick={() => setPricingModel("per_unit")}
                />
                <Card
                  title="Packages / tiers"
                  desc="Basic / Standard / Premium packages."
                  selected={pricingModel === "packages"}
                  onClick={() => setPricingModel("packages")}
                />
                <Card
                  title="Line items / menu of services"
                  desc="Add-ons and service items combine into a total."
                  selected={pricingModel === "line_items"}
                  onClick={() => setPricingModel("line_items")}
                />
                <Card
                  title="Quote after inspection only"
                  desc="No photo estimates — must inspect first."
                  selected={pricingModel === "inspection_only"}
                  onClick={() => setPricingModel("inspection_only")}
                />
                <Card
                  title="Assessment / diagnostic fee"
                  desc="Charge for assessment (optional credit toward job)."
                  selected={pricingModel === "assessment_fee"}
                  onClick={() => setPricingModel("assessment_fee")}
                />
              </div>

              {pricingModelLabel ? (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">SELECTED</div>
                  <div className="mt-1 text-base font-bold">{pricingModelLabel}</div>
                </div>
              ) : null}
            </div>

            {/* B) What should AI output */}
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">What should customers receive?</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                This maps to your AI policy and controls whether numbers are shown.
              </div>

              <div className="mt-4 grid gap-3">
                <Card
                  title="Assessment only"
                  desc="Scope + questions, but no price numbers."
                  selected={aiMode === "assessment_only"}
                  onClick={() => setAiMode("assessment_only")}
                  disabled={!canEdit}
                />
                <Card
                  title="Assessment + price range"
                  desc="A low/high range when possible."
                  selected={aiMode === "range"}
                  onClick={() => setAiMode("range")}
                  disabled={!canEdit}
                />
                <Card
                  title="Rough estimate"
                  desc="Single-number estimate (best for standardized services)."
                  selected={aiMode === "fixed"}
                  onClick={() => setAiMode("fixed")}
                  disabled={!canEdit}
                />
              </div>

              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enable pricing</div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      If off, we never show price numbers even if the mode supports it.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => canEdit && setPricingEnabled((v) => !v)}
                    disabled={!canEdit}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-semibold",
                      pricingEnabled
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                        : "border-gray-300 bg-white text-gray-800 dark:border-gray-700 dark:bg-black dark:text-gray-200",
                      !canEdit ? "opacity-50" : "hover:bg-gray-50 dark:hover:bg-gray-900"
                    )}
                  >
                    {pricingEnabled ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              {!canEdit ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  You can view this step, but only <span className="font-mono">owner</span> or{" "}
                  <span className="font-mono">admin</span> can save the policy.
                </div>
              ) : null}

              {props.onOpenAdvancedPolicy ? (
                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                  onClick={props.onOpenAdvancedPolicy}
                  disabled={saving}
                >
                  Advanced: open full AI Policy settings
                </button>
              ) : null}
            </div>

            {/* Nav */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                onClick={props.onBack}
                disabled={saving}
              >
                Back
              </button>

              <button
                type="button"
                className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                onClick={() => saveAndContinue().catch(() => null)}
                disabled={!canSave}
                title={!pricingModel ? "Choose how you charge to continue" : undefined}
              >
                {saving ? "Saving…" : "Save & continue →"}
              </button>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400">
              You can’t proceed until you choose how you charge (prevents skipping this step).
            </div>
          </>
        )}
      </div>
    </div>
  );
}