// src/lib/pcc/llm/resolveTenant.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantSettings, tenantPricingRules } from "@/lib/db/schema";
import { getPlatformLlm } from "./apply";

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

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
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
 * Tenant + PCC resolver:
 * - PCC provides defaults + allowed guardrails
 * - Tenant can override via settings (drop-down selection stored in DB)
 * - NO env vars for tenant model selection
 */
export async function resolveTenantLlm(tenantId: string) {
  const platform = await getPlatformLlm();

  const settings = await db
    .select({
      // AI toggles + render prefs
      aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
      renderingStyle: tenantSettings.renderingStyle,
      renderingNotes: tenantSettings.renderingNotes,
      renderingCustomerOptInRequired: tenantSettings.renderingCustomerOptInRequired,

      // Live QA
      liveQaEnabled: tenantSettings.liveQaEnabled,
      liveQaMaxQuestions: tenantSettings.liveQaMaxQuestions,

      // Optional: model selector stored in DB (if you add it later)
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

  // Pricing guardrails (optional — used in prompts later if you want)
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

  // ✅ Model selection rules:
  // Today: just use PCC defaults.
  // Later: if tenantSettings.aiMode is a DB dropdown (e.g., "fast", "balanced", "best"),
  // map it to specific PCC models here. Still NO env vars.
  const estimatorModel = platform.models.estimatorModel;
  const qaModel = platform.models.qaModel;
  const renderModel = platform.models.renderModel;

  const tenantRenderEnabled = settings?.aiRenderingEnabled === true;
  const renderCustomerOptInRequired = settings?.renderingCustomerOptInRequired === true;

  // Live QA caps: tenant can only lower, PCC caps the max.
  const tenantQaEnabled = settings?.liveQaEnabled === true;
  const tenantQaMaxRaw = Number(settings?.liveQaMaxQuestions ?? 3);
  const tenantQaMax = Number.isFinite(tenantQaMaxRaw) ? Math.max(1, Math.min(10, Math.floor(tenantQaMaxRaw))) : 3;
  const platformQaMax = platform.guardrails.maxQaQuestions;

  const liveQaEnabled = tenantQaEnabled;
  const liveQaMaxQuestions = tenantQaEnabled ? Math.min(tenantQaMax, platformQaMax) : 0;

  // ✅ Pricing enabled gate
  const pricingEnabled = settings?.pricingEnabled === true;

  // ✅ Pricing model + config normalization (used by quote engine to compute deterministically)
  const pricingModel = safePricingModel(settings?.pricingModel);

  const pricingConfig = {
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
  };

  // ✅ Normalize guardrails too (so downstream doesn’t have to)
  const normalizedPricingRules = pricingRules
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
    platform,
    models: { estimatorModel, qaModel, renderModel },
    prompts: platform.prompts,
    guardrails: platform.guardrails,

    tenant: {
      tenantRenderEnabled,
      renderCustomerOptInRequired,
      tenantStyleKey: safeTrim(settings?.renderingStyle) || null,
      tenantRenderNotes: safeTrim(settings?.renderingNotes) || null,
      liveQaEnabled,
      liveQaMaxQuestions,
      aiMode: safeTrim(settings?.aiMode) || null,

      // ✅ gate for “numbers”
      pricingEnabled,
    },

    // ✅ Hybrid pricing payload (AI suggests, backend computes)
    pricing: {
      config: pricingConfig,
      rules: normalizedPricingRules,
    },
  };
}