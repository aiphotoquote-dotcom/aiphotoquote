// src/lib/pcc/llm/resolveTenant.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantSettings, tenantPricingRules } from "@/lib/db/schema";

import { getPlatformLlm } from "./apply";
import { getIndustryDefaults, buildEffectiveLlmConfig } from "./effective";
import { getTenantLlmOverrides } from "./tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "./tenantTypes";

type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function clampMoneyInt(v: unknown, fallback: number | null, min = 0, max = 2_000_000) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const m = Math.round(n);
  return Math.max(min, Math.min(max, m));
}

function clampPercent(v: unknown, fallback: number | null, min = 0, max = 500) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const p = Math.round(n);
  return Math.max(min, Math.min(max, p));
}

function safePricingModel(v: unknown): PricingModel | null {
  const s = safeTrim(v);
  if (
    s === "flat_per_job" ||
    s === "hourly_plus_materials" ||
    s === "per_unit" ||
    s === "packages" ||
    s === "line_items" ||
    s === "inspection_only" ||
    s === "assessment_fee"
  ) {
    return s;
  }
  return null;
}

/**
 * ✅ Single source of truth for render opt-in logic.
 *
 * Rules:
 * - If tenant rendering is disabled -> renderOptIn is always false.
 * - If rendering is enabled:
 *   - If customer opt-in is required -> renderOptIn equals user choice.
 *   - If opt-in is NOT required -> renderOptIn is true by default (auto render).
 */
export function computeRenderOptIn(args: {
  tenantRenderEnabled: boolean;
  renderCustomerOptInRequired: boolean;
  customerOptIn?: boolean | null;
}) {
  if (!args.tenantRenderEnabled) return false;
  if (args.renderCustomerOptInRequired) return Boolean(args.customerOptIn);
  return true;
}

/**
 * Tenant + PCC resolver:
 * - Platform provides defaults + guardrails + industry packs
 * - Industry defaults apply based on tenant_settings.industry_key (or caller-provided industryKey elsewhere)
 * - Tenant can override via tenant_llm_overrides (managed by Admin LLM Settings page)
 * - No env vars for tenant model selection
 */
export async function resolveTenantLlm(tenantId: string) {
  // Platform config (base)
  const platform = await getPlatformLlm();

  // Tenant settings (toggles + pricing + render prefs + industry key)
  const settings = await db
    .select({
      // industry
      industryKey: tenantSettings.industryKey,

      // AI toggles + render prefs
      aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
      renderingStyle: tenantSettings.renderingStyle,
      renderingNotes: tenantSettings.renderingNotes,
      renderingCustomerOptInRequired: tenantSettings.renderingCustomerOptInRequired,

      // Live QA
      liveQaEnabled: tenantSettings.liveQaEnabled,
      liveQaMaxQuestions: tenantSettings.liveQaMaxQuestions,

      // Optional: ai mode
      aiMode: tenantSettings.aiMode,

      // ✅ PRICING gate (numbers allowed)
      pricingEnabled: tenantSettings.pricingEnabled,

      // ✅ Pricing model + config (hybrid)
      pricingModel: tenantSettings.pricingModel,

      flatRateDefault: tenantSettings.flatRateDefault,
      hourlyLaborRate: tenantSettings.hourlyLaborRate,
      materialMarkupPercent: tenantSettings.materialMarkupPercent,

      perUnitRate: tenantSettings.perUnitRate,
      perUnitLabel: tenantSettings.perUnitLabel,

      packageJson: tenantSettings.packageJson,
      lineItemsJson: tenantSettings.lineItemsJson,

      assessmentFeeAmount: tenantSettings.assessmentFeeAmount,
      assessmentFeeCreditTowardJob: tenantSettings.assessmentFeeCreditTowardJob,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  // Pricing guardrails (optional — used in computeEstimate + prompt composition)
  const pricingRules = await db
    .select({
      minJob: tenantPricingRules.minJob,
      typicalLow: tenantPricingRules.typicalLow,
      typicalHigh: tenantPricingRules.typicalHigh,
      maxWithoutInspection: tenantPricingRules.maxWithoutInspection,
      tone: tenantPricingRules.tone,
      riskPosture: tenantPricingRules.riskPosture,
      alwaysEstimateLanguage: tenantPricingRules.alwaysEstimateLanguage,
    })
    .from(tenantPricingRules)
    .where(eq(tenantPricingRules.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  // Industry defaults derived from tenant settings
  const industryKey = safeTrim(settings?.industryKey) || null;
  const industry = getIndustryDefaults(industryKey);

  // Tenant overrides from tenant_llm_overrides (saved by Admin LLM Settings page)
  const tenantRow = await getTenantLlmOverrides(tenantId);
  const tenantOverrides: TenantLlmOverrides | null = tenantRow
    ? normalizeTenantOverrides({
        models: tenantRow.models ?? {},
        prompts: tenantRow.prompts ?? {},
        updatedAt: tenantRow.updatedAt ?? undefined,
      })
    : null;

  // ✅ Effective LLM config (platform + industry + tenant overrides)
  const effectiveBundle = buildEffectiveLlmConfig({
    platform,
    industry,
    tenant: tenantOverrides,
  });

  const effective = effectiveBundle.effective;

  // Render policy
  const tenantRenderEnabled = settings?.aiRenderingEnabled === true;
  const renderCustomerOptInRequired = settings?.renderingCustomerOptInRequired === true;

  // Live QA caps: tenant can only lower, PCC caps the max.
  const tenantQaEnabled = settings?.liveQaEnabled === true;
  const tenantQaMaxRaw = Number(settings?.liveQaMaxQuestions ?? 3);
  const tenantQaMax = Number.isFinite(tenantQaMaxRaw) ? Math.max(1, Math.min(10, Math.floor(tenantQaMaxRaw))) : 3;
  const platformQaMax = effective.guardrails.maxQaQuestions;

  const liveQaEnabled = tenantQaEnabled;
  const liveQaMaxQuestions = tenantQaEnabled ? Math.min(tenantQaMax, platformQaMax) : 0;

  // ✅ Pricing enabled gate
  const pricingEnabled = settings?.pricingEnabled === true;

  // ✅ Pricing model + config normalization (only when pricingEnabled === true)
  const pricingModel = pricingEnabled ? safePricingModel(settings?.pricingModel) : null;

  const pricingConfig = pricingEnabled
    ? {
        model: pricingModel,

        // flat
        flatRateDefault: clampMoneyInt(settings?.flatRateDefault, null),

        // hourly + materials
        hourlyLaborRate: clampMoneyInt(settings?.hourlyLaborRate, null),
        materialMarkupPercent: clampPercent(settings?.materialMarkupPercent, null),

        // per-unit
        perUnitRate: clampMoneyInt(settings?.perUnitRate, null),
        perUnitLabel: safeTrim(settings?.perUnitLabel) || null,

        // packages / line items (structure validated later at use-site)
        packageJson: (settings?.packageJson ?? null) as any,
        lineItemsJson: (settings?.lineItemsJson ?? null) as any,

        // assessment fee
        assessmentFeeAmount: clampMoneyInt(settings?.assessmentFeeAmount, null),
        assessmentFeeCreditTowardJob: settings?.assessmentFeeCreditTowardJob === true,
      }
    : null;

  // ✅ Normalize guardrails too (only when pricingEnabled === true)
  const normalizedPricingRules =
    pricingEnabled && pricingRules
      ? {
          minJob: clampMoneyInt(pricingRules.minJob, null),
          typicalLow: clampMoneyInt(pricingRules.typicalLow, null),
          typicalHigh: clampMoneyInt(pricingRules.typicalHigh, null),
          maxWithoutInspection: clampMoneyInt(pricingRules.maxWithoutInspection, null),
          tone: safeTrim(pricingRules.tone) || "value",
          riskPosture: safeTrim(pricingRules.riskPosture) || "conservative",
          alwaysEstimateLanguage: pricingRules.alwaysEstimateLanguage !== false,
        }
      : null;

  return {
    platform, // keep for debugging / transparency

    // ✅ Effective models/prompts/guardrails are what the quoting pipeline should use
    models: {
      estimatorModel: effective.models.estimatorModel,
      qaModel: effective.models.qaModel,
      renderModel: effective.models.renderModel,
    },
    prompts: effective.prompts,
    guardrails: effective.guardrails,

    tenant: {
      // Render policy + style
      tenantRenderEnabled,
      renderCustomerOptInRequired,
      tenantStyleKey: safeTrim(settings?.renderingStyle) || null,
      tenantRenderNotes: safeTrim(settings?.renderingNotes) || null,

      // QA policy
      liveQaEnabled,
      liveQaMaxQuestions,

      // other
      aiMode: safeTrim(settings?.aiMode) || null,

      // ✅ gate for “numbers”
      pricingEnabled,
    },

    // ✅ Only expose pricing payload when enabled
    pricing: pricingEnabled
      ? {
          config: pricingConfig,
          rules: normalizedPricingRules,
        }
      : null,

    // Optional: meta/debug (safe to ignore by callers)
    meta: {
      industryKeyApplied: industryKey,
      tenantOverridesUpdatedAt: tenantOverrides?.updatedAt ?? null,
      effectiveComposition: effectiveBundle?.meta ?? null,
    },
  };
}