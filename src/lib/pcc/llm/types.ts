// src/lib/pcc/llm/types.ts

export type GuardrailMode = "strict" | "balanced" | "permissive";

export type PlatformLlmConfig = {
  version: number;
  updatedAt: string; // ISO
  guardrails: {
    mode: GuardrailMode;
    blockedTopics: string[]; // human-readable list
    piiHandling: "redact" | "allow" | "deny";
    maxOutputTokens: number;
  };
  models: {
    estimatorModel: string; // e.g. "gpt-4o-mini"
    qaModel: string; // e.g. "gpt-4o-mini"
    renderPromptModel: string; // if you later do prompt-gen for images
  };
  promptSets: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
    // future: industry overrides, etc.
  };
};

export function defaultPlatformLlmConfig(): PlatformLlmConfig {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    guardrails: {
      mode: "balanced",
      blockedTopics: [
        "Self-harm instructions",
        "Illegal wrongdoing instructions",
        "Hate/harassment targeting protected groups",
        "Sexual content involving minors",
      ],
      piiHandling: "redact",
      maxOutputTokens: 900,
    },
    models: {
      estimatorModel: "gpt-4o-mini",
      qaModel: "gpt-4o-mini",
      renderPromptModel: "gpt-4o-mini",
    },
    promptSets: {
      quoteEstimatorSystem: [
        "You are an expert estimator for service work based on photos and customer notes.",
        "Be conservative: return a realistic RANGE, not a single number.",
        "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
        "Do not invent brand/model/year—ask questions instead.",
        "Return ONLY valid JSON matching the schema provided by the server.",
      ].join("\n"),
      qaQuestionGeneratorSystem: [
        "You generate short, practical clarification questions for a service quote based on photos and notes.",
        "Ask only what is necessary to estimate accurately.",
        "Return ONLY valid JSON: { questions: string[] }",
      ].join("\n"),
    },
  };
}