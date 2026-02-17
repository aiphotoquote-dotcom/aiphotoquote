// src/lib/pcc/llm/resolveTenant.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantSettings, tenantPricingRules } from "@/lib/db/schema";

import { getPlatformLlm } from "@/lib/pcc/llm/apply";

import { getTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

import { buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";

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
 * ✅ Unified render opt-in rules:
 * - If rendering disabled => false
 * - If opt-in required:
 *    - customerOptIn true => true
 *    - missing/false => false
 * - If opt-in NOT required:
 *    - default true (unless explicitly false provided)
 */
export function computeRenderOptIn(args: {
  tenantRenderEnabled: boolean;
  renderCustomerOptInRequired: boolean;
  customerOptIn: boolean | null | undefined;
}): boolean {
  const { tenantRenderEnabled, renderCustomerOptInRequired, customerOptIn } = args;

  if (!tenantRenderEnabled) return false;

  if (renderCustomerOptInRequired) {
    return customerOptIn === true;
  }

  if (customerOptIn === false) return false;
  return true;
}

/**
 * Minimal runtime guard for the platform cfg shape expected by buildEffectiveLlmConfig.
 * We avoid importing a type that may not be exported in this branch.
 */
function normalizePlatformCfg(platformAny: any) {
  const cfg = platformAny?.cfg ?? platformAny;

  const ok =
    cfg &&
    typeof cfg === "object" &&
    typeof cfg.version === "number" &&
    typeof cfg.updatedAt === "string" &&
    cfg.models &&
    typeof cfg.models === "object" &&
    typeof cfg.models.estimatorModel === "string" &&
    typeof cfg.models.qaModel === "string" &&
    cfg.prompts &&
    typeof cfg.prompts === "object" &&
    typeof cfg.prompts.quoteEstimatorSystem === "string" &&
    typeof cfg.prompts.qaQuestionGeneratorSystem === "string" &&
    cfg.guardrails &&
    typeof cfg.guardrails === "object" &&
    Array.isArray(cfg.guardrails.blockedTopics) &&
    typeof cfg.guardrails.maxQaQuestions === "number";

  if (!ok) {
    const e: any = new Error("PLATFORM_LLM_CONFIG_INVALID");
    e.code = "PLATFORM_LLM_CONFIG_INVALID";
    throw e;
  }

  return cfg as any;
}

/**
 * Tenant + PCC resolver:
 * - PCC provides platform defaults + guardrails
 * - Industry pack will be DB-backed (placeholder now: empty)
 * - Tenant overrides via tenant_llm_overrides (jsonb)
 * - TenantSettings provides feature toggles (rendering/QA/pricing gates)
 */
export async function resolveTenantLlm(tenantId: string) {
  const platformAny: any = await getPlatformLlm();
  const platformCfg = normalizePlatformCfg(platformAny);

  // Tenant settings (feature gates + render prefs + pricing gates)
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

      // Optional: mode selector stored in DB
      aiMode: tenantSettings.aiMode,

      // Pricing gate (numbers allowed)
      pricingEnabled: tenantSettings.pricingEnabled,

      // Pricing model + config (hybrid)
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

      // Industry key (used to load industry pack later)
      industryKey: tenantSettings.industryKey,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  // Pricing guardrails (optional)
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

  // Tenant overrides (models/prompts) from tenant_llm_overrides
  const tenantRow = await getTenantLlmOverrides(tenantId);
  const tenantOverrides: TenantLlmOverrides | null = tenantRow
    ? normalizeTenantOverrides({
        models: tenantRow.models ?? {},
        prompts: tenantRow.prompts ?? {},
        updatedAt: tenantRow.updatedAt ?? undefined,
      })
    : null;

  // ✅ Industry pack placeholder (DB-backed soon). Must NOT hardcode.
  const industryKey = safeTrim(settings?.industryKey) || null;
  const industry = {}; // <-- intentionally empty for now

  // Effective LLM config (platform + industry + tenant additions)
  const effectiveBundle = buildEffectiveLlmConfig({
    platform: platformCfg,
    industry,
    tenant: tenantOverrides,
  });

  const effective = effectiveBundle.effective;

  // Tenant render / QA gates
  const tenantRenderEnabled = settings?.aiRenderingEnabled === true;
  const renderCustomerOptInRequired = settings?.renderingCustomerOptInRequired === true;

  const tenantQaEnabled = settings?.liveQaEnabled === true;
  const tenantQaMaxRaw = Number(settings?.liveQaMaxQuestions ?? 3);
  const tenantQaMax = Number.isFinite(tenantQaMaxRaw) ? Math.max(1, Math.min(10, Math.floor(tenantQaMaxRaw))) : 3;
  const platformQaMax = Number(effective.guardrails?.maxQaQuestions ?? 3);

  const liveQaEnabled = tenantQaEnabled;
  const liveQaMaxQuestions = tenantQaEnabled ? Math.min(tenantQaMax, platformQaMax) : 0;

  // Pricing enabled gate
  const pricingEnabled = settings?.pricingEnabled === true;

  // Pricing model + config normalization (only when pricingEnabled === true)
  const pricingModel = pricingEnabled ? safePricingModel(settings?.pricingModel) : null;

  const pricingConfig = pricingEnabled
    ? {
        model: pricingModel,

        flatRateDefault: clampMoneyInt(settings?.flatRateDefault, null),

        hourlyLaborRate: clampMoneyInt(settings?.hourlyLaborRate, null),
        materialMarkupPercent: clampPercent(settings?.materialMarkupPercent, null),

        perUnitRate: clampMoneyInt(settings?.perUnitRate, null),
        perUnitLabel: safeTrim(settings?.perUnitLabel) || null,

        packageJson: (settings?.packageJson ?? null) as any,
        lineItemsJson: (settings?.lineItemsJson ?? null) as any,

        assessmentFeeAmount: clampMoneyInt(settings?.assessmentFeeAmount, null),
        assessmentFeeCreditTowardJob: settings?.assessmentFeeCreditTowardJob === true,
      }
    : null;

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
    platform: platformCfg,

    models: {
      estimatorModel: effective.models.estimatorModel,
      qaModel: effective.models.qaModel,
      renderModel: effective.models.renderModel,
    },
    prompts: {
      quoteEstimatorSystem: effective.prompts.quoteEstimatorSystem,
      qaQuestionGeneratorSystem: effective.prompts.qaQuestionGeneratorSystem,
    },
    guardrails: effective.guardrails,

    tenant: {
      tenantRenderEnabled,
      renderCustomerOptInRequired,
      tenantStyleKey: safeTrim(settings?.renderingStyle) || null,
      tenantRenderNotes: safeTrim(settings?.renderingNotes) || null,
      liveQaEnabled,
      liveQaMaxQuestions,
      aiMode: safeTrim(settings?.aiMode) || null,
      pricingEnabled,
    },

    pricing: pricingEnabled
      ? {
          config: pricingConfig,
          rules: normalizedPricingRules,
        }
      : null,

    meta: {
      industryKey,
      hasTenantOverrides: Boolean(tenantOverrides),
      tenantOverridesUpdatedAt: tenantOverrides?.updatedAt ?? null,
      effectiveVersion: platformCfg?.version ?? null,
      platformUpdatedAt: platformCfg?.updatedAt ?? null,
    },
  };
}