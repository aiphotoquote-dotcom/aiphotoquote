// src/lib/pcc/llm/types.ts

export type PlatformLlmConfig = {
  version: number;

  models: {
    // Used for estimate + QA in /api/quote/submit
    estimatorModel: string;
    qaModel: string;

    // Used for /api/quote/render (optional)
    renderModel?: string;
  };

  prompts: {
    // System prompt used for estimate generation
    quoteEstimatorSystem: string;

    // System prompt used for QA question generation
    qaQuestionGeneratorSystem: string;

    // Optional extra preamble prepended to BOTH system prompts
    extraSystemPreamble?: string;
  };

  guardrails: {
    // Simple keyword/topic blocks (V1). We'll evolve this later.
    blockedTopics: string[];

    // Platform cap (tenant setting can be lower, not higher)
    maxQaQuestions: number;

    // Optional: keep around for future response_format/token tuning
    maxOutputTokens?: number;
  };

  updatedAt: string;
};

export function defaultPlatformLlmConfig(): PlatformLlmConfig {
  return {
    version: 1,
    models: {
      estimatorModel: "gpt-4o-mini",
      qaModel: "gpt-4o-mini",
      renderModel: "gpt-image-1",
    },
    prompts: {
      extraSystemPreamble: [
        "You are producing an estimate for legitimate service work.",
        "Do not provide instructions for wrongdoing or unsafe activity.",
        "Do not request or expose sensitive personal data beyond what is needed for the quote.",
        "If the submission is ambiguous, ask clarifying questions instead of guessing.",
      ].join("\n"),

      qaQuestionGeneratorSystem: [
        "You generate short, practical clarification questions for a service quote based on photos and notes.",
        "Ask only what is necessary to estimate accurately.",
        "Keep each question to one sentence.",
        "Prefer measurable details (dimensions, quantity, material, access, location).",
        "Avoid questions the photo obviously answers.",
        "Return ONLY valid JSON: { questions: string[] }",
      ].join("\n"),

      quoteEstimatorSystem: [
        "You are an expert estimator for service work based on photos and customer notes.",
        "Be conservative: return a realistic RANGE, not a single number.",
        "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
        "Do not invent brand/model/year—ask questions instead.",
        "Return ONLY valid JSON matching the provided schema.",
      ].join("\n"),
    },
    guardrails: {
      blockedTopics: [
        "credit card",
        "social security",
        "ssn",
        "password",
        "explosive",
        "bomb",
        "weapon",
      ],
      maxQaQuestions: 3,
      maxOutputTokens: 1200,
    },
    updatedAt: new Date().toISOString(),
  };
}