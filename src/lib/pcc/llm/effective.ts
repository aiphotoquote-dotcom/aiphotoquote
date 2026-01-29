// src/lib/pcc/llm/effective.ts
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";
import type { TenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";

/**
 * Industry defaults are "locked templates" that sit between platform and tenant.
 * For now: keep these light. You can evolve to DB-backed per-industry prompt packs later.
 */
export function getIndustryDefaults(industryKey: string | null | undefined): Partial<PlatformLlmConfig> {
  const key = String(industryKey || "").toLowerCase().trim();

  // Default: no special overrides
  if (!key) return {};

  // Example: you can specialize prompts by industry without changing guardrails
  if (key === "marine") {
    return {
      prompts: {
        extraSystemPreamble: [
          "You are producing an estimate for legitimate marine service work.",
          "Assume salt + sun exposure can accelerate wear; ask clarifying questions if unclear.",
        ].join("\n"),
      } as any,
    };
  }

  if (key === "auto") {
    return {
      prompts: {
        extraSystemPreamble: [
          "You are producing an estimate for legitimate automotive service work.",
          "Pay attention to OEM fitment and safety-related trim constraints; ask clarifying questions if needed.",
        ].join("\n"),
      } as any,
    };
  }

  if (key === "motorcycle") {
    return {
      prompts: {
        extraSystemPreamble: [
          "You are producing an estimate for legitimate motorcycle service work.",
          "Pay attention to weather exposure, UV, and seam durability; ask clarifying questions if unclear.",
        ].join("\n"),
      } as any,
    };
  }

  // "service" or unknown
  return {};
}

function safeStr(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

function minInt(a: unknown, b: unknown, fallback: number) {
  const na = Number(a);
  const nb = Number(b);
  const va = Number.isFinite(na) ? Math.floor(na) : fallback;
  const vb = Number.isFinite(nb) ? Math.floor(nb) : fallback;
  return Math.min(va, vb);
}

/**
 * Merge rules:
 * - guardrails are LOCKED to platform (tenant cannot change)
 * - maxQaQuestions: tenant may only tighten: min(platform, tenant)
 * - prompts: tenant may override prompt bodies; platform extra preamble always prepends
 * - industry provides defaults between platform and tenant
 */
export function buildEffectiveLlmConfig(args: {
  platform: PlatformLlmConfig;
  industry: Partial<PlatformLlmConfig>;
  tenant: TenantLlmOverrides | null;
}) {
  const { platform, industry, tenant } = args;

  const platformP = platform.prompts ?? ({} as any);
  const industryP = (industry.prompts ?? {}) as any;
  const tenantP = (tenant?.prompts ?? {}) as any;

  const extraSystemPreamble =
    safeStr(tenantP.extraSystemPreamble) ||
    safeStr(industryP.extraSystemPreamble) ||
    safeStr(platformP.extraSystemPreamble) ||
    "";

  const quoteEstimatorSystem =
    safeStr(tenantP.quoteEstimatorSystem) ||
    safeStr(industryP.quoteEstimatorSystem) ||
    safeStr(platformP.quoteEstimatorSystem) ||
    "";

  const qaQuestionGeneratorSystem =
    safeStr(tenantP.qaQuestionGeneratorSystem) ||
    safeStr(industryP.qaQuestionGeneratorSystem) ||
    safeStr(platformP.qaQuestionGeneratorSystem) ||
    "";

  // Always prepend extra preamble if present
  const estimatorSystemFinal = [extraSystemPreamble, quoteEstimatorSystem].filter(Boolean).join("\n\n");
  const qaSystemFinal = [extraSystemPreamble, qaQuestionGeneratorSystem].filter(Boolean).join("\n\n");

  const platformModels = platform.models ?? ({} as any);
  const industryModels = (industry.models ?? {}) as any;
  const tenantModels = (tenant?.models ?? {}) as any;

  const estimatorModel =
    safeStr(tenantModels.estimatorModel) ||
    safeStr(industryModels.estimatorModel) ||
    safeStr(platformModels.estimatorModel) ||
    "gpt-4o-mini";

  const qaModel =
    safeStr(tenantModels.qaModel) || safeStr(industryModels.qaModel) || safeStr(platformModels.qaModel) || "gpt-4o-mini";

  const renderModel =
    safeStr(tenantModels.renderModel) ||
    safeStr(industryModels.renderModel) ||
    safeStr(platformModels.renderModel) ||
    "gpt-image-1";

  // Guardrails are platform-locked
  const g = platform.guardrails ?? ({} as any);

  // Tenant can only tighten maxQaQuestions
  const maxQaQuestions = minInt(g.maxQaQuestions, tenant?.maxQaQuestions, Number(g.maxQaQuestions ?? 3));
  const maxOutputTokens = Number.isFinite(Number(g.maxOutputTokens)) ? Number(g.maxOutputTokens) : 1200;

  return {
    platform,
    industry,
    tenant,

    effective: {
      models: { estimatorModel, qaModel, renderModel },
      prompts: {
        extraSystemPreamble,
        quoteEstimatorSystem: estimatorSystemFinal,
        qaQuestionGeneratorSystem: qaSystemFinal,
      },
      guardrails: {
        // locked
        mode: (g as any).mode ?? "balanced",
        piiHandling: (g as any).piiHandling ?? "redact",
        blockedTopics: Array.isArray(g.blockedTopics) ? g.blockedTopics : [],
        maxQaQuestions,
        maxOutputTokens,
      },
    },
  };
}