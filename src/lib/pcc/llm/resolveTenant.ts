// src/lib/pcc/llm/resolveTenant.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantSettings, tenantPricingRules } from "@/lib/db/schema";
import { getPlatformLlm } from "./apply";

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
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  // Pricing guardrails (optional — used in prompts later if you want)
  const pricing = await db
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

  return {
    platform,
    models: { estimatorModel, qaModel, renderModel },
    prompts: platform.prompts,
    guardrails: platform.guardrails,

    tenant: {
      tenantRenderEnabled,
      renderCustomerOptInRequired,
      tenantStyleKey: (settings?.renderingStyle ?? "").trim() || null,
      tenantRenderNotes: (settings?.renderingNotes ?? "").trim() || null,
      liveQaEnabled,
      liveQaMaxQuestions,
      aiMode: (settings?.aiMode ?? "").trim() || null,
    },

    pricing,
  };
}