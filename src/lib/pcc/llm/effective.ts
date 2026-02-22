// src/lib/pcc/llm/effective.ts
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";
import type { TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

/**
 * Industry packs are DB-backed and will be normalized into Partial<PlatformLlmConfig>.
 *
 * ✅ RULE: no hardcoded industry keys, ever.
 * This function exists as the single import point for "industry layer" resolution.
 *
 * For now, it returns {} (no industry augmentation) until the DB-backed packs land.
 * That unblocks builds while preserving the layering contract: Platform + Industry + Tenant.
 */
export function getIndustryDefaults(_industryKey: string | null | undefined): Partial<PlatformLlmConfig> {
  // TODO(DB_PACKS): load industry pack from DB by key and normalize into Partial<PlatformLlmConfig>
  return {};
}

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function joinBlocks(...xs: Array<unknown>) {
  const parts = xs.map(safeStr).filter(Boolean);
  return parts.join("\n\n");
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
 * - guardrails are LOCKED to platform (tenant/industry cannot change)
 * - maxQaQuestions: tenant may only tighten: min(platform, tenant)
 * - prompts: additive merge: platform base + industry add + tenant add
 * - models: tenant may select different models, otherwise industry, otherwise platform
 *
 * NOTE:
 * “tenant adds” means we never replace platform prompt bodies; we *append*.
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

  // Guardrails are platform-locked
  const g = (platform.guardrails ?? {}) as any;

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
        mode: g.mode ?? "balanced",
        piiHandling: g.piiHandling ?? "redact",
        blockedTopics: Array.isArray(g.blockedTopics) ? g.blockedTopics : [],
        maxQaQuestions,
        maxOutputTokens,
      },
    },
  };
}