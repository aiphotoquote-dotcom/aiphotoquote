// src/lib/pcc/llm/tenantTypes.ts

export type TenantLlmOverrides = {
  // Tenant-tweakable model overrides (optional)
  models?: {
    estimatorModel?: string;
    qaModel?: string;
    renderModel?: string;
  };

  // Tenant-tweakable prompt overrides (optional)
  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;
  };

  /**
   * Optional: tenant can only tighten maxQaQuestions (never increase beyond platform).
   * We are not necessarily exposing this in UI yet, but effective.ts supports it.
   */
  maxQaQuestions?: number;

  updatedAt?: string;
};

function safeStr(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

function clampInt(v: unknown, min: number, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return Math.max(min, Math.min(max, i));
}

export function normalizeTenantOverrides(input: any): TenantLlmOverrides {
  const modelsIn = (input?.models ?? {}) as any;
  const promptsIn = (input?.prompts ?? {}) as any;

  const estimatorModel = safeStr(modelsIn.estimatorModel);
  const qaModel = safeStr(modelsIn.qaModel);
  const renderModel = safeStr(modelsIn.renderModel);

  const quoteEstimatorSystem = safeStr(promptsIn.quoteEstimatorSystem);
  const qaQuestionGeneratorSystem = safeStr(promptsIn.qaQuestionGeneratorSystem);
  const extraSystemPreamble = safeStr(promptsIn.extraSystemPreamble);

  const maxQaQuestions = clampInt(input?.maxQaQuestions, 1, 10);

  const out: TenantLlmOverrides = {
    models: {
      ...(estimatorModel ? { estimatorModel } : {}),
      ...(qaModel ? { qaModel } : {}),
      ...(renderModel ? { renderModel } : {}),
    },
    prompts: {
      ...(quoteEstimatorSystem ? { quoteEstimatorSystem } : {}),
      ...(qaQuestionGeneratorSystem ? { qaQuestionGeneratorSystem } : {}),
      ...(extraSystemPreamble ? { extraSystemPreamble } : {}),
    },
    ...(typeof maxQaQuestions === "number" ? { maxQaQuestions } : {}),
    ...(safeStr(input?.updatedAt) ? { updatedAt: safeStr(input?.updatedAt) } : {}),
  };

  // If empty objects, omit them (keeps stored JSON clean)
  if (out.models && Object.keys(out.models).length === 0) delete out.models;
  if (out.prompts && Object.keys(out.prompts).length === 0) delete out.prompts;

  return out;
}