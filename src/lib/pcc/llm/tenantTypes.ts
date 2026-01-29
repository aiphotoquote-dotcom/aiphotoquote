// src/lib/pcc/llm/tenantTypes.ts

export type TenantLlmOverrides = {
  models?: {
    estimatorModel?: string;
    qaModel?: string;
    // NOTE: keep renderModel out of tenant overrides for now (image gen billing/risk)
  };

  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;
  };

  updatedAt?: string;
};

export function normalizeTenantOverrides(input: any): TenantLlmOverrides {
  const o = (input && typeof input === "object") ? input : {};

  const modelsIn = (o.models && typeof o.models === "object") ? o.models : {};
  const promptsIn = (o.prompts && typeof o.prompts === "object") ? o.prompts : {};

  const estimatorModel = String(modelsIn.estimatorModel ?? "").trim();
  const qaModel = String(modelsIn.qaModel ?? "").trim();

  const quoteEstimatorSystem = String(promptsIn.quoteEstimatorSystem ?? "");
  const qaQuestionGeneratorSystem = String(promptsIn.qaQuestionGeneratorSystem ?? "");
  const extraSystemPreamble = String(promptsIn.extraSystemPreamble ?? "");

  const updatedAt = o.updatedAt ? String(o.updatedAt) : undefined;

  return {
    models: {
      ...(estimatorModel ? { estimatorModel } : {}),
      ...(qaModel ? { qaModel } : {}),
    },
    prompts: {
      ...(quoteEstimatorSystem ? { quoteEstimatorSystem } : {}),
      ...(qaQuestionGeneratorSystem ? { qaQuestionGeneratorSystem } : {}),
      ...(extraSystemPreamble ? { extraSystemPreamble } : {}),
    },
    ...(updatedAt ? { updatedAt } : {}),
  };
}