// src/lib/pcc/llm/types.ts

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing";

export type LlmModelConfig = {
  // used for quote estimate generation
  estimatorModel: string;

  // used for generating clarification questions (Live Q&A)
  qaModel: string;

  // used for image rendering (if/when we wire PCC to render route)
  renderModel?: string;
};

export type LlmPromptSet = {
  // System prompt for generating the final estimate JSON
  quoteEstimatorSystem: string;

  // System prompt for generating JSON { questions: string[] }
  qaQuestionGeneratorSystem: string;

  // Optional extra platform preamble appended to both systems (kept simple)
  extraSystemPreamble?: string;
};

export type LlmGuardrails = {
  // simple denylist keywords/phrases (case-insensitive substring match)
  blockedTopics: string[];

  // cap tenant QA max to avoid runaway UX
  maxQaQuestions: number;

  // optional cap you can apply in calls later (we’ll wire next)
  maxOutputTokens?: number;
};

export type PlatformLlmConfig = {
  version: number;

  models: LlmModelConfig;
  prompts: LlmPromptSet;
  guardrails: LlmGuardrails;

  updatedAt: string; // ISO
};

// ---- defaults ----

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
        "Do not provide instructions for wrongdoing, unsafe activity, or evasion.",
        "Do not request or expose sensitive personal data beyond what is needed for the quote.",
        "If the submission is ambiguous, ask clarifying questions instead of guessing.",
      ].join("\n"),

      quoteEstimatorSystem: [
        "You are an expert estimator for service work based on photos and customer notes (and possibly follow-up Q&A).",
        "Be conservative: return a realistic RANGE, not a single number.",
        "If photos are insufficient or ambiguous (or still insufficient after Q&A), set confidence low and inspection_required true.",
        "Do not invent brand/model/year—ask questions instead.",
        "Return ONLY valid JSON matching the provided schema.",
      ].join("\n"),

      qaQuestionGeneratorSystem: [
        "You generate short, practical clarification questions for a service quote based on photos and notes.",
        "Ask only what is necessary to estimate accurately.",
        "Keep each question to one sentence.",
        "Prefer measurable details (dimensions, quantity, material, access, location).",
        "Avoid questions the photo obviously answers.",
        "Return ONLY valid JSON: { questions: string[] }",
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
      maxOutputTokens: 900,
    },
    updatedAt: new Date().toISOString(),
  };
}