// src/lib/pcc/llm/effective.ts
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";
import type { TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

/**
 * DB-backed industry packs will be normalized into this same shape (Partial<PlatformLlmConfig>).
 * No hardcoded keys, ever.
 *
 * Composition model (additive):
 *   Platform + Industry + Tenant
 *
 * Guardrails are PLATFORM-LOCKED (industry/tenant cannot change them).
 */

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function joinBlocks(...xs: Array<unknown>) {
  const parts = xs.map(safeStr).filter(Boolean);
  return parts.join("\n\n");
}

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Merge rules:
 * - guardrails are LOCKED to platform (industry/tenant cannot change)
 * - prompts: additive merge: platform base + industry add + tenant add
 * - models: tenant may select different models, otherwise industry, otherwise platform
 *
 * NOTE: “tenant adds” means tenant does NOT replace platform prompt bodies; it appends.
 * If you need a true replacement, that belongs at PLATFORM (or by updating the industry pack).
 */
export function buildEffectiveLlmConfig(args: {
  platform: PlatformLlmConfig;
  industry: Partial<PlatformLlmConfig> | null;
  tenant: TenantLlmOverrides | null;
}) {
  const { platform, industry, tenant } = args;

  const platformP = (platform.prompts ?? {}) as any;
  const industryP = ((industry?.prompts ?? {}) as any) ?? {};
  const tenantP = ((tenant?.prompts ?? {}) as any) ?? {};

  // ✅ additive preamble: platform -> industry -> tenant
  const extraSystemPreamble = joinBlocks(
    platformP.extraSystemPreamble,
    industryP.extraSystemPreamble,
    tenantP.extraSystemPreamble
  );

  // ✅ additive prompt bodies: platform base -> industry add -> tenant add
  const quoteEstimatorSystem = joinBlocks(
    platformP.quoteEstimatorSystem,
    industryP.quoteEstimatorSystem,
    tenantP.quoteEstimatorSystem
  );

  const qaQuestionGeneratorSystem = joinBlocks(
    platformP.qaQuestionGeneratorSystem,
    industryP.qaQuestionGeneratorSystem,
    tenantP.qaQuestionGeneratorSystem
  );

  // Always prepend extra preamble (if present)
  const estimatorSystemFinal = joinBlocks(extraSystemPreamble, quoteEstimatorSystem);
  const qaSystemFinal = joinBlocks(extraSystemPreamble, qaQuestionGeneratorSystem);

  const platformModels = (platform.models ?? {}) as any;
  const industryModels = ((industry?.models ?? {}) as any) ?? {};
  const tenantModels = ((tenant?.models ?? {}) as any) ?? {};

  const estimatorModel =
    safeStr(tenantModels.estimatorModel) ||
    safeStr(industryModels.estimatorModel) ||
    safeStr(platformModels.estimatorModel) ||
    "gpt-4o-mini";

  const qaModel =
    safeStr(tenantModels.qaModel) ||
    safeStr(industryModels.qaModel) ||
    safeStr(platformModels.qaModel) ||
    "gpt-4o-mini";

  const renderModel =
    safeStr(tenantModels.renderModel) ||
    safeStr(industryModels.renderModel) ||
    safeStr(platformModels.renderModel) ||
    "gpt-image-1";

  // ✅ Guardrails are platform-locked
  const g = (platform.guardrails ?? {}) as any;

  const maxQaQuestions = clampInt(g.maxQaQuestions, 3, 0, 50);
  const maxOutputTokens = clampInt(g.maxOutputTokens, 1200, 1, 200_000);

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
        mode: g.mode ?? "balanced",
        piiHandling: g.piiHandling ?? "redact",
        blockedTopics: Array.isArray(g.blockedTopics) ? g.blockedTopics : [],
        maxQaQuestions,
        maxOutputTokens,
      },
    },
  };
}